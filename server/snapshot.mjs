// GET /api/office 응답 조립 — 세션 카드 + 대화 기록 대체 모드를 합쳐 프로젝트(루트 폴더)별 한 명으로.
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { loadConfig } from './config.mjs';
import { IS_WIN, pathKey, settingsFile } from './paths.mjs';
import { cardAlive, processStarts } from './liveness.mjs';
import { cleanupCards, mtimeOf, readCards, recentTranscripts, transcriptFor } from './sessions.mjs';
import { LOG_N, MAX_SUBS, oneLine, readTranscript, runningSubagents } from './activity.mjs';
import { installedEvents } from './hooks-config.mjs';

export const API_VERSION = 1;
const GIT_TTL_MS = 10 * 60 * 1000; // 루트·커밋 수는 10분 캐시 — git 을 3초마다 두드리지 않게
const ANSWERED_MS = 1500; // 결재 카드보다 대화가 이만큼 뒤에 움직였으면 사용자가 답한 것
const END_QUIET_MS = 5000; // end_turn 뒤 이만큼 조용하면 쉬는 중(Esc·Stop 훅 누락 대비)
const FALLBACK_WORKING_MS = 10 * 60 * 1000; // 대체 모드: 이만큼 조용하면 일 안 하는 것으로 본다
const CLEANUP_EVERY_MS = 10 * 60 * 1000;
const ASK_CHARS = 80;
const PRIORITY = { decision: 0, working: 1, rest: 2 };

const rootCache = new Map(); // cwd → { at, root }
const commitCache = new Map(); // root → { at, n }
let hookCache = { file: '', mtimeMs: -2, value: false };
let lastCleanup = 0;

export function forget() {
  rootCache.clear();
  commitCache.clear();
  hookCache = { file: '', mtimeMs: -2, value: false };
  lastCleanup = 0;
}

function git(cwd, args) {
  return new Promise((resolve) => {
    execFile('git', ['-C', cwd, ...args], { timeout: 3000, windowsHide: true, encoding: 'utf8' }, (err, out) => {
      resolve(err ? null : String(out).trim());
    });
  });
}

/** 프로젝트 루트 = git 최상위, 아니면 cwd 그대로(정규화) */
export async function gitRoot(cwd, now = Date.now()) {
  const hit = rootCache.get(cwd);
  if (hit && now - hit.at < GIT_TTL_MS) return hit.root;
  let root = path.resolve(cwd);
  if (fs.existsSync(cwd)) {
    const top = await git(cwd, ['rev-parse', '--show-toplevel']);
    if (top) root = path.resolve(top);
  }
  if (rootCache.size > 1000) rootCache.clear();
  rootCache.set(cwd, { at: now, root });
  return root;
}

/** 커밋 수 — git 저장소가 아니거나 못 세면 null(=보통 크기로 그린다) */
export async function commitCount(root, now = Date.now()) {
  const hit = commitCache.get(root);
  if (hit && now - hit.at < GIT_TTL_MS) return hit.n;
  const out = fs.existsSync(root) ? await git(root, ['rev-list', '--count', 'HEAD']) : null;
  const n = out && /^\d+$/.test(out) ? Number(out) : null;
  if (commitCache.size > 1000) commitCache.clear();
  commitCache.set(root, { at: now, n });
  return n;
}

/** settings.json 에 우리 훅이 깔려 있나 — 파일이 그대로면 다시 안 읽는다 */
function hooksInstalled() {
  const file = settingsFile();
  const m = fs.existsSync(file) ? mtimeOf(file) : -1;
  if (hookCache.file !== file || hookCache.mtimeMs !== m) {
    hookCache = { file, mtimeMs: m, value: m >= 0 && installedEvents(file).length > 0 };
  }
  return hookCache.value;
}

/** 카드 상태 + 대화 기록 보정. 훅이 못 본 일(터미널에서 바로 승인·Esc·API 오류)을 대화로 알아본다 */
export function cardStatus(card, last, now = Date.now()) {
  let kind = PRIORITY[card.kind] !== undefined ? card.kind : 'rest';
  const wrote = Date.parse(String(card.updatedAt || '')) || 0;
  if (!last || !Number.isFinite(last.at)) return kind;
  if (kind === 'decision' && last.at > wrote + ANSWERED_MS) kind = 'working'; // 사용자가 답했다
  if (kind === 'working' && last.at > wrote) {
    // Esc 로 끊으면 Stop 훅이 안 울린다 — 대화에 남은 끊김 표시·턴 끝으로 쉬는 중을 알아본다
    if (last.interrupted) kind = 'rest';
    else if (last.type === 'assistant' && (last.apiError || (last.endTurn && now - last.at > END_QUIET_MS))) kind = 'rest';
  }
  return kind;
}

/** 대체 모드(훅 카드 없음) 상태 — 승인 대기는 알 수 없다 */
export function transcriptStatus(last, mtimeMs, now = Date.now()) {
  if (!last || last.interrupted) return 'rest';
  if (last.type === 'assistant' && (last.endTurn || last.apiError)) return 'rest';
  return now - Math.max(mtimeMs || 0, last.at || 0) < FALLBACK_WORKING_MS ? 'working' : 'rest';
}

