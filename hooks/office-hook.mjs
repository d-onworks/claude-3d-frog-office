#!/usr/bin/env node
// Claude Code 훅 수신기 — 세션 카드 1파일(<상태폴더>/sessions/<session_id>.json)을 쓴다.
// 계약: 어떤 입력·오류에도 exit 0, stdout 출력 없음(본 세션 작업에 절대 영향 금지).
// node 표준 라이브러리만. 서버 모듈은 SessionStart 의 자동 시작 때만 늦게 불러온다.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const IS_WIN = process.platform === 'win32';
export const SID_RE = /^[A-Za-z0-9._-]+$/; // 경로조작 차단 — 벗어나면 그냥 버린다
const STDIN_GUARD_MS = 5000;

// ── 알림을 카드 종류로 가르기 ─────────────────────────────────────────────
// 진짜 결재는 '사람이 답해야 Claude 가 한 발짝이라도 나가는 것'뿐이다. 문구만 보고 가르면
// 백그라운드 작업 알림("<작업> failed")까지 결재로 올라가 아무도 안 기다리는 결재가 며칠씩 남는다(원본 실사고).
export const DECISION_NOTIFICATIONS = new Set([
  'permission_prompt', 'worker_permission_prompt', 'agent_needs_input', 'elicitation_dialog',
]);

/** 알림 하나 → 'decision' | 'idle' | 'other'(카드를 건드리지 않는다) */
export function notificationKind(ntype, message) {
  if (DECISION_NOTIFICATIONS.has(ntype)) return 'decision';
  if (ntype === 'idle_prompt') return 'idle';
  // 모르는 종류(종류가 아예 없던 옛 버전 포함)만 문구로 한 번 더 본다
  const low = String(message || '').toLowerCase();
  if (low.includes('needs your permission') || low.includes('needs your input')) return 'decision';
  if (!ntype && low.includes('waiting for your input')) return 'idle';
  return 'other'; // 작업 완료·실패·인증 등은 알림일 뿐 — 하던 일을 그대로 둔다
}

function oneLine(text, n) {
  const s = String(text || '').split(/\s+/).filter(Boolean).join(' ');
  const cps = Array.from(s);
  return cps.length <= n ? s : cps.slice(0, n - 1).join('') + '…';
}

const baseName = (p) => String(p || '').split(/[\\/]+/).filter(Boolean).pop() || '';

/** PermissionRequest → 짧은 결재 문구. Bash 는 명령 원문보다 description 먼저(토큰이 섞일 수 있다) */
export function permissionText(data) {
  const tool = String(data.tool_name || '');
  const inp = data.tool_input && typeof data.tool_input === 'object' ? data.tool_input : {};
  let detail = '';
  if (tool === 'Bash') detail = inp.description || inp.command || '';
  else if (inp.file_path || inp.notebook_path) detail = baseName(inp.file_path || inp.notebook_path);
  else if (inp.url) detail = String(inp.url).replace(/^[a-z]+:\/\//i, '').split('/')[0];
  return oneLine(detail ? `${tool}: ${detail}` : tool || 'permission', 120);
}

// ── 이 세션의 Claude 프로세스 찾기 ───────────────────────────────────────
// 훅은 Claude 가 부르므로 그 프로세스가 곧 내 조상이다(claude → sh/bash/powershell → node).
// pid 만으로는 재사용된 번호에 속을 수 있어 맥·리눅스는 ps 시작시각까지 함께 적는다(문자열 그대로).

/** Claude 실행 파일인가 — 버전 바이너리(…/claude/versions/2.1.232)도 포함 */
export function isClaude(comm) {
  const b = baseName(comm).toLowerCase();
  return b.includes('claude') || /[\\/]claude[\\/]versions[\\/]/i.test(comm) || /^\d+\.\d+\.\d+$/.test(b);
}
const isNodeLike = (comm) => ['node', 'node.exe', 'bun', 'bun.exe'].includes(baseName(comm).toLowerCase());

/** 'pid ppid <lstart 5토막> comm' → Map(pid → {ppid, start, comm}) */
export function parsePs(text) {
  const table = new Map();
  for (const line of String(text).split('\n')) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 8) continue; // lstart = 'Wed Oct 22 10:11:24 2026' (5토막)
    const pid = Number(parts[0]);
    const ppid = Number(parts[1]);
    if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue;
    table.set(pid, { ppid, start: parts.slice(2, 7).join(' '), comm: parts.slice(7).join(' ') });
  }
  return table;
}

