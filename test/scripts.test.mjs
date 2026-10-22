// 스크립트 통째로 — setup(진짜 설치·서버 시작) → status → start(이미 떠 있음) → 데모 켜고 끄기 → uninstall.
// 진짜 ~/.claude·~/.claude-office 는 건드리지 않는다: 설정·상태 폴더와 포트를 전부 임시로 바꿔 끼운다.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { EVENTS, installedEvents } from '../server/hooks-config.mjs';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'office-scripts-'));

function freePorts(n) {
  // 연속 두 칸(실제·데모)이 비어 있는 포트를 찾는다
  return new Promise((resolve, reject) => {
    const tryOne = (left) => {
      if (!left) return reject(new Error('no free port pair'));
      const a = net.createServer();
      a.listen(0, '127.0.0.1', () => {
        const p = a.address().port;
        const b = net.createServer();
        b.once('error', () => a.close(() => tryOne(left - 1)));
        b.listen(p + 1, '127.0.0.1', () => b.close(() => a.close(() => resolve(p))));
      });
    };
    tryOne(n);
  });
}

const port = await freePorts(20);
const env = {
  ...process.env,
  CLAUDE_CONFIG_DIR: path.join(tmp, 'cfg'),
  CLAUDE_OFFICE_HOME: path.join(tmp, 'home'),
  CLAUDE_OFFICE_PORT: String(port),
};
const run = (script, ...args) => spawnSync(process.execPath, [path.join(REPO, 'scripts', script), ...args], { env, encoding: 'utf8', timeout: 30000 });

test.after(() => {
  run('stop.mjs', '--all'); // 실패한 시험이 서버를 남기지 않게
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('setup → status → start → demo → stop → uninstall', () => {
  const settings = path.join(tmp, 'cfg', 'settings.json');
  let r = run('setup.mjs', '--no-open');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, new RegExp(`127\\.0\\.0\\.1:${port}`));
  assert.deepEqual(installedEvents(settings), EVENTS); // settings.json 이 없어도 새로 만든다
  assert.ok(fs.existsSync(path.join(tmp, 'home', 'config.json')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(tmp, 'home', 'server.pid'), 'utf8')).port, port);

  r = run('setup.mjs', '--no-open'); // 두 번째 — 중복 없이 그대로
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /already there/);
  const hooks = JSON.parse(fs.readFileSync(settings, 'utf8')).hooks;
  for (const ev of EVENTS) assert.equal(hooks[ev].length, 1, ev);

  r = run('status.mjs');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, new RegExp(`${EVENTS.length}/${EVENTS.length}`));
  assert.match(r.stdout, /running/);

  r = run('start.mjs');
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /already running/);

  r = run('start.mjs', '--demo');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, new RegExp(`:${port + 1}/`));
  assert.ok(fs.existsSync(path.join(tmp, 'home', 'server-demo.pid')));

  r = run('stop.mjs', '--demo');
  assert.match(r.stdout, /Demo server stopped/);
  assert.ok(fs.existsSync(path.join(tmp, 'home', 'server.pid'))); // 실제 서버는 그대로

  r = run('uninstall.mjs');
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Server stopped/);
  assert.deepEqual(installedEvents(settings), []);
  assert.ok(!fs.existsSync(path.join(tmp, 'home', 'server.pid')));
  r = run('stop.mjs', '--all');
  assert.match(r.stdout, /not running/);
});
