// 서버 — Host 검사, 경로조작, '_' 파일, 메서드, /api/* 형식, 데모, 실제 실행(포트 겹침·pid 파일).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createOfficeServer, scanWeb } from '../server/server.mjs';
import { createDemo } from '../server/demo.mjs';

const SERVER = fileURLToPath(new URL('../server/server.mjs', import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'office-server-'));
process.env.CLAUDE_CONFIG_DIR = path.join(tmp, 'cfg');
process.env.CLAUDE_OFFICE_HOME = path.join(tmp, 'home');
fs.mkdirSync(path.join(tmp, 'cfg', 'projects'), { recursive: true });

// 가짜 web/ — 다른 담당의 실제 화면 파일과 무관하게 시험한다
const web = path.join(tmp, 'web');
fs.mkdirSync(path.join(web, 'office'), { recursive: true });
fs.mkdirSync(path.join(web, '_private'), { recursive: true });
fs.writeFileSync(path.join(web, 'index.html'), '<!doctype html><title>t</title>');
fs.writeFileSync(path.join(web, 'app.js'), 'console.log(1)');
fs.writeFileSync(path.join(web, '_orig-office.js'), 'secret');
fs.writeFileSync(path.join(web, '.env'), 'X=1');
fs.writeFileSync(path.join(web, 'notes.unknownext'), 'x');
fs.writeFileSync(path.join(web, 'office', 'frog.webp'), Buffer.from('RIFF0000WEBP'));
fs.writeFileSync(path.join(web, '_private', 'a.js'), 'secret');
fs.writeFileSync(path.join(tmp, 'outside.txt'), 'outside');

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}
function req(port, rawPath, { host, method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: rawPath, method, headers: { Host: host ?? `127.0.0.1:${port}`, ...headers } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
    });
    r.on('error', reject);
    r.end();
  });
}
function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => resolve(p));
    });
  });
}

