// 대화 기록 꼬리 파싱 — Act 종류 전부, 마크다운 제거, 반쪽 줄, 마지막 줄 상태, 서브에이전트.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  LOG_N, describe, forget, lastState, oneLine, readTranscript, runningSubagents, scanChunk, stats, subagentRunning,
} from '../server/activity.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'office-act-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
test.beforeEach(() => forget());

const tool = (name, input) => ({ type: 'tool_use', name, input });
const asst = (content, extra = {}) => ({ type: 'assistant', timestamp: extra.at || '2026-10-22T01:00:00.000Z', cwd: '/w', message: { content, stop_reason: extra.stop ?? null }, ...extra.top });
const user = (content, at = '2026-10-22T01:00:01.000Z', top = {}) => ({ type: 'user', timestamp: at, cwd: '/w', message: { content }, ...top });
const writeJsonl = (file, rows) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n');
};

test('describe: 표의 Act 종류 전부', () => {
  const cases = [
    [{ type: 'text', text: 'hello' }, { k: 'text', a: 'hello' }],
    [tool('Read', { file_path: '/a/b/server.mjs' }), { k: 'read', a: 'server.mjs' }],
    [tool('Read', { file_path: 'C:\\x\\y\\win.txt' }), { k: 'read', a: 'win.txt' }],
    [tool('Edit', { file_path: '/a/e.js' }), { k: 'edit', a: 'e.js' }],
    [tool('MultiEdit', { file_path: '/a/m.js' }), { k: 'edit', a: 'm.js' }],
    [tool('NotebookEdit', { notebook_path: '/a/n.ipynb' }), { k: 'edit', a: 'n.ipynb' }],
    [tool('Write', { file_path: '/a/w.md' }), { k: 'write', a: 'w.md' }],
    [tool('Bash', { command: 'npm test', description: 'Run tests' }), { k: 'bash', a: 'Run tests' }],
    [tool('Bash', { command: 'x'.repeat(50) }), { k: 'bash', a: 'x'.repeat(39) + '…' }],
    [tool('Grep', { pattern: 'TODO' }), { k: 'grep', a: 'TODO' }],
    [tool('Glob', { pattern: 'src/**/*.ts' }), { k: 'glob', a: 'src/**/*.ts' }],
    [tool('WebFetch', { url: 'https://example.com/a?b' }), { k: 'fetch', a: 'example.com' }],
    [tool('WebFetch', { url: 'not a url' }), { k: 'fetch', a: '' }],
    [tool('WebSearch', { query: 'node test runner' }), { k: 'search', a: 'node test runner' }],
    [tool('Agent', { description: 'find auth code' }), { k: 'agent', a: 'find auth code' }],
    [tool('Task', { description: 'old name' }), { k: 'agent', a: 'old name' }],
    [tool('TodoWrite', { todos: [] }), { k: 'todo', a: '' }],
    [tool('Skill', { skill: 'pdf' }), { k: 'skill', a: 'pdf' }],
    [tool('mcp__github__create_issue', {}), { k: 'mcp', a: 'create_issue' }],
    [tool('SomethingNew', {}), { k: 'tool', a: 'SomethingNew' }],
  ];
  for (const [block, want] of cases) assert.deepEqual(describe(block), want, JSON.stringify(block));
});

test('describe: 생각·빈 글·모르는 모양은 건너뛴다', () => {
  assert.equal(describe({ type: 'thinking', thinking: 'hmm' }), null);
  assert.equal(describe({ type: 'text', text: '   ' }), null);
  assert.equal(describe({ type: 'tool_use' }), null);
  assert.equal(describe(null), null);
  assert.equal(describe('x'), null);
  assert.deepEqual(describe(tool('Read', 'bad input')), { k: 'read', a: '' });
});

