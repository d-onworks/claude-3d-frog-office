// 훅 — 이벤트별 카드, 압축 예외, 알림 가르기, ended, 잘못된 입력, 주인 프로세스 찾기.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { handle, notificationKind, ownerFrom, parsePs, parseWinTable, permissionText } from '../hooks/office-hook.mjs';

const HOOK = fileURLToPath(new URL('../hooks/office-hook.mjs', import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'office-hook-'));
process.env.CLAUDE_OFFICE_HOME = path.join(tmp, 'home');
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'cfg');
process.env.CLAUDE_OFFICE_PORT = '1'; // 혹시라도 서버를 찾으면 아무도 없는 포트
fs.mkdirSync(process.env.CLAUDE_OFFICE_HOME, { recursive: true });
fs.writeFileSync(path.join(process.env.CLAUDE_OFFICE_HOME, 'config.json'), JSON.stringify({ autoStart: false }));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const cardPath = (sid) => path.join(process.env.CLAUDE_OFFICE_HOME, 'sessions', `${sid}.json`);
const card = (sid) => JSON.parse(fs.readFileSync(cardPath(sid), 'utf8'));
let n = 0;
const sid = () => `t${++n}-${process.pid}`;
const ev = (s, hook_event_name, more = {}) => handle({ session_id: s, hook_event_name, cwd: '/w/app', transcript_path: '/w/t.jsonl', ...more });

function runHook(input) {
  return spawnSync(process.execPath, [HOOK], { input, env: process.env, encoding: 'utf8', timeout: 15000 });
}

test('UserPromptSubmit → working, 카드 필드', async () => {
  const s = sid();
  assert.equal(await ev(s, 'UserPromptSubmit'), 'working');
  const c = card(s);
  assert.equal(c.kind, 'working');
  assert.equal(c.sessionId, s);
  assert.equal(c.event, 'UserPromptSubmit');
  assert.equal(c.cwd, '/w/app');
  assert.equal(c.transcriptPath, '/w/t.jsonl');
  assert.ok(!Number.isNaN(Date.parse(c.updatedAt)));
  assert.ok(!fs.readdirSync(path.dirname(cardPath(s))).some((f) => f.endsWith('.tmp')));
});

test('Stop → rest, PreCompact → working + compactTrigger', async () => {
  const s = sid();
  await ev(s, 'Stop');
  assert.equal(card(s).kind, 'rest');
  await ev(s, 'PreCompact', { trigger: 'manual' });
  assert.equal(card(s).kind, 'working');
  assert.equal(card(s).compactTrigger, 'manual');
});

test('SessionStart: 자동 압축 뒤엔 그대로, 수동 압축·새 시작은 rest', async () => {
  const s = sid();
  await ev(s, 'PreCompact', { trigger: 'auto' });
  assert.equal(await ev(s, 'SessionStart', { source: 'compact' }), 'ignored');
  assert.equal(card(s).kind, 'working');
  await ev(s, 'PreCompact', { trigger: 'manual' });
  await ev(s, 'SessionStart', { source: 'compact' });
  assert.equal(card(s).kind, 'rest');
  const s2 = sid();
  await ev(s2, 'SessionStart', { source: 'startup' });
  assert.equal(card(s2).kind, 'rest');
  assert.equal(await ev(sid(), 'SessionStart', { source: 'compact' }), 'ignored'); // 카드 없던 자동 압축
});

