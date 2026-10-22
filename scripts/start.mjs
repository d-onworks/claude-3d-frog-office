#!/usr/bin/env node
// 서버를 백그라운드로 켠다. 사용법: node scripts/start.mjs [--open] [--demo]
// --demo 는 가짜 사람들로 도는 데모 서버 — 실제 서버와 헷갈리지 않게 포트 한 칸 옆(기본 4778)에 뜬다.
import { logFile } from '../server/paths.mjs';
import { demoPort, resolvePort } from '../server/config.mjs';
import { health, openBrowser, portBusy, startDetached, urlOf, waitHealth } from '../server/control.mjs';
import { fail, has, requireNode, say } from './common.mjs';

requireNode();
const demo = has('--demo');
const port = demo ? demoPort() : resolvePort();
const url = urlOf(port);
const label = demo ? '데모 서버' : '서버';
const labelEn = demo ? 'Demo server' : 'Server';

let h = await health(port);
if (h) {
  if (!!h.demo !== demo) {
    fail(`포트 ${port} 에 ${h.demo ? '데모' : '실제'} 서버가 이미 떠 있습니다. 먼저 끄세요: npm run stop${h.demo ? ' -- --demo' : ''}`,
      `A ${h.demo ? 'demo' : 'real'} server is already on port ${port}. Stop it first: npm run stop${h.demo ? ' -- --demo' : ''}`);
  }
  say(`${label}가 이미 떠 있습니다: ${url}`, `${labelEn} is already running: ${url}`);
} else {
  if (await portBusy(port)) {
    fail(`포트 ${port} 를 다른 프로그램이 쓰고 있습니다. config.json 의 "port" 나 CLAUDE_OFFICE_PORT 로 바꾸세요.`,
      `Port ${port} is used by another program. Change "port" in config.json or set CLAUDE_OFFICE_PORT.`);
  }
  startDetached({ demo, port: demo ? port : null });
  h = await waitHealth(port, 8000);
  if (!h) fail(`${label}가 8초 안에 응답하지 않았습니다. 로그: ${logFile()}`, `${labelEn} did not answer within 8 seconds. Log: ${logFile()}`);
  say(`${label}를 켰습니다: ${url}${demo ? ' (끄기: npm run stop -- --demo)' : ''}`,
    `${labelEn} started: ${url}${demo ? ' (stop: npm run stop -- --demo)' : ''}`);
}
if (has('--open')) openBrowser(url);