/** 'pid ppid name' 줄들(윈도우 Win32_Process) → 같은 모양의 표(시작시각 없음) */
export function parseWinTable(text) {
  const table = new Map();
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
    if (m) table.set(Number(m[1]), { ppid: Number(m[2]), start: null, comm: m[3] });
  }
  return table;
}

/** 내 조상을 거슬러 올라가 첫 Claude, 없으면 첫 node/bun(나 자신 제외) */
export function ownerFrom(table, selfPid, selfPpid) {
  const chain = [];
  let pid = table.has(selfPid) ? table.get(selfPid).ppid : selfPpid;
  for (let i = 0; i < 15 && pid > 1; i++) {
    const row = table.get(pid);
    if (!row) break;
    chain.push({ pid, ...row });
    if (row.ppid === pid) break; // 있을 수 없지만 순환에 갇히지 않게
    pid = row.ppid;
  }
  const owner = chain.find((r) => isClaude(r.comm)) || chain.find((r) => isNodeLike(r.comm));
  return owner ? { pid: owner.pid, pidStart: owner.start || null } : { pid: null, pidStart: null };
}

/**
 * 실패는 전부 pid 없음 — 그러면 서버가 updatedAt·대화 파일 시각으로 판정한다.
 * LC_ALL=C 고정 필수: 훅은 Claude 의 환경을 물려받아 한글 로케일이면 lstart 가 7토막으로 나와
 * 서버(영어 환경)와 문자열이 절대 안 맞는다(원본 실사고).
 */
function findOwner() {
  try {
    let table;
    if (IS_WIN) {
      const ps = 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId) $($_.Name)" }';
      table = parseWinTable(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
        encoding: 'utf8', timeout: 4000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 << 20,
      }));
    } else {
      table = parsePs(execFileSync('ps', ['-eo', 'pid=,ppid=,lstart=,comm='], {
        encoding: 'utf8', timeout: 2000, env: { ...process.env, LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 16 << 20,
      }));
    }
    return ownerFrom(table, process.pid, process.ppid);
  } catch {
    return { pid: null, pidStart: null };
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return !!e && e.code === 'EPERM';
  }
}

// ── 카드 읽기·쓰기 ─────────────────────────────────────────────────────
export function sessionsDir() {
  return path.join(path.resolve(process.env.CLAUDE_OFFICE_HOME || path.join(os.homedir(), '.claude-office')), 'sessions');
}

function readPrior(file) {
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    return c && typeof c === 'object' && !Array.isArray(c) ? c : {};
  } catch {
    return {};
  }
}

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** 원자적 쓰기(tmp → rename) — 서버가 반쪽 JSON 을 읽지 않게. 윈도우는 읽는 중이면 잠깐 막힐 수 있어 다시 해 본다 */
function writeCard(file, card) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(card));
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      if (i >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(e.code)) {
        try { fs.unlinkSync(tmp); } catch { /* 무시 */ }
        throw e;
      }
      sleepSync(30);
    }
  }
}

