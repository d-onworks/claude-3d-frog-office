// 생존 판정 — 세션 카드의 주인(Claude 프로세스)이 아직 도는가.
// pid 번호는 재사용되지만 시작시각까지 같을 수는 없다 — 맥·리눅스는 ps 시작시각(lstart)까지 맞춘다.
import { execFileSync } from 'node:child_process';
import { IS_WIN } from './paths.mjs';

const STARTS_TTL_MS = 2000; // 폴링이 몰려도 ps 는 2초에 한 번

let startsCache = { at: 0, value: null };

export function forget() {
  startsCache = { at: 0, value: null };
}

/** 'pid lstart' 줄들 → Map(pid → 시작시각). 자릿수 맞춤 공백은 접어 훅이 적은 모양과 맞춘다 */
export function parseStarts(text) {
  const map = new Map();
  for (const line of String(text).split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(.+)$/);
    if (m) map.set(Number(m[1]), m[2].split(/\s+/).join(' '));
  }
  return map;
}

/**
 * 살아 있는 프로세스의 pid → 시작시각. 실패하면 null(=판정 불가).
 * 빈 Map 이 아니라 null 인 이유: ps 가 한 번 실패한 순간 살아 있는 세션이 전부 '꺼짐'으로 뒤집히지 않게.
 * LC_ALL=C 고정 필수 — lstart 는 로케일을 탄다. 한글 환경에서 뜬 훅과 영어 환경의 서버가
 * 서로 다른 문자열을 적어, 살아 있는 세션이 전부 꺼짐으로 판정된 실사고가 원본에 있다.
 */
export function processStarts(now = Date.now()) {
  if (IS_WIN) return null; // 윈도우는 kill(pid, 0) 만 쓴다
  if (now - startsCache.at < STARTS_TTL_MS) return startsCache.value;
  let value = null;
  try {
    const out = execFileSync('ps', ['-eo', 'pid=,lstart='], {
      encoding: 'utf8',
      timeout: 2000,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, LC_ALL: 'C' },
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    value = parseStarts(out);
  } catch {
    value = null;
  }
  startsCache = { at: now, value };
  return value;
}

/** process.kill(pid, 0) — EPERM 은 '있지만 남의 것' 이라 살아 있음 */
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e && e.code === 'EPERM';
  }
}

/**
 * 카드가 살아 있나.
 * - pid 있음: 맥·리눅스는 ps 표에서 pid+시작시각 대조(ps 실패면 kill 0), 윈도우는 kill 0.
 * - pid 없음: max(카드 updatedAt, 대화 파일 mtime) 이 staleHours 안.
 */
export function cardAlive(card, { starts, now = Date.now(), transcriptMtimeMs = 0, staleHours = 6 } = {}) {
  const pid = card.pid;
  if (Number.isInteger(pid) && pid > 0) {
    if (starts instanceof Map) {
      if (!starts.has(pid)) return false;
      return typeof card.pidStart === 'string' ? starts.get(pid) === card.pidStart.split(/\s+/).join(' ') : true;
    }
    return pidAlive(pid);
  }
  const wrote = Date.parse(String(card.updatedAt || '')) || 0;
  return now - Math.max(wrote, transcriptMtimeMs || 0) < staleHours * 3600 * 1000;
}