const fakeSnap = async () => ({ version: 1, now: new Date().toISOString(), hooks: false, demo: false, people: [] });
const server = createOfficeServer({ webDir: web, snapshot: fakeSnap });
let port;
test.before(async () => {
  port = await listen(server);
});
test.after(() => {
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('scanWeb: _·. 로 시작하는 이름과 모르는 확장자는 목록에 없다', () => {
  assert.deepEqual([...scanWeb(web).keys()].sort(), ['/app.js', '/index.html', '/office/frog.webp']);
});

test('Host 검사: 127.0.0.1·localhost·[::1] + 포트만, 나머지 403', async () => {
  for (const h of [`127.0.0.1:${port}`, `localhost:${port}`, `LOCALHOST:${port}`, `[::1]:${port}`]) {
    assert.equal((await req(port, '/', { host: h })).status, 200, h);
  }
  for (const h of ['evil.com', `evil.com:${port}`, '127.0.0.1', `127.0.0.1:${port + 1}`, `localhost.evil.com:${port}`, `0.0.0.0:${port}`]) {
    assert.equal((await req(port, '/api/office', { host: h })).status, 403, h);
  }
});

test('GET 외 405, CORS 헤더 없음', async () => {
  for (const m of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
    const r = await req(port, '/api/office', { method: m });
    assert.equal(r.status, 405, m);
  }
  const r = await req(port, '/api/office', { headers: { Origin: 'http://evil.com' } });
  assert.equal(r.status, 200);
  assert.equal(r.headers['access-control-allow-origin'], undefined);
});

test('정적 파일: 목록에 있는 것만, 경로조작·_ 파일·숨김 파일은 404', async () => {
  const ok = await req(port, '/office/frog.webp');
  assert.equal(ok.status, 200);
  assert.equal(ok.headers['content-type'], 'image/webp');
  assert.equal((await req(port, '/')).headers['content-type'], 'text/html; charset=utf-8');
  assert.equal((await req(port, '/app.js?v=3')).status, 200);
  const etag = ok.headers.etag;
  assert.equal((await req(port, '/office/frog.webp', { headers: { 'If-None-Match': etag } })).status, 304);
  for (const p of ['/../outside.txt', '/%2e%2e/outside.txt', '/%2E%2E%2Foutside.txt', '/office/..%5c..%5coutside.txt',
    '/office\\..\\..\\outside.txt', '/_orig-office.js', '/_private/a.js', '/.env', '/notes.unknownext', '/index.html%00',
    '/%E0%A4%A', '/nope.js', '/office/']) {
    const r = await req(port, p);
    assert.equal(r.status, 404, p);
    assert.ok(!r.body.includes('secret') && !r.body.includes('outside'), p);
  }
});

test('/api/office·/api/config·/api/health 형식', async () => {
  const o = await req(port, '/api/office');
  assert.equal(o.headers['content-type'], 'application/json; charset=utf-8');
  assert.equal(o.headers['cache-control'], 'no-store');
  assert.deepEqual(Object.keys(JSON.parse(o.body)).sort(), ['demo', 'hooks', 'now', 'people', 'version']);
  const c = JSON.parse((await req(port, '/api/config')).body);
  assert.equal(c.lang, 'auto');
  assert.equal(typeof c.version, 'string');
  const h = JSON.parse((await req(port, '/api/health')).body);
  assert.equal(h.ok, true);
  assert.equal(h.app, 'claude-3d-frog-office');
  assert.equal(h.demo, false);
  assert.equal(h.pid, process.pid);
});

test('실제 스냅샷 경로(주입 없음)도 서버에서 돈다', async () => {
  const real = createOfficeServer({ webDir: web });
  const p = await listen(real);
  try {
    const r = await req(p, '/api/office');
    assert.equal(r.status, 200);
    const j = JSON.parse(r.body);
    assert.equal(j.version, 1);
    assert.equal(j.demo, false);
    assert.ok(Array.isArray(j.people));
  } finally {
    real.close();
  }
});

test('스냅샷이 터지면 500 JSON, 서버는 산다', async () => {
  const bad = createOfficeServer({ webDir: web, snapshot: async () => { throw new Error('boom'); } });
  const p = await listen(bad);
  const origError = console.error;
  console.error = () => {};
  try {
    const r = await req(p, '/api/office');
    assert.equal(r.status, 500);
    assert.deepEqual(JSON.parse(r.body), { error: 'snapshot failed' });
    assert.equal((await req(p, '/api/health')).status, 200);
  } finally {
    console.error = origError;
    bad.close();
  }
});

test('데모: 6~8명, 승인 대기·꼬마·서브에이전트·서버실 1명, demo:true', async () => {
  const demo = createOfficeServer({ webDir: web, demo: true });
  const p = await listen(demo);
  try {
    const j = JSON.parse((await req(p, '/api/office')).body);
    assert.equal(j.demo, true);
    assert.ok(j.people.length >= 6 && j.people.length <= 8);
    assert.equal(new Set(j.people.map((x) => x.name)).size, j.people.length);
    assert.ok(j.people.some((x) => x.status === 'decision' && x.ask && x.pending === 1));
    assert.ok(j.people.some((x) => x.kid));
    assert.ok(j.people.some((x) => x.subCount > 0 && x.subs.length === x.subCount));
    assert.equal(j.people.filter((x) => x.home === 'server').length, 1);
    assert.equal(JSON.parse((await req(p, '/api/health')).body).demo, true);
  } finally {
    demo.close();
  }
});

test('데모: 시간이 가면 상태가 바뀌고 로그가 자란다', () => {
  const t0 = Date.parse('2026-10-22T00:00:00Z');
  const snap = createDemo(7, t0);
  const a = snap(t0);
  const b = snap(t0 + 120000);
  const statuses = (s) => s.people.map((x) => x.status).join();
  assert.notEqual(statuses(a), statuses(b));
  const lastAt = (s) => s.people.map((x) => x.log.at(-1).at).sort().at(-1);
  assert.ok(lastAt(b) > lastAt(a));
  for (const x of b.people) assert.ok(x.log.length <= 8);
});

test('실행: pid 파일, 같은 포트 두 번째는 "이미 떠 있음" 0, 남의 포트면 1, 끄면 pid 파일 정리', async () => {
  const p = await freePort();
  const env = { ...process.env };
  const child = spawn(process.execPath, [SERVER, '--port', String(p)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => {
      child.stdout.on('data', (d) => { if (String(d).includes('listening')) resolve(); });
      child.on('exit', (c) => reject(new Error(`exit ${c}`)));
    });
    const pidFile = path.join(process.env.CLAUDE_OFFICE_HOME, 'server.pid');
    assert.equal(JSON.parse(fs.readFileSync(pidFile, 'utf8')).pid, child.pid);
    const again = spawnSync(process.execPath, [SERVER, '--port', String(p)], { env, encoding: 'utf8', timeout: 15000 });
    assert.equal(again.status, 0);
    assert.match(again.stdout, /already running/);
    assert.equal(JSON.parse(fs.readFileSync(pidFile, 'utf8')).pid, child.pid); // 남의 기록을 지우지 않는다

    const foreign = http.createServer((q, s) => s.end('hi'));
    const fp = await listen(foreign);
    const clash = spawnSync(process.execPath, [SERVER, '--port', String(fp)], { env, encoding: 'utf8', timeout: 15000 });
    foreign.close();
    assert.equal(clash.status, 1);
    assert.match(clash.stderr, /used by another program/);

    const exited = new Promise((resolve) => child.on('exit', resolve));
    child.kill('SIGTERM');
    await exited;
    if (process.platform !== 'win32') assert.ok(!fs.existsSync(pidFile)); // 윈도우 kill 은 종료 처리기를 안 부른다
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
  }
});
