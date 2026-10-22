#!/usr/bin/env node
// 제거 — 우리 훅만 지우고(남의 훅 보존) 서버를 끈다. --purge 면 상태 폴더도 지운다.
// 사용법: node scripts/uninstall.mjs [--purge]
import fs from 'node:fs';
import path from 'node:path';
import { officeHome, settingsFile } from '../server/paths.mjs';
import { readSettingsStrict, uninstallHooks, writeSettings } from '../server/hooks-config.mjs';
import { stopServer } from '../server/control.mjs';
import { has, say } from './common.mjs';

// 상태 폴더에 우리가 만드는 것만 있을 때만 지운다 — CLAUDE_OFFICE_HOME 을 엉뚱한 곳으로 둔 경우 보호
const OURS = new Set(['sessions', 'config.json', 'server.pid', 'server-demo.pid', 'server.log', 'server.log.old', 'server.starting']);

/** 지워도 되는 폴더인가 — 모르는 파일이 있으면 그 목록을 돌려준다 */
function purgeBlockers(home) {
  let names;
  try {
    names = fs.readdirSync(home);
  } catch {
    return [];
  }
  const odd = names.filter((n) => !OURS.has(n));
  try {
    for (const n of fs.readdirSync(path.join(home, 'sessions'))) {
      if (!/\.(json|tmp)$/.test(n)) odd.push(`sessions/${n}`);
    }
  } catch {
    /* sessions 없음 */
  }
  return odd;
}

let code = 0;
const file = settingsFile();
try {
  const { settings, existed } = readSettingsStrict(file);
  const r = existed ? uninstallHooks(settings) : { removed: 0 };
  if (r.removed) {
    const backup = writeSettings(file, r.settings);
    say(`훅 ${r.removed}개를 지웠습니다(다른 훅은 그대로). 백업: ${backup}`, `Removed ${r.removed} hooks (other hooks kept). Backup: ${backup}`);
  } else {
    say('지울 훅이 없습니다.', 'No hooks of ours were found.');
  }
} catch (e) {
  code = 1;
  say(`${e.message}\n→ settings.json 은 건드리지 않았습니다.`, '→ settings.json was not touched.');
}

for (const demo of [false, true]) {
  const r = await stopServer({ demo });
  if (r.stopped) say(`${demo ? '데모 ' : ''}서버를 껐습니다(pid ${r.pid}).`, `${demo ? 'Demo server' : 'Server'} stopped (pid ${r.pid}).`);
}

if (has('--purge')) {
  const home = officeHome();
  const odd = purgeBlockers(home);
  if (odd.length) {
    code = 1;
    say(`${home} 에 모르는 파일이 있어 지우지 않았습니다: ${odd.slice(0, 5).join(', ')}`,
      `Did not delete ${home} because it holds files we did not create: ${odd.slice(0, 5).join(', ')}`);
  } else if (fs.existsSync(home)) {
    fs.rmSync(home, { recursive: true, force: true });
    say(`상태 폴더를 지웠습니다: ${home}`, `Deleted ${home}`);
  }
}
say('저장소 폴더는 직접 지우시면 됩니다.', 'You can delete this repository folder yourself.');
process.exit(code);
