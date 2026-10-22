// 스냅샷 — 세션 합치기·우선순위·상태 보정·숨김·homes·이름 겹침·대체 모드·ended·생존 판정·형식.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { buildSnapshot, cardStatus, forget as forgetSnap, transcriptStatus } from '../server/snapshot.mjs';
import { forget as forgetAct } from '../server/activity.mjs';
import { forget as forgetSess, cleanupCards } from '../server/sessions.mjs';
import { cardAlive, parseStarts } from '../server/liveness.mjs';
import { normalizeConfig } from '../server/config.mjs';
import { encodeCwd } from '../server/paths.mjs';
import { buildCommand, installHooks } from '../server/hooks-config.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'office-snap-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const iso = (msAgo) => new Date(Date.now() - msAgo).toISOString();
const START = 'Wed Oct 22 10:11:24 2026';
const STARTS = new Map([[4242, START]]);
let envN = 0;

/** 시험마다 새 설정 폴더·상태 폴더 */
function fresh() {
  const base = path.join(tmp, `e${++envN}`);
  process.env.CLAUDE_CONFIG_DIR = path.join(base, 'cfg');
  process.env.CLAUDE_OFFICE_HOME = path.join(base, 'home');
  fs.mkdirSync(path.join(base, 'home', 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(base, 'cfg', 'projects'), { recursive: true });
  forgetSnap();
  forgetAct();
  forgetSess();
  return base;
}
function folder(base, ...parts) {
  const p = path.join(base, 'work', ...parts);
  fs.mkdirSync(p, { recursive: true });
  return p;
}
const asst = (at, content, stop = null, top = {}) => ({ type: 'assistant', timestamp: at, cwd: top.cwd, message: { content, stop_reason: stop }, ...top });
const userLine = (at, content, cwd) => ({ type: 'user', timestamp: at, cwd, message: { content } });
function transcript(cwd, sid, rows) {
  const f = path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', encodeCwd(cwd), `${sid}.jsonl`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, rows.map((r) => JSON.stringify({ ...r, cwd: r.cwd || cwd })).join('\n') + '\n');
  return f;
}
function putCard(sid, card) {
  fs.writeFileSync(path.join(process.env.CLAUDE_OFFICE_HOME, 'sessions', `${sid}.json`), JSON.stringify({ sessionId: sid, ...card }));
}
const snap = (cfg = {}, more = {}) => buildSnapshot({ cfg: normalizeConfig(cfg), starts: STARTS, ...more });
const live = { pid: 4242, pidStart: START };
const read = (f) => ({ type: 'tool_use', name: 'Read', input: { file_path: f } });

test('형식: 최상위·Person 필드 전부', async () => {
  const base = fresh();
  const cwd = folder(base, 'my-app');
  transcript(cwd, 's1', [asst(iso(3000), [read('/x/server.mjs')], 'tool_use')]);
  putCard('s1', { kind: 'working', cwd, updatedAt: iso(5000), ...live });
  const s = await snap();
  assert.equal(s.version, 1);
  assert.equal(s.demo, false);
  assert.equal(s.hooks, true);
  assert.ok(!Number.isNaN(Date.parse(s.now)));
  assert.equal(s.people.length, 1);
  const p = s.people[0];
  assert.deepEqual(Object.keys(p).sort(), ['ask', 'commits', 'doing', 'home', 'id', 'kid', 'log', 'name', 'path', 'pending', 'sessions', 'source', 'status', 'subCount', 'subs'].sort());
  assert.equal(p.id, path.resolve(cwd));
  assert.equal(p.name, 'my-app');
  assert.equal(p.status, 'working');
  assert.equal(p.source, 'hook');
  assert.equal(p.commits, null);
  assert.equal(p.kid, false);
  assert.equal(p.home, null);
  assert.deepEqual(p.doing, { k: 'read', a: 'server.mjs' });
  assert.equal(p.log.length, 1);
  assert.equal(typeof p.log[0].at, 'string');
});

test('같은 폴더의 세션은 한 명으로, 상태는 decision > working > rest', async () => {
  const base = fresh();
  const cwd = folder(base, 'app');
  transcript(cwd, 'a', [asst(iso(60000), [read('/x/a.js')], 'tool_use')]);
  transcript(cwd, 'b', [asst(iso(50000), [read('/x/b.js')], 'tool_use')]);
  transcript(cwd, 'c', [asst(iso(40000), [read('/x/c.js')], 'end_turn')]);
  putCard('a', { kind: 'working', cwd, updatedAt: iso(70000), ...live });
  putCard('b', { kind: 'decision', message: 'Bash:\n  npm   test', cwd, updatedAt: iso(30000), ...live });
  putCard('c', { kind: 'rest', cwd, updatedAt: iso(20000), ...live });
  const [p] = (await snap()).people;
  assert.equal(p.sessions, 3);
  assert.equal(p.status, 'decision');
  assert.equal(p.pending, 1);
  assert.equal(p.ask, 'Bash: npm test');
  assert.deepEqual(p.log.map((e) => e.a), ['a.js', 'b.js', 'c.js']); // 오래된 것 → 최신
  assert.deepEqual(p.doing, { k: 'read', a: 'c.js' }); // 가장 최근에 움직인 대화
  putCard('b', { kind: 'rest', cwd, updatedAt: iso(30000), ...live });
  forgetSnap();
  const [q] = (await snap()).people;
  assert.equal(q.status, 'working');
  assert.equal(q.ask, '');
});

test('보정: 결재 뒤 대화가 움직였으면 working, 끊김·턴 끝·API 오류면 rest', async () => {
  const now = Date.now();
  const at = (ms) => new Date(now - ms).toISOString();
  const last = (o) => ({ type: 'assistant', endTurn: false, interrupted: false, apiError: false, ...o });
  assert.equal(cardStatus({ kind: 'decision', updatedAt: at(10000) }, last({ type: 'user', at: now - 8000 }), now), 'working');
  assert.equal(cardStatus({ kind: 'decision', updatedAt: at(10000) }, last({ type: 'user', at: now - 9000 }), now), 'decision'); // 1.5초 안
  assert.equal(cardStatus({ kind: 'working', updatedAt: at(10000) }, last({ type: 'user', interrupted: true, at: now - 5000 }), now), 'rest');
  assert.equal(cardStatus({ kind: 'working', updatedAt: at(10000) }, last({ type: 'user', interrupted: true, at: now - 20000 }), now), 'working'); // 끊김 뒤 새 지시
  assert.equal(cardStatus({ kind: 'working', updatedAt: at(10000) }, last({ endTurn: true, at: now - 6000 }), now), 'rest');
  assert.equal(cardStatus({ kind: 'working', updatedAt: at(10000) }, last({ endTurn: true, at: now - 2000 }), now), 'working'); // 5초 안
  assert.equal(cardStatus({ kind: 'working', updatedAt: at(10000) }, last({ apiError: true, at: now - 1000 }), now), 'rest');
  assert.equal(cardStatus({ kind: 'weird', updatedAt: at(1) }, null, now), 'rest');
  assert.equal(transcriptStatus(last({ type: 'user', at: now - 1000 }), now - 1000, now), 'working');
  assert.equal(transcriptStatus(last({ type: 'user', at: now - 11 * 60000 }), now - 11 * 60000, now), 'rest');
  assert.equal(transcriptStatus(last({ endTurn: true, at: now }), now, now), 'rest');
  assert.equal(transcriptStatus(null, now, now), 'rest');
});

test('보정이 스냅샷에 반영된다(decision→working, interrupt→rest, end_turn→rest)', async () => {
  const base = fresh();
  const d = folder(base, 'dec');
  const i = folder(base, 'intr');
  const e = folder(base, 'end');
  transcript(d, 'd', [asst(iso(20000), [read('/x/a')], 'tool_use'), userLine(iso(2000), [{ type: 'tool_result', content: 'ok' }], d)]);
  putCard('d', { kind: 'decision', message: 'Bash', cwd: d, updatedAt: iso(10000), ...live });
  transcript(i, 'i', [asst(iso(20000), [read('/x/a')], 'tool_use'), userLine(iso(3000), [{ type: 'text', text: '[Request interrupted by user]' }], i)]);
  putCard('i', { kind: 'working', cwd: i, updatedAt: iso(10000), ...live });
  transcript(e, 'e', [asst(iso(8000), [{ type: 'text', text: 'done' }], 'end_turn')]);
  putCard('e', { kind: 'working', cwd: e, updatedAt: iso(10000), ...live });
  const by = Object.fromEntries((await snap()).people.map((p) => [p.name, p]));
  assert.equal(by.dec.status, 'working');
  assert.equal(by.dec.pending, 0);
  assert.equal(by.intr.status, 'rest');
  assert.equal(by.end.status, 'rest');
});

test('숨김·homes·이름 겹침', async () => {
  const base = fresh();
  const a = folder(base, 'one', 'app');
  const b = folder(base, 'two', 'app');
  const h = folder(base, 'secret');
  const sv = folder(base, 'backend');
  for (const [cwd, s] of [[a, 'a'], [b, 'b'], [h, 'h'], [sv, 'sv']]) {
    transcript(cwd, s, [asst(iso(1000), [read('/x/y')], 'tool_use')]);
    putCard(s, { kind: 'working', cwd, updatedAt: iso(2000), ...live });
  }
  const s = await snap({ hide: ['secret'], homes: { backend: 'server', [a]: 'server', app: 'kitchen' } });
  const names = s.people.map((p) => p.name).sort();
  assert.deepEqual(names, ['app (one)', 'app (two)', 'backend']);
  const by = Object.fromEntries(s.people.map((p) => [p.name, p]));
  assert.equal(by.backend.home, 'server');
  assert.equal(by['app (one)'].home, 'server'); // 경로로 지정
  assert.equal(by['app (two)'].home, null); // "server" 가 아닌 값은 무시
  forgetSnap();
  const s2 = await snap({ hide: [b] });
  assert.equal(s2.people.filter((p) => p.name === 'app').length, 1); // 겹침이 풀리면 이름도 원래대로
});

test('대체 모드: 카드 없는 최근 대화도 보이고, ended 카드는 숨기고 대체 모드도 막는다', async () => {
  const base = fresh();
  const w = folder(base, 'walker');
  const r = folder(base, 'rester');
  const gone = folder(base, 'gone');
  const old = folder(base, 'old');
  transcript(w, 'w', [asst(iso(2000), [read('/x/a.js')], 'tool_use')]);
  transcript(r, 'r', [asst(iso(2000), [{ type: 'text', text: 'bye' }], 'end_turn')]);
  transcript(gone, 'g', [asst(iso(2000), [read('/x/a.js')], 'tool_use')]);
  putCard('g', { kind: 'ended', cwd: gone, updatedAt: iso(1000) });
  const f = transcript(old, 'o', [asst(iso(3600000), [read('/x/a.js')], 'tool_use')]);
  const t = (Date.now() - 3600000) / 1000;
  fs.utimesSync(f, t, t); // 20분보다 오래됨
  // subagents 폴더의 파일은 대체 모드 대상이 아니다
  const sub = path.join(path.dirname(f), 'w', 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, 'agent-zz.jsonl'), JSON.stringify(asst(iso(1000), [], 'tool_use', { cwd: '/elsewhere' })) + '\n');
  const s = await snap();
  const by = Object.fromEntries(s.people.map((p) => [p.name, p]));
  assert.deepEqual(Object.keys(by).sort(), ['rester', 'walker']);
  assert.equal(by.walker.source, 'transcript');
  assert.equal(by.walker.status, 'working');
  assert.equal(by.rester.status, 'rest');
  assert.equal(s.hooks, true); // ended 카드라도 훅 카드를 읽었다
});