test('describe: 마크다운 기호를 빼고 60자로 자른다', () => {
  assert.deepEqual(describe({ type: 'text', text: '## 제목\n**굵게** 와 `코드` 그리고 __밑줄__' }), { k: 'text', a: '제목 굵게 와 코드 그리고 밑줄' });
  const long = describe({ type: 'text', text: '가'.repeat(100) });
  assert.equal(Array.from(long.a).length, 60);
  assert.ok(long.a.endsWith('…'));
  assert.equal(oneLine('😀'.repeat(10), 5), '😀😀😀😀…'); // 이모지를 반쪽으로 자르지 않는다
});

test('scanChunk: 앞 반쪽 줄·깨진 줄·기록용 줄은 버리고, 끝의 쓰다 만 줄은 남겨 둔다', () => {
  const first = JSON.stringify(asst([{ type: 'text', text: 'first' }]));
  const last = JSON.stringify(asst([{ type: 'text', text: 'last' }]));
  const text = `${first.slice(20)}\n${JSON.stringify({ type: 'api-request', x: 1 })}\n{broken\n${last}\n{"type":"assistant","mess`;
  const buf = Buffer.from(text);
  const r = scanChunk(buf, true);
  assert.deepEqual(r.acc.events.map((e) => e.a), ['last']);
  assert.equal(r.from, first.length - 20 + 1);
  assert.equal(r.to, buf.length - '{"type":"assistant","mess'.length); // 쓰다 만 줄은 다음에 읽는다
  assert.deepEqual(scanChunk(buf, false).acc.events.map((e) => e.a), ['last']); // 반쪽 줄은 깨진 JSON 이라 어차피 빠진다
  assert.deepEqual(scanChunk(Buffer.from('no newline at all'), true), { acc: { events: [], last: null, cwd: '' }, from: 17, to: 17 });
});

// 실측 모양: 최신 Claude Code 는 대화 줄 사이에 2MB 넘는 api-request-blob 줄을 끼워 넣는다
const BIG = 2_100_000;
const blob = (n = BIG) => ({ type: 'api-request-blob', sessionId: 's', hash: 'h', message: { type: 'assistant', content: [{ type: 'text', text: 'x'.repeat(n) }] } });
const attachment = (n) => ({ parentUuid: 'p', isSidechain: false, attachment: { type: 'file', content: 'y'.repeat(n) }, type: 'attachment', timestamp: '2026-10-22T01:00:02.000Z' });

test('2MB 기록용 줄이 끼어도 앞선 도구 줄이 로그에 남는다(파싱은 안 한다)', () => {
  const f = path.join(tmp, 'blob-mid.jsonl');
  writeJsonl(f, [
    user('run it', '2026-10-22T01:00:00.000Z'),
    asst([tool('Bash', { command: 'echo office-e2e > e2e.txt', description: 'Write e2e marker' })], { at: '2026-10-22T01:00:01.000Z', stop: 'tool_use' }),
    { type: 'api-request-shape', sessionId: 's', shape: 'z'.repeat(95_000) },
    blob(),
    { type: 'api-request', sessionId: 's', id: 'r' },
    user([{ type: 'tool_result', content: 'ok' }], '2026-10-22T01:00:03.000Z'),
    attachment(141_000),
    asst([{ type: 'text', text: 'done' }], { at: '2026-10-22T01:00:04.000Z', stop: 'end_turn' }),
    { type: 'system', subtype: 'x', timestamp: '2026-10-22T01:00:05.000Z' },
  ]);
  const before = stats().parsed;
  const info = readTranscript(f);
  assert.deepEqual(info.log.map((e) => [e.k, e.a]), [['bash', 'Write e2e marker'], ['text', 'done']]);
  assert.equal(info.last.endTurn, true);
  assert.ok(stats().parsed - before <= 4, `parsed ${stats().parsed - before}`); // blob·shape 줄은 파싱하지 않는다
});