/** 훅 입력 하나 → 카드 처리. 반환값은 시험용(무엇을 했나) */
export async function handle(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'ignored';
  const event = String(data.hook_event_name || '');
  const sid = String(data.session_id || '');
  if (!SID_RE.test(sid)) return 'ignored';
  // 서브에이전트 안에서 울린 훅 — 승인 창(본 세션이 띄운다)만 받고 나머지는 카드를 안 바꾼다
  if (data.agent_id && event !== 'PermissionRequest' && event !== 'Notification') return 'ignored';
  const file = path.join(sessionsDir(), `${sid}.json`);
  const cwd = typeof data.cwd === 'string' ? data.cwd : '';
  const transcriptPath = typeof data.transcript_path === 'string' ? data.transcript_path : '';

  // SessionEnd 는 기본 제한시간이 짧다(1.5초) — pid 찾기·서버 시작 없이 ended 카드만 쓰고 끝낸다.
  // 지우지 않고 ended 로 남기는 이유: 대화 기록 대체 모드가 이 세션을 유령으로 다시 띄우지 않게.
  if (event === 'SessionEnd') {
    writeCard(file, { sessionId: sid, kind: 'ended', message: '', event, cwd, transcriptPath, updatedAt: new Date().toISOString() });
    return 'ended';
  }

  const prior = readPrior(file);
  let kind;
  let message = '';
  const extra = {};
  if (event === 'Notification') {
    const nk = notificationKind(String(data.notification_type || ''), String(data.message || ''));
    if (nk === 'decision') {
      kind = 'decision';
      // 승인 창이 뜨면 PermissionRequest 가 바로, 이 알림은 몇 초 뒤에 온다 — 먼저 적은 자세한 문구를 지킨다
      message = prior.kind === 'decision' && prior.event === 'PermissionRequest' && prior.message
        ? String(prior.message) : oneLine(data.message, 200);
    } else if (nk === 'idle' && !data.agent_id && prior.kind !== 'decision') {
      kind = 'rest';
    } else {
      return 'ignored';
    }
  } else if (event === 'PermissionRequest') {
    kind = 'decision';
    message = permissionText(data);
  } else if (event === 'Stop') {
    kind = 'rest';
  } else if (event === 'UserPromptSubmit') {
    kind = 'working';
  } else if (event === 'PreCompact') {
    // 압축도 일이다. 압축엔 Stop 이 안 울려 끝은 SessionStart(source=compact)가 알린다 — 어느 쪽 압축이었나 적어 둔다
    kind = 'working';
    extra.compactTrigger = String(data.trigger || '');
  } else if (event === 'SessionStart') {
    // 자동 압축은 턴 한가운데서 일어나 끝나면 하던 일을 계속한다 — 그때는 '일하는 중' 카드를 그대로 둔다
    if (String(data.source || '') === 'compact' && prior.compactTrigger !== 'manual') return 'ignored';
    kind = 'rest';
  } else {
    return 'ignored';
  }

  // 주인 찾기는 세션당 한 번 — 직전 카드의 pid 가 살아 있으면 그대로 쓴다(재개로 프로세스가 바뀌면 다시 찾는다)
  let pid = Number.isInteger(prior.pid) && prior.pid > 0 && pidAlive(prior.pid) ? prior.pid : null;
  let pidStart = pid && typeof prior.pidStart === 'string' ? prior.pidStart : null;
  if (!pid) ({ pid, pidStart } = findOwner());

  const card = { sessionId: sid, kind, message, event, cwd, transcriptPath };
  if (pid) card.pid = pid;
  if (pid && pidStart) card.pidStart = pidStart;
  Object.assign(card, extra);
  card.updatedAt = new Date().toISOString();
  writeCard(file, card);

  if (event === 'SessionStart') {
    try {
      const { ensureServer } = await import('../server/control.mjs');
      await ensureServer(); // 설정 autoStart(기본 켬)일 때 꺼진 서버를 띄운다
    } catch {
      /* 화면이 안 뜰 뿐 — 세션엔 영향 없다 */
    }
  }
  return kind;
}

function readStdin() {
  return new Promise((resolve) => {
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', () => resolve(''));
  });
}

/** 직접 실행됐나 — 링크 경로(맥 /tmp → /private/tmp 등)로 불려도 맞게 실제 경로끼리 견준다 */
function isMain() {
  try {
    const a = fs.realpathSync(fileURLToPath(import.meta.url));
    const b = fs.realpathSync(path.resolve(process.argv[1] || ''));
    return IS_WIN ? a.toLowerCase() === b.toLowerCase() : a === b;
  } catch {
    return false;
  }
}

if (isMain()) {
  const guard = setTimeout(() => process.exit(0), STDIN_GUARD_MS); // stdin 이 안 닫혀도 세션을 붙잡지 않게
  process.on('uncaughtException', () => process.exit(0));
  process.on('unhandledRejection', () => process.exit(0));
  readStdin()
    .then((raw) => {
      clearTimeout(guard); // 그 뒤의 느린 일(ps·PowerShell)은 각자 제한시간이 있다
      return handle(JSON.parse(raw.replace(/^﻿/, '')));
    })
    .catch(() => {})
    .finally(() => process.exit(0));
}
