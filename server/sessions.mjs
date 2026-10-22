// 세션 카드(훅이 쓴 것) 읽기·청소, 대화 파일 찾기, 대화 기록 대체 모드용 최근 대화 찾기.
import fs from 'node:fs';
import path from 'node:path';
import { encodeCwd, projectsDir, sessionsDir } from './paths.mjs';

export const SID_RE = /^[A-Za-z0-9._-]+$/;
const DAY_MS = 24 * 3600 * 1000;
export const CARD_MAX_AGE_MS = 7 * DAY_MS; // 7일 넘은 카드 파일은 치운다
export const ENDED_MAX_AGE_MS = DAY_MS; // 끝난(ended) 카드는 하루 뒤 치운다
const SCAN_TTL_MS = 5000; // 대화 폴더 훑기는 5초에 한 번 — 실측 2,700개 파일
const FIND_TTL_MS = 60 * 1000;

let scanCache = { key: '', at: 0, value: [] };
const findCache = new Map(); // sid → { at, file }

export function forget() {
  scanCache = { key: '', at: 0, value: [] };
  findCache.clear();
}

/** sessions/*.json → 카드 목록. 깨진 파일·이상한 이름은 건너뛴다 */
export function readCards() {
  const dir = sessionsDir();
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const cards = [];
  for (const n of names) {
    if (!n.endsWith('.json')) continue; // 쓰다 만 .tmp 는 무시
    const sid = n.slice(0, -5);
    if (!SID_RE.test(sid)) continue;
    let card;
    try {
      card = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));
    } catch {
      continue;
    }
    if (!card || typeof card !== 'object' || Array.isArray(card)) continue;
    cards.push({ ...card, sessionId: sid });
  }
  return cards;
}

/** 오래된 카드 치우기 — 7일 넘은 파일, 하루 넘은 ended 카드, 버려진 .tmp */
export function cleanupCards(now = Date.now()) {
  const dir = sessionsDir();
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const n of names) {
    const f = path.join(dir, n);
    try {
      const st = fs.statSync(f);
      if (!st.isFile()) continue;
      let drop = now - st.mtimeMs > CARD_MAX_AGE_MS || (n.endsWith('.tmp') && now - st.mtimeMs > 60 * 1000);
      if (!drop && n.endsWith('.json')) {
        const card = JSON.parse(fs.readFileSync(f, 'utf8'));
        const at = Date.parse(String(card && card.updatedAt)) || st.mtimeMs;
        drop = card && card.kind === 'ended' && now - at > ENDED_MAX_AGE_MS;
      }
      if (drop) {
        fs.unlinkSync(f);
        removed++;
      }
    } catch {
      /* 다른 프로세스가 지웠거나 깨진 파일 — 다음에 */
    }
  }
  return removed;
}

const isFile = (f) => {
  try {
    return fs.statSync(f).isFile();
  } catch {
    return false;
  }
};

/**
 * 그 세션의 대화 파일. 훅이 준 경로 → cwd 로 계산한 경로 → projects/*\/<sid>.jsonl 찾기 순.
 * (긴 경로는 Claude Code 가 폴더 이름을 줄이므로 계산이 빗나갈 수 있다 — 그래서 마지막에 찾는다.)
 */
export function transcriptFor(card, now = Date.now()) {
  const sid = String(card.sessionId || '');
  if (!SID_RE.test(sid)) return null;
  if (typeof card.transcriptPath === 'string' && card.transcriptPath && isFile(card.transcriptPath)) {
    return card.transcriptPath;
  }
  const root = projectsDir();
  if (card.cwd) {
    const guess = path.join(root, encodeCwd(card.cwd), `${sid}.jsonl`);
    if (isFile(guess)) return guess;
  }
  const hit = findCache.get(sid);
  if (hit && now - hit.at < FIND_TTL_MS && (hit.file === null || isFile(hit.file))) return hit.file;
  let file = null;
  try {
    for (const d of fs.readdirSync(root)) {
      const f = path.join(root, d, `${sid}.jsonl`);
      if (isFile(f)) {
        file = f;
        break;
      }
    }
  } catch {
    file = null;
  }
  if (findCache.size > 500) findCache.clear();
  findCache.set(sid, { at: now, file });
  return file;
}

/** 최근 minutes 분 안에 바뀐 대화 파일(projects/*\/*.jsonl, 한 단계 아래만 — subagents 제외) */
export function recentTranscripts(minutes, now = Date.now()) {
  const root = projectsDir();
  const key = `${root}|${minutes}`;
  if (scanCache.key === key && now - scanCache.at < SCAN_TTL_MS) return scanCache.value;
  const out = [];
  const since = now - minutes * 60 * 1000;
  let dirs = [];
  try {
    dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    dirs = [];
  }
  for (const d of dirs) {
    const dir = path.join(root, d.name);
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const n of names) {
      if (!n.endsWith('.jsonl')) continue;
      const sid = n.slice(0, -6);
      if (!SID_RE.test(sid)) continue;
      const file = path.join(dir, n);
      try {
        const st = fs.statSync(file);
        if (st.isFile() && st.mtimeMs >= since) out.push({ sessionId: sid, file, mtimeMs: st.mtimeMs });
      } catch {
        /* 사라졌다 */
      }
    }
  }
  scanCache = { key, at: now, value: out };
  return out;
}

export function mtimeOf(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return 0;
  }
}