const nameKey = (s) => (IS_WIN ? String(s).toLowerCase() : String(s));

function matches(list, name, key) {
  return list.some((x) => nameKey(x) === nameKey(name) || pathKey(x) === key);
}

function homeOf(homes, name, key) {
  for (const [k, v] of Object.entries(homes)) {
    if (v === 'server' && (nameKey(k) === nameKey(name) || pathKey(k) === key)) return 'server';
  }
  return null;
}

/** 살아 있는 세션들 — 훅 카드 먼저, 카드 없는 최근 대화는 대체 모드로 */
function collectSessions(cfg, now, starts) {
  const cards = readCards();
  const known = new Set(cards.map((c) => c.sessionId)); // ended 카드도 대체 모드를 막는다(유령 방지)
  const out = [];
  for (const card of cards) {
    if (card.kind === 'ended') continue;
    const transcript = transcriptFor(card, now);
    const tm = transcript ? mtimeOf(transcript) : 0;
    if (!cardAlive(card, { starts, now, transcriptMtimeMs: tm, staleHours: cfg.staleHours })) continue;
    const info = readTranscript(transcript);
    const cwd = (typeof card.cwd === 'string' && card.cwd) || info.cwd;
    if (!cwd) continue;
    const status = cardStatus(card, info.last, now);
    out.push({
      cwd,
      status,
      ask: status === 'decision' ? oneLine(card.message, ASK_CHARS) : '',
      at: Date.parse(String(card.updatedAt || '')) || 0,
      source: 'hook',
      transcript,
      info,
    });
  }
  if (cfg.fallbackMinutes > 0) {
    for (const t of recentTranscripts(cfg.fallbackMinutes, now)) {
      if (known.has(t.sessionId)) continue;
      const info = readTranscript(t.file);
      if (!info.cwd) continue;
      out.push({ cwd: info.cwd, status: transcriptStatus(info.last, t.mtimeMs, now), ask: '', at: t.mtimeMs, source: 'transcript', transcript: t.file, info });
    }
  }
  return { sessions: out, cardCount: cards.length };
}

/** 스냅샷 한 장. opts: now·cfg·starts(시험용 주입) */
export async function buildSnapshot(opts = {}) {
  const now = opts.now ?? Date.now();
  const cfg = opts.cfg ?? loadConfig();
  if (opts.cleanup || now - lastCleanup > CLEANUP_EVERY_MS) {
    lastCleanup = now;
    cleanupCards(now);
  }
  const starts = opts.starts !== undefined ? opts.starts : processStarts(now);
  const { sessions, cardCount } = collectSessions(cfg, now, starts);

  const cwds = [...new Set(sessions.map((s) => s.cwd))];
  const roots = new Map(await Promise.all(cwds.map(async (c) => [c, await gitRoot(c, now)])));
  const groups = new Map(); // pathKey(root) → { root, items }
  for (const s of sessions) {
    const root = roots.get(s.cwd);
    const key = pathKey(root);
    if (!groups.has(key)) groups.set(key, { root, items: [] });
    groups.get(key).items.push(s);
  }

  const people = [];
  for (const [key, { root, items }] of groups) {
    const base = path.basename(root) || root;
    if (matches(cfg.hide, base, key)) continue;
    const status = items.map((s) => s.status).sort((a, b) => PRIORITY[a] - PRIORITY[b])[0];
    const asks = items.filter((s) => s.status === 'decision').sort((a, b) => b.at - a.at);
    const commits = await commitCount(root, now);
    const subs = items.flatMap((s) => runningSubagents(s.transcript, now));
    // 한 프로젝트에 대화가 둘 이상이면(탭·/clear 직후) 가장 최근에 움직인 쪽이 '지금 하는 일'
    const lastAt = (s) => (s.info.log.length ? s.info.log[s.info.log.length - 1].at : '');
    const latest = items.reduce((a, b) => (lastAt(b) > lastAt(a) ? b : a));
    const log = items.flatMap((s) => s.info.log).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).slice(-LOG_N);
    people.push({
      id: root,
      name: base,
      path: root,
      status,
      pending: asks.length,
      ask: asks.length ? asks[0].ask : '',
      sessions: items.length,
      source: items.some((s) => s.source === 'hook') ? 'hook' : 'transcript',
      commits,
      kid: commits !== null && commits < cfg.kidCommits,
      home: homeOf(cfg.homes, base, key),
      subs: subs.slice(0, MAX_SUBS),
      subCount: subs.length,
      doing: latest.info.doing,
      log,
    });
  }

  // 같은 폴더 이름이 둘이면 "이름 (부모)" 로 가른다
  const count = new Map();
  for (const p of people) count.set(nameKey(p.name), (count.get(nameKey(p.name)) || 0) + 1);
  for (const p of people) {
    if (count.get(nameKey(p.name)) > 1) p.name = `${p.name} (${path.basename(path.dirname(p.path))})`;
  }
  people.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  return {
    version: API_VERSION,
    now: new Date(now).toISOString(),
    hooks: cardCount > 0 || hooksInstalled(),
    demo: false,
    people,
  };
}
