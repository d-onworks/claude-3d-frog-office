// 훅 설치·제거 — 남의 훅 보존, 중복 설치 안 함, 깨진 JSON 이면 중단하고 원본 그대로.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EVENTS, buildCommand, installHooks, installedEvents, readSettingsStrict, uninstallHooks, writeSettings } from '../server/hooks-config.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'office-install-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const OTHER = { type: 'command', command: 'python3 ~/other/hook.py', timeout: 5 };
const withOthers = () => ({
  model: 'x',
  hooks: {
    Stop: [{ hooks: [OTHER] }],
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'guard.sh' }] }],
  },
});

function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}
let envN = 0;
async function scratchEnv() {
  const base = path.join(tmp, `e${++envN}`);
  fs.mkdirSync(path.join(base, 'cfg'), { recursive: true });
  return {
    base,
    env: { ...process.env, CLAUDE_CONFIG_DIR: path.join(base, 'cfg'), CLAUDE_OFFICE_HOME: path.join(base, 'home'), CLAUDE_OFFICE_PORT: String(await freePort()) },
  };
}
const run = (script, args, env) => spawnSync(process.execPath, [path.join(REPO, 'scripts', script), ...args], { env, encoding: 'utf8', timeout: 30000 });

test('buildCommand: 공백 없는 node 는 절대경로, 있으면 node, 스크립트는 슬래시 + 큰따옴표', () => {
  assert.equal(buildCommand('/opt/homebrew/bin/node', '/Users/me/claude-3d-frog-office/hooks/office-hook.mjs'),
    '/opt/homebrew/bin/node "/Users/me/claude-3d-frog-office/hooks/office-hook.mjs"');
  assert.equal(buildCommand('C:\\Program Files\\nodejs\\node.exe', 'C:\\Users\\me\\claude-3d-frog-office\\hooks\\office-hook.mjs'),
    'node "C:/Users/me/claude-3d-frog-office/hooks/office-hook.mjs"');
  assert.equal(buildCommand('C:\\nvm\\node.exe', 'D:\\x\\hooks\\office-hook.mjs'), 'C:/nvm/node.exe "D:/x/hooks/office-hook.mjs"');
  assert.ok(!buildCommand().startsWith('"')); // PowerShell 은 따옴표로 시작하는 명령을 실행 못 한다
});

test('installHooks: 이벤트 7개를 추가하고 남의 훅은 그대로', () => {
  const before = withOthers();
  const r = installHooks(before, 'node "/x/office-hook.mjs"');
  assert.deepEqual(r.added, EVENTS);
  assert.equal(r.changed, true);
  assert.deepEqual(before, withOthers()); // 원본 객체는 안 바뀐다
  assert.equal(r.settings.model, 'x');
  assert.deepEqual(r.settings.hooks.Stop[0], { hooks: [OTHER] });
  assert.deepEqual(r.settings.hooks.Stop[1], { hooks: [{ type: 'command', command: 'node "/x/office-hook.mjs"', timeout: 10 }] });
  assert.deepEqual(r.settings.hooks.PreToolUse, withOthers().hooks.PreToolUse);
  assert.ok(!('matcher' in r.settings.hooks.PermissionRequest[0])); // 매처 없이
  assert.ok(!('StopFailure' in r.settings.hooks) && !('PostCompact' in r.settings.hooks));
});

test('installHooks: 두 번 깔아도 중복 없음, 저장소를 옮기면 명령만 고침', () => {
  const once = installHooks({}, 'node "/a/office-hook.mjs"').settings;
  const twice = installHooks(once, 'node "/a/office-hook.mjs"');
  assert.equal(twice.changed, false);
  assert.deepEqual(twice.skipped, EVENTS);
  for (const ev of EVENTS) assert.equal(twice.settings.hooks[ev].length, 1);
  const moved = installHooks(once, 'node "/b/office-hook.mjs"');
  assert.deepEqual(moved.updated, EVENTS);
  assert.equal(moved.settings.hooks.Stop[0].hooks[0].command, 'node "/b/office-hook.mjs"');
  assert.equal(moved.settings.hooks.Stop.length, 1);
});

test('uninstallHooks: 우리 것만 지우고 빈 묶음·이벤트는 정리', () => {
  const installed = installHooks(withOthers(), 'node "/x/office-hook.mjs"').settings;
  installed.hooks.Notification.push({ hooks: [OTHER, { type: 'command', command: 'node "/old/office-hook.mjs"' }] });
  const r = uninstallHooks(installed);
  assert.equal(r.removed, EVENTS.length + 1);
  assert.deepEqual(r.settings.hooks.Stop, [{ hooks: [OTHER] }]);
  assert.deepEqual(r.settings.hooks.Notification, [{ hooks: [OTHER] }]);
  assert.deepEqual(r.settings.hooks.PreToolUse, withOthers().hooks.PreToolUse);
  assert.ok(!('SessionEnd' in r.settings.hooks));
  assert.deepEqual(uninstallHooks(installHooks({}, 'node "/x/office-hook.mjs"').settings).settings, {});
  assert.equal(uninstallHooks({ a: 1 }).removed, 0);
});

