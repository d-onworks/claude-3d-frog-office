#!/usr/bin/env node
// 서버 끄기. 사용법: node scripts/stop.mjs [--demo | --all]  (기본은 실제 서버만)
import { stopServer } from '../server/control.mjs';
import { has, say } from './common.mjs';

const targets = has('--all') ? [false, true] : has('--demo') ? [true] : [false];
for (const demo of targets) {
  const r = await stopServer({ demo });
  const ko = demo ? '데모 서버' : '서버';
  const en = demo ? 'Demo server' : 'Server';
  if (r.stopped) say(`${ko}를 껐습니다(pid ${r.pid}, 포트 ${r.port}).`, `${en} stopped (pid ${r.pid}, port ${r.port}).`);
  else say(`${ko}가 떠 있지 않습니다${r.stale ? '(낡은 pid 파일을 치웠습니다)' : ''}.`, `${en} is not running${r.stale ? ' (removed a stale pid file)' : ''}.`);
}
