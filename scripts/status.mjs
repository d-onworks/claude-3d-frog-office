#!/usr/bin/env node
// 진단 — 노드 버전·훅 설치·서버 상태·카드 수·대체 모드로 보이는 세션 수. 아무것도 바꾸지 않는다.
import fs from 'node:fs';
import http from 'node:http';
import { HOOK_FILE, configDir, configFile, officeHome, settingsFile } from '../server/paths.mjs';
import { demoPort, loadConfig, resolvePort } from '../server/config.mjs';
import { EVENTS, isOurs, readSettingsStrict } from '../server/hooks-config.mjs';
import { health, urlOf } from '../server/control.mjs';
import { readCards, recentTranscripts } from '../server/sessions.mjs';
import { MIN_NODE, nodeMajor } from './common.mjs';

const row = (label, value) => console.log(`${label.padEnd(34)} ${value}`);

function officeCount(port) {
  return new Promise((resolve) => {
    http.get({ host: '127.0.0.1', port, path: '/api/office', timeout: 3000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(body).people.length);
        } catch {
          resolve(null);
        }
      });
    }).on('error', () => resolve(null));
  });
}

row('Node.js', `${process.versions.node} ${nodeMajor() >= MIN_NODE ? 'OK' : `(${MIN_NODE}+ 필요 / required)`}`);
row('Claude 설정 폴더 / config dir', configDir());
row('상태 폴더 / office home', officeHome());

// 훅 — 이벤트별로 우리 훅이 있는지, 훅 파일 경로가 지금 저장소를 가리키는지
try {
  const { settings, existed } = readSettingsStrict(settingsFile());
  const hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
  const commands = [];
  const have = EVENTS.filter((ev) => Array.isArray(hooks[ev]) && hooks[ev].some((g) => {
    const mine = g && Array.isArray(g.hooks) ? g.hooks.filter(isOurs) : [];
    commands.push(...mine.map((h) => h.command));
    return mine.length > 0;
  }));
  const missing = EVENTS.filter((ev) => !have.includes(ev));
  row('훅 / hooks', `${have.length}/${EVENTS.length}${existed ? '' : ' (settings.json 없음 / missing)'}${missing.length ? ` — 빠짐 / missing: ${missing.join(', ')}` : ''}`);
  const stale = [...new Set(commands)].filter((c) => !c.replace(/\\/g, '/').includes(HOOK_FILE.replace(/\\/g, '/')));
  if (stale.length) row('  다른 경로를 가리킴 / other path', stale.join(' | '));
} catch (e) {
  row('훅 / hooks', `settings.json 을 못 읽음 / unreadable: ${e.message}`);
}

const cfg = loadConfig();
row('config.json', `${fs.existsSync(configFile()) ? '있음 / found' : '없음, 기본값 / default'} — autoStart ${cfg.autoStart}, lang ${cfg.lang}`);

const port = resolvePort(cfg);
const h = await health(port);
row('서버 / server', h ? `켜짐 / running — ${urlOf(port)} pid ${h.pid} v${h.version}${h.demo ? ' (demo)' : ''}` : `꺼짐 / stopped (port ${port})`);
const dh = await health(demoPort(cfg));
if (dh) row('데모 서버 / demo server', `켜짐 / running — ${urlOf(demoPort(cfg))} pid ${dh.pid}`);

const cards = readCards();
const ended = cards.filter((c) => c.kind === 'ended').length;
row('세션 카드 / session cards', `${cards.length} (끝남 / ended ${ended})`);
const known = new Set(cards.map((c) => c.sessionId));
const fallback = recentTranscripts(cfg.fallbackMinutes).filter((t) => !known.has(t.sessionId)).length;
row(`대체 모드 세션 / transcript-only (${cfg.fallbackMinutes}분/min)`, String(fallback));
if (h) {
  const n = await officeCount(port);
  row('화면의 사람 수 / people on screen', n === null ? '?' : String(n));
}