test('Notification: 결재 종류만 decision, idle 은 rest, 그 밖은 그대로', async () => {
  const s = sid();
  await ev(s, 'UserPromptSubmit');
  await ev(s, 'Notification', { notification_type: 'agent_completed', message: 'Render pipeline failed' });
  assert.equal(card(s).kind, 'working'); // 백그라운드 작업 알림은 결재가 아니다
  await ev(s, 'Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
  assert.equal(card(s).kind, 'decision');
  assert.equal(card(s).message, 'Claude needs your permission to use Bash');
  await ev(s, 'Notification', { notification_type: 'idle_prompt', message: 'Claude is waiting for your input' });
  assert.equal(card(s).kind, 'decision'); // 결재가 걸려 있으면 idle 로 덮지 않는다
  await ev(s, 'Stop');
  await ev(s, 'Notification', { notification_type: 'idle_prompt', message: 'Claude is waiting for your input' });
  assert.equal(card(s).kind, 'rest');
  for (const t of ['worker_permission_prompt', 'agent_needs_input', 'elicitation_dialog']) {
    await ev(s, 'Stop');
    await ev(s, 'Notification', { notification_type: t, message: 'x' });
    assert.equal(card(s).kind, 'decision', t);
  }
});

test('notificationKind: 종류 없는 옛 버전은 문구로', () => {
  assert.equal(notificationKind('', 'Claude needs your permission to use Write'), 'decision');
  assert.equal(notificationKind('', 'Claude Needs Your Input'), 'decision');
  assert.equal(notificationKind('', 'Claude is waiting for your input'), 'idle');
  assert.equal(notificationKind('', 'Task finished'), 'other');
  assert.equal(notificationKind('auth_success', 'needs your permission'), 'decision'); // 모르는 종류 + 결재 문구
  assert.equal(notificationKind('idle_prompt', 'needs your permission'), 'idle');
});

test('PermissionRequest → decision, 뒤따르는 알림이 자세한 문구를 덮지 않는다', async () => {
  const s = sid();
  await ev(s, 'PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'rm -rf build', description: 'Clean build' } });
  assert.equal(card(s).kind, 'decision');
  assert.equal(card(s).message, 'Bash: Clean build');
  await ev(s, 'Notification', { notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash' });
  assert.equal(card(s).message, 'Bash: Clean build');
  assert.equal(permissionText({ tool_name: 'Write', tool_input: { file_path: '/a/b/c.txt' } }), 'Write: c.txt');
  assert.equal(permissionText({ tool_name: 'WebFetch', tool_input: { url: 'https://ex.com/x' } }), 'WebFetch: ex.com');
  assert.equal(permissionText({}), 'permission');
});

test('서브에이전트(agent_id) 훅: 승인 창만 받고 나머지는 카드를 안 바꾼다', async () => {
  const s = sid();
  await ev(s, 'UserPromptSubmit');
  assert.equal(await ev(s, 'Stop', { agent_id: 'a1' }), 'ignored');
  assert.equal(card(s).kind, 'working');
  await ev(s, 'Notification', { agent_id: 'a1', notification_type: 'idle_prompt', message: 'x' });
  assert.equal(card(s).kind, 'working');
  await ev(s, 'PermissionRequest', { agent_id: 'a1', tool_name: 'Edit', tool_input: { file_path: '/x/y.js' } });
  assert.equal(card(s).kind, 'decision');
});

test('SessionEnd → ended 카드(지우지 않음), pid 찾기 없음', async () => {
  const s = sid();
  await ev(s, 'UserPromptSubmit');
  assert.equal(await ev(s, 'SessionEnd', { reason: 'exit' }), 'ended');
  const c = card(s);
  assert.equal(c.kind, 'ended');
  assert.equal(c.pid, undefined);
});

test('잘못된 세션 id 는 무시', async () => {
  for (const bad of ['../evil', 'a/b', '', 'a b', 'x\n']) {
    assert.equal(await ev(bad, 'UserPromptSubmit'), 'ignored');
  }
  assert.ok(!fs.existsSync(path.join(process.env.CLAUDE_OFFICE_HOME, 'evil.json')));
  assert.equal(await handle(null), 'ignored');
  assert.equal(await handle([1]), 'ignored');
  assert.equal(await ev(sid(), 'SomethingNew'), 'ignored');
});

test('실행 파일: 정상 입력은 카드를 쓰고 출력 없이 exit 0', () => {
  const s = sid();
  const r = runHook(JSON.stringify({ session_id: s, hook_event_name: 'UserPromptSubmit', cwd: '/w' }));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, '');
  assert.equal(card(s).kind, 'working');
});

test('실행 파일: 링크 경로로 불려도 동작한다(맥 /tmp → /private/tmp 같은 경우)', (t) => {
  const link = path.join(tmp, 'linked-hook.mjs');
  try {
    fs.symlinkSync(HOOK, link);
  } catch {
    return t.skip('링크를 만들 권한 없음');
  }
  const s = sid();
  const r = spawnSync(process.execPath, [link], { input: JSON.stringify({ session_id: s, hook_event_name: 'Stop', cwd: '/w' }), env: process.env, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(card(s).kind, 'rest');
});

test('실행 파일: 깨진 stdin·빈 입력·이상한 JSON 에도 exit 0, 출력 없음', () => {
  for (const input of ['{broken', '', 'null', '[]', '"x"', '﻿{"session_id":"../x","hook_event_name":"Stop"}']) {
    const r = runHook(input);
    assert.equal(r.status, 0, JSON.stringify(input));
    assert.equal(r.stdout, '', JSON.stringify(input));
    assert.equal(r.stderr, '', JSON.stringify(input));
  }
});

test('주인 찾기(맥·리눅스 ps): Claude 가 먼저, 없으면 node, 나 자신은 제외', () => {
  const ps = [
    '  1     0 Mon Oct 20 05:00:00 2026     /sbin/launchd',
    ' 100     1 Mon Oct 20 05:00:01 2026     /Applications/iTerm.app/Contents/MacOS/iTerm2',
    ' 200   100 Wed Oct 22 10:11:24 2026     /Users/me/.local/bin/claude',
    ' 300   200 Wed Oct 22 10:12:00 2026     /bin/sh',
    ' 400   300 Wed Oct 22 10:12:00 2026     /opt/homebrew/bin/node',
  ].join('\n');
  const t = parsePs(ps);
  assert.deepEqual(t.get(200), { ppid: 100, start: 'Wed Oct 22 10:11:24 2026', comm: '/Users/me/.local/bin/claude' });
  assert.deepEqual(ownerFrom(t, 400, 300), { pid: 200, pidStart: 'Wed Oct 22 10:11:24 2026' });
  // npm 설치(Claude = node) — 조상 중 첫 node
  const t2 = parsePs(ps.replace('/Users/me/.local/bin/claude', '/usr/local/bin/node'));
  assert.equal(ownerFrom(t2, 400, 300).pid, 200);
  // 버전 바이너리
  const t3 = parsePs(ps.replace('/Users/me/.local/bin/claude', '/Users/me/.local/share/claude/versions/2.1.232'));
  assert.equal(ownerFrom(t3, 400, 300).pid, 200);
  // 아무도 없으면 pid 없음
  const t4 = parsePs(ps.replace('/Users/me/.local/bin/claude', '/bin/zsh'));
  assert.deepEqual(ownerFrom(t4, 400, 300), { pid: null, pidStart: null });
});

test('주인 찾기(윈도우): claude.exe → bash.exe → node.exe 체인을 넘어간다', () => {
  const t = parseWinTable(['4 0 System', '900 4 explorer.exe', '1000 900 WindowsTerminal.exe', '1100 1000 claude.exe',
    '1200 1100 bash.exe', '1300 1200 node.exe', ''].join('\r\n'));
  assert.deepEqual(ownerFrom(t, 1300, 1200), { pid: 1100, pidStart: null });
  const t2 = parseWinTable('900 4 Code.exe\n1000 900 node.exe\n1100 1000 powershell.exe\n1300 1100 node.exe\n');
  assert.equal(ownerFrom(t2, 1300, 1100).pid, 1000);
});

test('pid 는 세션당 한 번 — 직전 카드의 살아 있는 pid 를 이어 쓴다', async () => {
  const s = sid();
  fs.mkdirSync(path.dirname(cardPath(s)), { recursive: true });
  fs.writeFileSync(cardPath(s), JSON.stringify({ sessionId: s, kind: 'rest', pid: process.pid, pidStart: 'X' }));
  await ev(s, 'UserPromptSubmit');
  assert.equal(card(s).pid, process.pid);
  assert.equal(card(s).pidStart, 'X');
});