test('마지막 줄이 2MB 기록용 줄이어도 마지막 대화 상태·서브에이전트 판정이 맞다', () => {
  const dir = path.join(tmp, 'blobsub', 'sid', 'subagents');
  const done = path.join(dir, 'agent-done.jsonl');
  const busy = path.join(dir, 'agent-busy.jsonl');
  writeJsonl(done, [asst([{ type: 'text', text: 'all done' }], { stop: 'end_turn' }), blob()]);
  writeJsonl(busy, [asst([tool('Grep', { pattern: 'auth' })], { stop: 'tool_use' }), blob()]);
  assert.equal(readTranscript(done).last.endTurn, true);
  assert.equal(subagentRunning(done), false);
  assert.equal(subagentRunning(busy), true);
  assert.deepEqual(runningSubagents(path.join(tmp, 'blobsub', 'sid.jsonl')).map((s) => [s.id, s.doing.k]), [['busy', 'grep']]);
  const intr = path.join(tmp, 'blob-intr.jsonl');
  writeJsonl(intr, [asst([tool('Bash', { command: 'sleep 9' })], { stop: 'tool_use' }), user([{ type: 'text', text: '[Request interrupted by user]' }]), blob()]);
  assert.equal(readTranscript(intr).last.interrupted, true);
});

test('파일이 자라면 늘어난 부분만 읽고, 쓰다 만 줄은 다 써진 뒤에 한 번만 센다', () => {
  const f = path.join(tmp, 'grow.jsonl');
  writeJsonl(f, [asst([tool('Read', { file_path: '/p/a.js' })], { at: '2026-10-22T01:00:00.000Z' })]);
  assert.deepEqual(readTranscript(f).log.map((e) => e.a), ['a.js']);
  const add = JSON.stringify(asst([tool('Read', { file_path: '/p/b.js' })], { at: '2026-10-22T01:00:01.000Z' })) + '\n';
  let b0 = stats().bytesRead;
  fs.appendFileSync(f, add);
  assert.deepEqual(readTranscript(f).log.map((e) => e.a), ['a.js', 'b.js']);
  assert.equal(stats().bytesRead - b0, Buffer.byteLength(add));
  const third = JSON.stringify(asst([tool('Read', { file_path: '/p/c.js' })], { at: '2026-10-22T01:00:02.000Z' })) + '\n';
  fs.appendFileSync(f, third.slice(0, 30)); // 아직 쓰는 중
  assert.deepEqual(readTranscript(f).log.map((e) => e.a), ['a.js', 'b.js']);
  b0 = stats().bytesRead;
  fs.appendFileSync(f, third.slice(30));
  assert.deepEqual(readTranscript(f).log.map((e) => e.a), ['a.js', 'b.js', 'c.js']);
  assert.equal(stats().bytesRead - b0, Buffer.byteLength(third)); // 쓰다 만 줄부터 다시 — 그 밖은 안 읽는다
  writeJsonl(f, [asst([tool('Read', { file_path: '/p/new.js' })])]); // 덮어쓰기(줄어듦) → 처음부터
  assert.deepEqual(readTranscript(f).log.map((e) => e.a), ['new.js']);
});

test('창은 8MB 까지만 넓힌다 — 그보다 앞의 줄은 못 본다', () => {
  const f = path.join(tmp, 'huge.jsonl');
  writeJsonl(f, [asst([tool('Read', { file_path: '/p/far.js' })], { stop: 'tool_use' }), blob(9_000_000)]);
  const b0 = stats().bytesRead;
  const info = readTranscript(f);
  assert.deepEqual(info.log, []);
  assert.equal(info.last, null);
  assert.ok(stats().bytesRead - b0 <= 8 * 1024 * 1024 + 1024, `read ${stats().bytesRead - b0}`);
});