test('hooks: 카드도 설치도 없으면 false, settings.json 에 우리 훅이 있으면 true', async () => {
  fresh();
  assert.equal((await snap()).hooks, false);
  const { settings } = installHooks({}, buildCommand());
  fs.writeFileSync(path.join(process.env.CLAUDE_CONFIG_DIR, 'settings.json'), JSON.stringify(settings));
  assert.equal((await snap()).hooks, true);
});

test('생존 판정: 죽은 pid·시작시각 다름·오래된 무pid 카드는 빠진다', async () => {
  const base = fresh();
  const cwds = ['dead', 'reused', 'stale', 'fresh'].map((n) => folder(base, n));
  for (const [i, cwd] of cwds.entries()) transcript(cwd, `s${i}`, [asst(iso(1000), [read('/x/y')], 'tool_use')]);
  putCard('s0', { kind: 'working', cwd: cwds[0], updatedAt: iso(1000), pid: 999999, pidStart: START });
  putCard('s1', { kind: 'working', cwd: cwds[1], updatedAt: iso(1000), pid: 4242, pidStart: 'Mon Jan  1 00:00:00 2026' });
  putCard('s2', { kind: 'working', cwd: cwds[2], updatedAt: iso(7 * 3600000) });
  const f2 = path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', encodeCwd(cwds[2]), 's2.jsonl');
  const t = (Date.now() - 7 * 3600000) / 1000;
  fs.utimesSync(f2, t, t);
  putCard('s3', { kind: 'working', cwd: cwds[3], updatedAt: iso(1000) });
  const names = (await snap()).people.map((p) => p.name);
  assert.deepEqual(names, ['fresh']);
  // 단위: ps 표 파싱·시작시각의 겹친 공백
  const m = parseStarts('  12 Wed Oct  1 10:11:24 2026\n 7 Thu Oct 22 01:02:03 2026\nbad\n');
  assert.equal(m.get(12), 'Wed Oct 1 10:11:24 2026');
  assert.equal(cardAlive({ pid: 12, pidStart: 'Wed Oct  1 10:11:24 2026' }, { starts: m }), true);
  assert.equal(cardAlive({ pid: 7 }, { starts: m }), true);
  assert.equal(cardAlive({ pid: process.pid }, { starts: null }), true); // ps 실패 → kill 0
});

