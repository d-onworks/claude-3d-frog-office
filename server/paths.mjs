// 경로 모음 — 환경변수는 부를 때마다 다시 읽는다(시험이 폴더를 바꿔 끼울 수 있게).
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const IS_WIN = process.platform === 'win32';
export const REPO_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const WEB_DIR = path.join(REPO_DIR, 'web');
export const HOOK_FILE = path.join(REPO_DIR, 'hooks', 'office-hook.mjs');
export const SERVER_FILE = path.join(REPO_DIR, 'server', 'server.mjs');

/** Claude 설정 폴더 — CLAUDE_CONFIG_DIR 우선, 없으면 ~/.claude */
export function configDir() {
  return path.resolve(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'));
}

/** 우리 상태 폴더 — CLAUDE_OFFICE_HOME 우선, 없으면 ~/.claude-office */
export function officeHome() {
  return path.resolve(process.env.CLAUDE_OFFICE_HOME || path.join(os.homedir(), '.claude-office'));
}

export const sessionsDir = () => path.join(officeHome(), 'sessions');
export const configFile = () => path.join(officeHome(), 'config.json');
export const logFile = () => path.join(officeHome(), 'server.log');
export const startingLock = () => path.join(officeHome(), 'server.starting');
/** 데모 서버는 pid 파일을 따로 쓴다 — 실제 서버 기록을 덮지 않게 */
export const pidFile = (demo = false) => path.join(officeHome(), demo ? 'server-demo.pid' : 'server.pid');
export const projectsDir = () => path.join(configDir(), 'projects');
export const settingsFile = () => path.join(configDir(), 'settings.json');

/** Claude Code 가 대화 폴더 이름을 만드는 규칙 — 영숫자가 아닌 글자는 전부 '-' */
export function encodeCwd(cwd) {
  return String(cwd || '').replace(/[^A-Za-z0-9]/g, '-');
}

/** 경로 비교용 키 — 윈도우는 대소문자를 가리지 않는다 */
export function pathKey(p) {
  const r = path.resolve(String(p || ''));
  return IS_WIN ? r.toLowerCase() : r;
}

/** 'C:\a\b.txt' 도 '/a/b.txt' 도 마지막 토막 — 대화 기록엔 다른 OS 경로가 섞일 수 있다 */
export function baseName(p) {
  const parts = String(p || '').split(/[\\/]+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
}