test('lastState: end_turn·끊김·API 오류·기록용 user 줄', () => {
  assert.equal(lastState([]), null);
  assert.equal(lastState([asst([], { stop: 'end_turn' })]).endTurn, true);
  assert.equal(lastState([asst([tool('Bash', {})], { stop: 'tool_use' })]).endTurn, false);
  assert.equal(lastState([user([{ type: 'text', text: '[Request interrupted by user]' }])]).interrupted, true);
  assert.equal(lastState([user([{ type: 'tool_result', content: '[Request interrupted by user for tool use]' }])]).interrupted, true);
  assert.equal(lastState([asst([{ type: 'text', text: 'API Error: 529 overloaded' }])]).apiError, true);
  assert.equal(lastState([asst([{ type: 'text', text: 'x' }], { top: { isApiErrorMessage: true } })]).apiError, true);
  const s = lastState([asst([], { stop: 'end_turn' }), user('<local-command-stdout>ok</local-command-stdout>'), user('meta', undefined, { isMeta: true })]);
  assert.equal(s.type, 'assistant');
  assert.equal(s.endTurn, true);
  assert.equal(lastState([user('do it', '2026-10-22T01:00:05.000Z')]).at, Date.parse('2026-10-22T01:00:05.000Z'));
});

test('readTranscript: doing·log(최근 8개)·cwd, 같은 파일이면 캐시', () => {
  const f = path.join(tmp, 'log.jsonl');
  const rows = [];
  for (let i = 0; i < 12; i++) rows.push(asst([tool('Read', { file_path: `/p/f${i}.js` })], { at: `2026-10-22T01:00:${String(i).padStart(2, '0')}.000Z` }));
  rows.push(asst([{ type: 'thinking', thinking: 'x' }, { type: 'text', text: 'done' }], { at: '2026-10-22T01:00:30.000Z', stop: 'end_turn' }));
  writeJsonl(f, rows);
  const info = readTranscript(f);
  assert.deepEqual(info.doing, { k: 'text', a: 'done' });
  assert.equal(info.log.length, LOG_N);
  assert.deepEqual(info.log[0], { at: '2026-10-22T01:00:05.000Z', k: 'read', a: 'f5.js' });
  assert.equal(info.cwd, '/w');
  assert.equal(info.last.endTurn, true);
  assert.equal(readTranscript(f), info);
  assert.deepEqual(readTranscript(path.join(tmp, 'missing.jsonl')).log, []);
});

test('runningSubagents: 일하는 것만, 메타 붙여 출근 순서대로', () => {
  const main = path.join(tmp, 'proj', 'sid1.jsonl');
  writeJsonl(main, [asst([{ type: 'text', text: 'hi' }])]);
  const dir = path.join(tmp, 'proj', 'sid1', 'subagents');
  writeJsonl(path.join(dir, 'agent-aaa.jsonl'), [asst([tool('Grep', { pattern: 'auth' })], { stop: 'tool_use' })]);
  fs.writeFileSync(path.join(dir, 'agent-aaa.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'find auth code' }));
  writeJsonl(path.join(dir, 'agent-bbb.jsonl'), [asst([{ type: 'text', text: 'all done' }], { stop: 'end_turn' })]);
  writeJsonl(path.join(dir, 'agent-ccc.jsonl'), [user('go')]);
  const old = (Date.now() - 31 * 60 * 1000) / 1000;
  fs.utimesSync(path.join(dir, 'agent-ccc.jsonl'), old, old); // 30분 넘게 멈춤 = 끊긴 것
  fs.writeFileSync(path.join(dir, 'agent-ddd.jsonl'), ''); // 막 생김 = 출근 중
  fs.writeFileSync(path.join(dir, 'other.txt'), 'x');
  const subs = runningSubagents(main);
  assert.deepEqual(subs.map((s) => s.id).sort(), ['aaa', 'ddd']);
  const a = subs.find((s) => s.id === 'aaa');
  assert.deepEqual(a, { id: 'aaa', type: 'Explore', desc: 'find auth code', doing: { k: 'grep', a: 'auth' } });
  assert.deepEqual(runningSubagents(path.join(tmp, 'nope.jsonl')), []);
  assert.deepEqual(runningSubagents(''), []);
});
