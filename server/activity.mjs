// 대화 기록(jsonl) 꼬리 → '지금 하는 일'(Act) + 최근 활동 + 마지막 대화 줄의 상태.
// 대화 기록 형식은 Claude Code 내부 형식이라 바뀔 수 있다 — 모르는 모양은 조용히 건너뛴다.
// 비밀값: Bash 는 사람이 읽으라고 쓴 description 을 먼저 쓴다(명령 원문엔 토큰이 섞일 수 있다).
//
// 읽는 법: 최신 Claude Code 는 대화 줄 사이에 api-request-blob 같은 기록용 줄을 끼워 넣는데, 한 줄이
// 2MB 를 넘기도 한다(실측 최대 2,081,898바이트). 고정 256KB 꼬리로는 앞선 도구 줄이 창 밖으로 밀려나
// 활동 로그가 비었다. 그래서 처음엔 뒤에서부터 창을 넓혀 가며(256KB→1MB→4MB→8MB) 읽고, 그 뒤로는
// 파일이 자란 만큼만 이어 읽는다.
import fs from 'node:fs';
import path from 'node:path';
import { baseName } from './paths.mjs';

export const LOG_N = 8; // 사람마다 넘기는 최근 활동 수
export const WINDOWS = [256 * 1024, 1024 * 1024, 4 * 1024 * 1024, 8 * 1024 * 1024]; // 처음 읽을 때 넓혀 가는 창
export const MAX_READ = WINDOWS[WINDOWS.length - 1]; // 한 번에 이보다 많이는 안 읽는다(실측 165MB 대화 파일도 있다)
const CACHE_MAX = 300; // 파일별 캐시 상한 — 끝난 세션 파일이 쌓여도 메모리가 자라지 않게
export const SUB_QUIET_MS = 30 * 60 * 1000; // 30분 넘게 멈춘 서브에이전트는 끝난(끊긴) 것
export const MAX_SUBS = 12;

const cache = new Map(); // path → { size, mtimeMs, ino, end, acc, info }
const counters = { bytesRead: 0, parsed: 0 };

export function forget() {
  cache.clear(); // 시험 격리용
}

/** 지금까지 읽은 바이트·JSON 파싱 수 — 시험이 '늘어난 만큼만 읽나'를 확인한다 */
export const stats = () => ({ ...counters });

/** 공백을 접어 한 줄로, n 글자(코드포인트) 넘으면 말줄임 */
export function oneLine(text, n) {
  const s = String(text || '').split(/\s+/).filter(Boolean).join(' ');
  const cps = Array.from(s);
  return cps.length <= n ? s : cps.slice(0, n - 1).join('') + '…';
}

function hostOf(url) {
  try {
    return new URL(String(url || '')).hostname || '';
  } catch {
    return '';
  }
}