test('서브에이전트가 subs·subCount 로 나온다(12명 상한)', async () => {
  const base = fresh();
  const cwd = folder(base, 'boss');
  const f = transcript(cwd, 'm', [asst(iso(1000), [{ type: 'tool_use', name: 'Agent', input: { description: 'dig' } }], 'tool_use')]);
  putCard('m', { kind: 'working', cwd, updatedAt: iso(2000), ...live });
  const dir = path.join(f.replace(/\.jsonl$/, ''), 'subagents');
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < 14; i++) {
    fs.writeFileSync(path.join(dir, `agent-x${i}.jsonl`), JSON.stringify(asst(iso(500), [read(`/x/f${i}.js`)], 'tool_use')) + '\n');
    fs.writeFileSync(path.join(dir, `agent-x${i}.meta.json`), JSON.stringify({ agentType: 'Explore', description: `job ${i}` }));
  }
  const [p] = (await snap()).people;
  assert.equal(p.subCount, 14);
  assert.equal(p.subs.length, 12);
  assert.equal(p.subs[0].type, 'Explore');
  assert.equal(p.subs[0].doing.k, 'read');
});

test('git 저장소: 하위 폴더 세션도 루트로 묶이고, 커밋이 적으면 kid', async (t) => {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
  } catch {
    return t.skip('git 없음');
  }
  const base = fresh();
  const repo = folder(base, 'tiny');
  const g = (...a) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...a], { stdio: 'ignore' });
  g('init', '-q');
  for (let i = 0; i < 3; i++) g('commit', '-q', '--allow-empty', '-m', `c${i}`);
  const sub = folder(base, 'tiny', 'src', 'deep');
  transcript(repo, 'r1', [asst(iso(1000), [read('/x/a')], 'tool_use')]);
  transcript(sub, 'r2', [asst(iso(1000), [read('/x/b')], 'tool_use')]);
  putCard('r1', { kind: 'working', cwd: repo, updatedAt: iso(2000), ...live });
  putCard('r2', { kind: 'rest', cwd: sub, updatedAt: iso(2000), ...live });
  const s = await snap({ kidCommits: 50 });
  assert.equal(s.people.length, 1);
  const [p] = s.people;
  assert.equal(p.sessions, 2);
  assert.equal(p.commits, 3);
  assert.equal(p.kid, true);
  assert.equal(p.name, 'tiny');
  assert.equal(fs.realpathSync(p.id), fs.realpathSync(repo));
});

test('청소: 하루 넘은 ended 카드·7일 넘은 카드 파일을 치운다', () => {
  fresh();
  const dir = path.join(process.env.CLAUDE_OFFICE_HOME, 'sessions');
  putCard('endedOld', { kind: 'ended', updatedAt: iso(25 * 3600000) });
  putCard('endedNew', { kind: 'ended', updatedAt: iso(3600000) });
  putCard('ancient', { kind: 'rest', updatedAt: iso(1000) });
  const t = (Date.now() - 8 * 24 * 3600000) / 1000;
  fs.utimesSync(path.join(dir, 'ancient.json'), t, t);
  putCard('ok', { kind: 'rest', updatedAt: iso(1000) });
  assert.equal(cleanupCards(), 2);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['endedNew.json', 'ok.json']);
});
