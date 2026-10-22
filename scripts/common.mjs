// scripts 공용 — 노드 버전 확인, 인자, 두 언어 출력.
export const MIN_NODE = 18;

export function nodeMajor() {
  return Number(String(process.versions.node).split('.')[0]) || 0;
}

/** 노드가 너무 낡았으면 안내하고 끝낸다 */
export function requireNode() {
  if (nodeMajor() >= MIN_NODE) return;
  console.error(`Node.js ${MIN_NODE} 이상이 필요합니다(지금 ${process.versions.node}). https://nodejs.org 에서 LTS 를 설치하세요.`);
  console.error(`Node.js ${MIN_NODE}+ is required (found ${process.versions.node}). Install the LTS from https://nodejs.org`);
  process.exit(1);
}

export const has = (flag) => process.argv.slice(2).includes(flag);

/** 한글 한 줄 + 영어 한 줄 */
export function say(ko, en) {
  console.log(ko);
  console.log(en);
}

export function fail(ko, en, code = 1) {
  console.error(ko);
  console.error(en);
  process.exit(code);
}