/** assistant 블록 하나 → Act({k, a}). 생각(thinking)·빈 글·모르는 모양은 null */
export function describe(block) {
  if (!block || typeof block !== 'object') return null;
  if (block.type === 'text') {
    // 말풍선엔 마크다운 기호(**굵게**·## 제목·`코드`)가 보이면 지저분하다 — 글자만 남긴다
    const a = oneLine(String(block.text || '').replace(/\*\*|__|`+|^#+\s*|\n#+\s*/g, ' '), 60);
    return a ? { k: 'text', a } : null;
  }
  if (block.type !== 'tool_use') return null;
  const name = String(block.name || '');
  const inp = block.input && typeof block.input === 'object' ? block.input : {};
  switch (name) {
    case 'Read': return { k: 'read', a: baseName(inp.file_path) };
    case 'Edit': case 'MultiEdit': case 'NotebookEdit':
      return { k: 'edit', a: baseName(inp.file_path || inp.notebook_path) };
    case 'Write': return { k: 'write', a: baseName(inp.file_path) };
    case 'Bash':
      return { k: 'bash', a: inp.description ? oneLine(inp.description, 44) : oneLine(inp.command, 40) };
    case 'Grep': return { k: 'grep', a: oneLine(inp.pattern, 24) };
    case 'Glob': return { k: 'glob', a: oneLine(inp.pattern, 28) };
    case 'WebFetch': return { k: 'fetch', a: hostOf(inp.url) };
    case 'WebSearch': return { k: 'search', a: oneLine(inp.query, 24) };
    case 'Agent': case 'Task': return { k: 'agent', a: oneLine(inp.description, 30) };
    case 'TodoWrite': return { k: 'todo', a: '' };
    case 'Skill': return { k: 'skill', a: oneLine(inp.skill, 24) };
    default:
      if (name.startsWith('mcp__')) return { k: 'mcp', a: oneLine(name.split('__').pop(), 24) };
      return name ? { k: 'tool', a: oneLine(name, 24) } : null;
  }
}

/** user 줄의 글(문자열·text 블록·tool_result 안의 글)을 한데 모은다 */
function userText(msg) {
  const c = msg && typeof msg === 'object' ? msg.content : null;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  const parts = [];
  for (const b of c) {
    if (!b || typeof b !== 'object') continue;
    if (typeof b.text === 'string') parts.push(b.text);
    if (typeof b.content === 'string') parts.push(b.content);
    if (Array.isArray(b.content)) for (const x of b.content) if (x && typeof x.text === 'string') parts.push(x.text);
  }
  return parts.join('\n');
}

function firstText(msg) {
  const c = msg && typeof msg === 'object' ? msg.content : null;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  const b = c.find((x) => x && x.type === 'text' && typeof x.text === 'string');
  return b ? b.text : '';
}

const ms = (iso) => {
  const t = Date.parse(String(iso || ''));
  return Number.isFinite(t) ? t : null;
};

/**
 * 대화 줄 하나의 상태. 사람이 친 게 아닌 기록용 user 줄(isMeta·로컬 명령 출력)은 null —
 * 그게 끝에 붙어 있다고 '일하는 중'으로 보면 안 된다.
 */
function entryState(e) {
  const msg = e.message && typeof e.message === 'object' ? e.message : {};
  if (e.type === 'user') {
    const text = userText(msg);
    if (text.includes('[Request interrupted by user')) {
      return { type: 'user', at: ms(e.timestamp), endTurn: false, interrupted: true, apiError: false };
    }
    if (e.isMeta === true || /^\s*<(local-command|command-)/.test(text)) return null;
    return { type: 'user', at: ms(e.timestamp), endTurn: false, interrupted: false, apiError: false };
  }
  if (e.type !== 'assistant') return null;
  // API 오류로 턴이 끝나면 Stop 훅이 안 울릴 수 있다 — 대화 기록으로 쉬는 중을 알아본다
  return {
    type: 'assistant',
    at: ms(e.timestamp),
    endTurn: msg.stop_reason === 'end_turn',
    interrupted: false,
    apiError: e.isApiErrorMessage === true || /^\s*API Error/.test(firstText(msg)),
  };
}

const newAcc = () => ({ events: [], last: null, cwd: '' });

/** 대화 줄 하나를 누적값(최근 활동·마지막 상태·cwd)에 더한다 — 앞에서 뒤 순서로 */
function absorb(acc, e) {
  if (typeof e.cwd === 'string' && e.cwd) acc.cwd = e.cwd;
  const st = entryState(e);
  if (st) acc.last = st;
  const content = e.type === 'assistant' && e.message && Array.isArray(e.message.content) ? e.message.content : null;
  if (content) {
    for (const block of content) {
      const act = describe(block);
      if (act) acc.events.push({ at: String(e.timestamp || ''), k: act.k, a: act.a });
    }
    if (acc.events.length > LOG_N) acc.events.splice(0, acc.events.length - LOG_N);
  }
  return acc;
}

/** 대화 줄 목록의 마지막 상태(기록용 user 줄은 건너뜀) */
export function lastState(entries) {
  return entries.reduce(absorb, newAcc()).last;
}

/** 앞 덩어리(older) + 뒤 덩어리(newer) */
function merge(older, newer) {
  return {
    events: [...older.events, ...newer.events].slice(-LOG_N),
    last: newer.last || older.last,
    cwd: newer.cwd || older.cwd,
  };
}

const TYPE_HEAD = Buffer.from('{"type":"');
const NEEDLES = [Buffer.from('"type":"assistant"'), Buffer.from('"type":"user"')];
const HEAD_OK = [Buffer.from('assistant"'), Buffer.from('user"')];

/**
 * 파싱할 가치가 있는 줄인가 — 2MB 기록용 줄을 매번 JSON.parse 하지 않게 바이트에서 먼저 거른다.
 * 맨 앞이 type 인 줄(api-request-* 등)은 값만 본다. 대화 줄은 type 이 줄 끝쪽에 있어(실측: assistant
 * 9,130줄 중 9,129줄이 앞 200바이트 밖) 앞부분만 봐서는 안 되고, 줄 전체에서 찾는다.
 */
function candidate(buf, s, e) {
  if (e - s > TYPE_HEAD.length && buf.compare(TYPE_HEAD, 0, TYPE_HEAD.length, s, s + TYPE_HEAD.length) === 0) {
    const v = s + TYPE_HEAD.length;
    return HEAD_OK.some((h) => e - v >= h.length && buf.compare(h, 0, h.length, v, v + h.length) === 0);
  }
  const line = buf.subarray(s, e);
  return NEEDLES.some((n) => line.indexOf(n) >= 0);
}

/**
 * 바이트 덩어리 → 누적값. dropFirst 면 첫 줄(덩어리 시작이 줄 중간)을 버린다.
 * 끝의 줄바꿈 없는 줄(아직 쓰는 중)은 건드리지 않는다 — from·to 는 실제로 처리한 줄의 범위.
 */
export function scanChunk(buf, dropFirst = false) {
  const acc = newAcc();
  let pos = 0;
  if (dropFirst) {
    const nl = buf.indexOf(10);
    pos = nl < 0 ? buf.length : nl + 1;
  }
  const from = pos;
  for (;;) {
    const nl = buf.indexOf(10, pos);
    if (nl < 0) break;
    if (candidate(buf, pos, nl)) {
      let e = null;
      counters.parsed++;
      try {
        e = JSON.parse(buf.toString('utf8', pos, nl));
      } catch {
        e = null;
      }
      if (e && typeof e === 'object' && (e.type === 'assistant' || e.type === 'user')) absorb(acc, e);
    }
    pos = nl + 1;
  }
  return { acc, from, to: pos };
}

function readRange(fd, start, end) {
  const buf = Buffer.alloc(Math.max(0, end - start));
  let off = 0;
  while (off < buf.length) {
    const n = fs.readSync(fd, buf, off, buf.length - off, start + off);
    if (n <= 0) break;
    off += n;
  }
  counters.bytesRead += off;
  return off === buf.length ? buf : buf.subarray(0, off);
}

/**
 * 처음 읽기 — 뒤에서부터 창을 넓혀 가며, 활동 LOG_N 개와 마지막 대화 줄이 잡히면(또는 파일 처음·8MB) 멈춘다.
 * 창 앞머리의 반쪽 줄(head)은 버리지 않고 들고 있다가 다음 창 앞부분에 이어 붙인다 — 같은 바이트를 두 번 안 읽게.
 */
function readBackward(fd, size) {
  let acc = newAcc();
  let end = size;
  let head = null; // [prev, 처리한 첫 줄 시작) — 아직 처리 못 한 앞 조각
  let prev = size;
  for (const w of WINDOWS) {
    const start = Math.max(0, size - w);
    const chunk = readRange(fd, start, prev);
    const buf = head ? Buffer.concat([chunk, head]) : chunk;
    const r = scanChunk(buf, start > 0);
    if (head) acc = merge(r.acc, acc);
    else [acc, end] = [r.acc, start + r.to];
    head = buf.subarray(0, r.from);
    prev = start;
    if ((acc.events.length >= LOG_N && acc.last) || start === 0) break;
  }
  return { acc, end };
}

const EMPTY = Object.freeze({ doing: null, log: [], last: null, cwd: '' });

function toInfo(acc) {
  const lastEv = acc.events[acc.events.length - 1];
  return { doing: lastEv ? { k: lastEv.k, a: lastEv.a } : null, log: acc.events.slice(-LOG_N), last: acc.last, cwd: acc.cwd };
}

/** 대화 파일 하나 → { doing, log:[{at,k,a}], last, cwd }. 그대로면 캐시, 자랐으면 늘어난 부분만 읽는다 */
export function readTranscript(file) {
  if (!file) return EMPTY;
  let fd;
  try {
    fd = fs.openSync(file, 'r');
  } catch {
    return EMPTY;
  }
  try {
    const st = fs.fstatSync(fd);
    const hit = cache.get(file);
    if (hit && hit.ino === st.ino && hit.size === st.size && hit.mtimeMs === st.mtimeMs) return hit.info;
    let state;
    if (hit && hit.ino === st.ino && st.size > hit.size && st.size - hit.end <= MAX_READ) {
      const r = scanChunk(readRange(fd, hit.end, st.size));
      state = { acc: merge(hit.acc, r.acc), end: hit.end + r.to };
    } else {
      state = readBackward(fd, st.size); // 처음·줄어듦(덮어쓰기)·너무 많이 자람
    }
    const info = toInfo(state.acc);
    if (cache.size >= CACHE_MAX) cache.clear();
    cache.set(file, { size: st.size, mtimeMs: st.mtimeMs, ino: st.ino, end: state.end, acc: state.acc, info });
    return info;
  } catch {
    return EMPTY;
  } finally {
    try { fs.closeSync(fd); } catch { /* 무시 */ }
  }
}

/**
 * 서브에이전트가 아직 일하는가 — 마지막 대화 줄이 '말을 마친 답'(end_turn)이 아니면 일하는 중.
 * 실측(원본, 최근 60개): 끝난 것은 전부 마지막 줄이 assistant + stop_reason end_turn 이었다.
 * 마지막 줄 찾기는 readTranscript 와 같은 읽기(뒤에서 넓혀 가기·8MB 상한)를 쓴다.
 */
export function subagentRunning(file, now = Date.now()) {
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return false;
  }
  if (now - st.mtimeMs > SUB_QUIET_MS) return false;
  const last = readTranscript(file).last;
  if (!last) return true; // 막 생겨 아직 쓴 게 없다 — 출근 중으로 본다
  return !(last.type === 'assistant' && (last.endTurn || last.apiError));
}

function readMeta(file) {
  try {
    const m = JSON.parse(fs.readFileSync(file.replace(/\.jsonl$/, '.meta.json'), 'utf8'));
    return m && typeof m === 'object' ? m : {};
  } catch {
    return {};
  }
}

/** 그 대화가 띄운 서브에이전트 중 지금 일하는 것 — 먼저 출근한 순서 */
export function runningSubagents(transcript, now = Date.now()) {
  if (!transcript) return [];
  const folder = path.join(transcript.replace(/\.jsonl$/, ''), 'subagents');
  let names;
  try {
    names = fs.readdirSync(folder).filter((n) => n.startsWith('agent-') && n.endsWith('.jsonl'));
  } catch {
    return [];
  }
  const found = [];
  for (const n of names) {
    const f = path.join(folder, n);
    if (!subagentRunning(f, now)) continue;
    let born;
    try {
      const st = fs.statSync(f);
      born = st.birthtimeMs || st.ctimeMs;
    } catch {
      continue;
    }
    const meta = readMeta(f);
    found.push({
      born,
      sub: {
        id: n.slice('agent-'.length, -'.jsonl'.length),
        type: String(meta.agentType || ''),
        desc: oneLine(meta.description, 60),
        doing: readTranscript(f).doing,
      },
    });
  }
  found.sort((a, b) => a.born - b.born);
  return found.map((x) => x.sub);
}
