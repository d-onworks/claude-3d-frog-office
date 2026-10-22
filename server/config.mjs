// 설정(config.json) 읽기 — 없거나 깨져도 기본값으로 선다. 손으로 고친 이상한 값은 기본값으로 닫는다.
import fs from 'node:fs';
import path from 'node:path';
import { REPO_DIR, configFile } from './paths.mjs';

export const DEFAULT_PORT = 4777;
export const DEFAULTS = Object.freeze({
  port: DEFAULT_PORT,
  autoStart: true,
  homes: {},
  hide: [],
  fallbackMinutes: 20,
  staleHours: 6,
  kidCommits: 50,
  lang: 'auto',
});

export const VERSION = (() => {
  try {
    return String(JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'package.json'), 'utf8')).version || '0.0.0');
  } catch {
    return '0.0.0';
  }
})();

const num = (v, lo, hi, def) => (Number.isFinite(v) && v >= lo && v <= hi ? v : def);
const plainObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

/** 읽은 값 → 검증된 설정. 모르는 키는 버린다. */
export function normalizeConfig(raw) {
  const c = plainObj(raw) ? raw : {};
  const homes = {};
  if (plainObj(c.homes)) {
    for (const [k, v] of Object.entries(c.homes)) if (typeof v === 'string') homes[k] = v;
  }
  return {
    port: Number.isInteger(c.port) ? num(c.port, 1, 65535, DEFAULT_PORT) : DEFAULT_PORT,
    autoStart: c.autoStart !== false,
    homes,
    hide: Array.isArray(c.hide) ? c.hide.filter((x) => typeof x === 'string' && x) : [],
    fallbackMinutes: num(c.fallbackMinutes, 0, 24 * 60, DEFAULTS.fallbackMinutes),
    staleHours: num(c.staleHours, 0.05, 24 * 30, DEFAULTS.staleHours),
    kidCommits: num(c.kidCommits, 0, 1e9, DEFAULTS.kidCommits),
    lang: ['auto', 'ko', 'en'].includes(c.lang) ? c.lang : 'auto',
  };
}

let cache = null; // { file, mtimeMs, cfg } — 폴링마다 파일을 다시 파싱하지 않게

export function loadConfig() {
  const file = configFile();
  let mtimeMs = -1;
  try {
    mtimeMs = fs.statSync(file).mtimeMs;
  } catch {
    /* 없음 = 기본값 */
  }
  if (cache && cache.file === file && cache.mtimeMs === mtimeMs) return cache.cfg;
  let raw = {};
  if (mtimeMs >= 0) {
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    } catch {
      raw = {};
    }
  }
  const cfg = normalizeConfig(raw);
  cache = { file, mtimeMs, cfg };
  return cfg;
}

/** 포트 — 환경변수 CLAUDE_OFFICE_PORT 가 설정보다 우선 */
export function resolvePort(cfg = loadConfig()) {
  const env = Number(process.env.CLAUDE_OFFICE_PORT);
  if (Number.isInteger(env) && env >= 1 && env <= 65535) return env;
  return cfg.port;
}

/** 데모 서버 포트 — 실제 서버와 헷갈리지 않게 한 칸 옆 */
export function demoPort(cfg = loadConfig()) {
  const p = resolvePort(cfg);
  return p >= 65535 ? p - 1 : p + 1;
}

/** setup 이 처음 만들어 두는 config.json 내용 */
export function defaultConfigText() {
  const { port, autoStart, homes, hide, fallbackMinutes, staleHours, kidCommits, lang } = DEFAULTS;
  return JSON.stringify({ port, autoStart, homes, hide, fallbackMinutes, staleHours, kidCommits, lang }, null, 2) + '\n';
}