test('readSettingsStrict: 없음·빈 파일·BOM 은 받고, 깨진 JSON·이상한 모양은 거절', () => {
  const f = path.join(tmp, 'settings-read.json');
  assert.deepEqual(readSettingsStrict(f), { settings: {}, existed: false });
  fs.writeFileSync(f, '  \n');
  assert.deepEqual(readSettingsStrict(f).settings, {});
  fs.writeFileSync(f, '\uFEFF{"a":1}');
  assert.deepEqual(readSettingsStrict(f).settings, { a: 1 });
  for (const bad of ['{"a":1,}', '// c\n{}', '[1]', '"x"', '{"hooks":[]}', '{"hooks":{"Stop":{}}}']) {
    fs.writeFileSync(f, bad);
    assert.throws(() => readSettingsStrict(f), undefined, bad);
  }
});

test('writeSettings: 백업을 남기고 원자적으로 쓴다', () => {
  const dir = path.join(tmp, 'w');
  const f = path.join(dir, 'settings.json');
  assert.equal(writeSettings(f, { a: 1 }), null); // 없던 파일은 새로 만든다
  const backup = writeSettings(f, { a: 2 });
  assert.match(path.basename(backup), /^settings\.json\.bak-office-\d{8}-\d{6}$/);
  assert.deepEqual(JSON.parse(fs.readFileSync(backup, 'utf8')), { a: 1 });
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), { a: 2 });
  assert.ok(!fs.readdirSync(dir).some((n) => n.endsWith('.tmp')));
});

test('setup.mjs: 깨진 settings.json 이면 중단하고 원본 그대로', async () => {
  const { base, env } = await scratchEnv();
  const f = path.join(base, 'cfg', 'settings.json');
  const broken = '{ "hooks": { "Stop": [ }';
  fs.writeFileSync(f, broken);
  for (const args of [['--dry-run'], ['--no-open']]) {
    const r = run('setup.mjs', args, env);
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.equal(fs.readFileSync(f, 'utf8'), broken);
    assert.deepEqual(fs.readdirSync(path.join(base, 'cfg')), ['settings.json']); // 백업도 안 만든다
  }
  assert.ok(!fs.existsSync(path.join(base, 'home', 'config.json')));
});

test('setup.mjs --dry-run: 아무것도 안 바꾸고 계획만 보여 준다', async () => {
  const { base, env } = await scratchEnv();
  const f = path.join(base, 'cfg', 'settings.json');
  fs.writeFileSync(f, JSON.stringify(withOthers()));
  const r = run('setup.mjs', ['--dry-run'], env);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /add: SessionStart, UserPromptSubmit/);
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), withOthers());
  assert.ok(!fs.existsSync(path.join(base, 'home')));
});

test('uninstall.mjs: 우리 훅만 지우고, --purge 는 우리 파일만 있는 폴더만 지운다', async () => {
  const { base, env } = await scratchEnv();
  const f = path.join(base, 'cfg', 'settings.json');
  fs.writeFileSync(f, JSON.stringify(installHooks(withOthers(), 'node "/x/office-hook.mjs"').settings));
  const home = env.CLAUDE_OFFICE_HOME;
  fs.mkdirSync(path.join(home, 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(home, 'sessions', 'a.json'), '{}');
  fs.writeFileSync(path.join(home, 'notes.txt'), 'mine'); // 모르는 파일
  let r = run('uninstall.mjs', ['--purge'], env);
  assert.equal(r.status, 1, r.stdout + r.stderr); // 모르는 파일이 있어 지우지 않았다
  assert.deepEqual(installedEvents(f), []);
  const after = JSON.parse(fs.readFileSync(f, 'utf8'));
  assert.deepEqual(after.hooks.Stop, [{ hooks: [OTHER] }]);
  assert.ok(fs.readdirSync(path.join(base, 'cfg')).some((n) => n.startsWith('settings.json.bak-office-')));
  assert.ok(fs.existsSync(path.join(home, 'notes.txt')));
  fs.renameSync(path.join(home, 'notes.txt'), path.join(base, 'notes.txt'));
  r = run('uninstall.mjs', ['--purge'], env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(!fs.existsSync(home));
  assert.deepEqual(JSON.parse(fs.readFileSync(f, 'utf8')), after); // 두 번째엔 settings 를 안 건드린다
});
