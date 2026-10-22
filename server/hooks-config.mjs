// settings.json 의 우리 훅 설치·제거. 남의 훅은 절대 건드리지 않는다.
// 우리 훅 식별 = command 에 'office-hook.mjs' 가 들어 있음.
import fs from 'node:fs';
import path from 'node:path';
import { HOOK_FILE, IS_WIN } from './paths.mjs';

// 오래된 이벤트만 — 옛 버전 Claude 가 모르는 이벤트 키가 있으면 설정 검증이 깨질 수 있다
export const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreCompact', 'Notification', 'PermissionRequest', 'Stop', 'SessionEnd'];
export const MARK = 'office-hook.mjs';
export const HOOK_TIMEOUT = 10;

export const isOurs = (h) => !!h && typeof h.command === 'string' && h.command.includes(MARK);
const plainObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * 훅 명령 — 맥·리눅스 sh, 윈도우 Git Bash(없으면 PowerShell) 어디서 돌아도 되게.
 * node 경로에 공백이 없으면 절대경로(따옴표 없이 — PowerShell 은 따옴표로 시작하는 명령을 실행 못 한다),
 * 있으면 'node'. 경로의 역슬래시는 bash 가 먹으므로 슬래시로 바꾼다.
 */
export function buildCommand(nodePath = process.execPath, hookPath = HOOK_FILE) {
  const slash = (p) => String(p).replace(/\\/g, '/');
  const node = /\s/.test(nodePath) ? 'node' : slash(nodePath);
  return `${node} "${slash(hookPath)}"`;
}

/** 엄격 JSON 으로 읽기. 없으면 {}(새로 만든다), 못 읽으면 throw — 덮어쓰지 않게 */
export function readSettingsStrict(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { settings: {}, existed: false };
    throw new Error(`settings.json 을 읽지 못했습니다 / cannot read settings.json: ${e.message}`);
  }
  if (!text.replace(/^﻿/, '').trim()) return { settings: {}, existed: true };
  let parsed;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ''));
  } catch (e) {
    throw new Error(`settings.json 이 올바른 JSON 이 아닙니다 / settings.json is not valid JSON: ${e.message}`);
  }
  if (!plainObj(parsed)) throw new Error('settings.json 최상위가 객체가 아닙니다 / settings.json top level is not an object');
  if (parsed.hooks !== undefined && !plainObj(parsed.hooks)) {
    throw new Error('settings.json 의 "hooks" 가 객체가 아닙니다 / "hooks" is not an object');
  }
  for (const ev of EVENTS) {
    const arr = parsed.hooks && parsed.hooks[ev];
    if (arr !== undefined && !Array.isArray(arr)) {
      throw new Error(`settings.json 의 hooks.${ev} 가 배열이 아닙니다 / hooks.${ev} is not an array`);
    }
  }
  return { settings: parsed, existed: true };
}

/** 이벤트마다 우리 훅을 추가(이미 있으면 건너뜀, 경로가 바뀌었으면 명령만 고침). 원본은 안 바꾼다 */
export function installHooks(settings, command) {
  const out = structuredClone(settings);
  if (!plainObj(out.hooks)) out.hooks = {};
  const added = [];
  const updated = [];
  const skipped = [];
  for (const ev of EVENTS) {
    const groups = Array.isArray(out.hooks[ev]) ? out.hooks[ev] : (out.hooks[ev] = []);
    const mine = groups.flatMap((g) => (plainObj(g) && Array.isArray(g.hooks) ? g.hooks.filter(isOurs) : []));
    if (!mine.length) {
      groups.push({ hooks: [{ type: 'command', command, timeout: HOOK_TIMEOUT }] });
      added.push(ev);
    } else if (mine.some((h) => h.command !== command)) {
      for (const h of mine) h.command = command; // 저장소를 옮긴 경우 — 옛 경로는 깨진 훅이 된다
      updated.push(ev);
    } else {
      skipped.push(ev);
    }
  }
  return { settings: out, added, updated, skipped, changed: added.length + updated.length > 0 };
}

/** 우리 훅만 지운다. 우리 훅만 들어 있던 묶음·이벤트는 함께 비운다 */
export function uninstallHooks(settings) {
  const out = structuredClone(settings);
  let removed = 0;
  if (!plainObj(out.hooks)) return { settings: out, removed };
  for (const ev of Object.keys(out.hooks)) {
    const groups = out.hooks[ev];
    if (!Array.isArray(groups)) continue;
    let touched = false;
    const kept = [];
    for (const g of groups) {
      if (plainObj(g) && Array.isArray(g.hooks) && g.hooks.some(isOurs)) {
        const rest = g.hooks.filter((h) => !isOurs(h));
        removed += g.hooks.length - rest.length;
        touched = true;
        if (rest.length) kept.push({ ...g, hooks: rest });
      } else {
        kept.push(g);
      }
    }
    if (!touched) continue;
    if (kept.length) out.hooks[ev] = kept;
    else delete out.hooks[ev];
  }
  if (removed && !Object.keys(out.hooks).length) delete out.hooks;
  return { settings: out, removed };
}

/** 이벤트별로 우리 훅이 깔려 있나 — 읽기만, 실패는 빈 결과 */
export function installedEvents(file) {
  try {
    const { settings } = readSettingsStrict(file);
    const hooks = plainObj(settings.hooks) ? settings.hooks : {};
    return EVENTS.filter((ev) => Array.isArray(hooks[ev]) && hooks[ev].some((g) => plainObj(g) && Array.isArray(g.hooks) && g.hooks.some(isOurs)));
  } catch {
    return [];
  }
}

const pad = (n) => String(n).padStart(2, '0');
export function backupName(file, d = new Date()) {
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `${file}.bak-office-${stamp}`;
}

/** 백업 후 원자적 쓰기(tmp → rename). 백업 경로를 돌려준다(원본이 없었으면 null) */
export function writeSettings(file, settings) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let backup = null;
  let mode = 0o600; // 새로 만들 때 — settings.json 에는 env 비밀값이 들어 있기도 하다
  if (fs.existsSync(file)) {
    backup = backupName(file);
    fs.copyFileSync(file, backup);
    mode = fs.statSync(file).mode & 0o777; // 원래 권한 그대로
  }
  const tmp = `${file}.office-${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(settings, null, 2) + '\n');
  if (!IS_WIN) fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, file);
  return backup;
}
