# 3D 사무실 (claude-3d-frog-office) — 구조와 약속

Claude Code 세션 하나하나를 사무실 캐릭터(개구리·카피바라)로 보여 주는 **보기 전용** 로컬 웹 화면.
어떤 IDE·터미널(VS Code, Cursor, JetBrains, iTerm, Windows Terminal …)에서 Claude 를 쓰든 동작해야 한다.
맥·윈도우(·리눅스) 공통. **외부 의존성 0** — Node.js 18+ 표준 라이브러리만 쓴다(npm install 불필요).

## 1. 폴더

| 경로 | 영역 | 내용 |
|---|---|---|
| `hooks/office-hook.mjs` | 백엔드 | Claude Code 훅 수신기 — 세션 카드 1파일 쓰기/지우기 |
| `server/*.mjs` | 백엔드 | 로컬 HTTP 서버, 스냅샷 조립, 대화 기록 꼬리 읽기, 생존 판정, 데모 데이터 |
| `scripts/*.mjs` | 백엔드 | setup(적용)·start·stop·status(doctor)·uninstall |
| `test/*.test.mjs` | 백엔드 | `node --test` 단위 시험 |
| `package.json` | 백엔드 | 의존성 없음. scripts: setup, start, stop, status, uninstall, demo, test |
| `web/*` | 화면 | 정적 화면(index.html·style.css·i18n.js·office-*.js·office/*.webp) |
| `README*.md`, `CLAUDE.md`, `docs/*` | 문서 | 사용 설명·구조·스프라이트 교체 |


## 2. 데이터 흐름

```
Claude Code ──(훅: stdin JSON)──▶ hooks/office-hook.mjs ──▶ ~/.claude-office/sessions/<session_id>.json  (세션 카드)
                                                         ┌─▶ 세션 카드 + 생존 판정(pid)
브라우저 ◀──(3초 폴링 GET /api/office)── server/server.mjs ┼─▶ ~/.claude/projects/**/<session_id>.jsonl 꼬리 (지금 하는 일·로그)
                                                         └─▶ <session_id>/subagents/agent-*.jsonl (서브에이전트)
```

- 상태 폴더: 환경변수 `CLAUDE_OFFICE_HOME` 이 있으면 그것, 없으면 `~/.claude-office`.
- Claude 설정 폴더: 환경변수 `CLAUDE_CONFIG_DIR` 이 있으면 그것, 없으면 `~/.claude`.
- **훅이 없어도 동작해야 한다(대화 기록 대체 모드)**: 훅 카드가 없는 세션도 최근 N분 안에 바뀐 대화 파일
  (`<config>/projects/*/*.jsonl`, 한 단계 아래만 — subagents 폴더 제외)로 찾아 보여 준다. 이 경우 승인 대기는 감지 못 한다.

## 3. 세션 카드 (`sessions/<sid>.json`) — 훅이 쓴다

```json
{ "sessionId": "…", "kind": "working|decision|rest", "message": "승인 문구(decision 일 때)",
  "event": "UserPromptSubmit", "cwd": "/abs/path", "transcriptPath": "/abs/…jsonl",
  "pid": 12345, "pidStart": "Wed Oct 22 10:11:24 2026 (맥·리눅스만, 없으면 생략)",
  "compactTrigger": "manual|auto (PreCompact 때만)", "updatedAt": "2026-10-22T01:02:03.456Z" }
```

| 훅 이벤트 | kind | 비고 |
|---|---|---|
| SessionStart | rest | source=compact 이고 직전 카드의 compactTrigger≠manual 이면 아무것도 안 함(자동 압축 뒤엔 하던 일 계속) |
| UserPromptSubmit | working | |
| PreCompact | working | compactTrigger 기록 |
| Notification | decision 또는 rest | notification_type ∈ {permission_prompt, worker_permission_prompt, agent_needs_input, elicitation_dialog} → decision. 종류가 없으면 문구에 "needs your permission"/"needs your input" → decision. 그 밖(idle_prompt 등) → 카드 그대로 두거나 rest |
| PermissionRequest | decision | message = 도구 이름 등 짧게 |
| Stop | rest | |
| SessionEnd | ended | 카드를 지우지 않고 ended 로 덮어쓴다 — 서버가 숨기고, 대체 모드가 그 세션을 유령으로 다시 띄우지 않게. 1일 뒤 서버가 치운다. 제한시간 1.5초라 pid 찾기 등 느린 일 금지 |

훅 규칙: **어떤 입력·오류에도 exit 0, stdout 출력 없음**, 세션 id 는 `^[A-Za-z0-9._-]+$` 만, 원자적 쓰기(tmp→rename).

설치하는 이벤트는 오래된 것만(SessionStart·UserPromptSubmit·Notification·PermissionRequest·Stop·PreCompact·SessionEnd).
StopFailure·PostCompact 같은 새 이벤트 키는 옛 버전 Claude 의 설정 검증을 깨뜨릴 수 있어 넣지 않는다.
PermissionRequest 는 승인 창이 뜨는 즉시, Notification(permission_prompt)은 약 6초 뒤에 울린다(공식 문서).

## 4. `GET /api/office` 응답

```json
{
  "version": 1,
  "now": "2026-10-22T01:02:03.456Z",
  "hooks": true,
  "demo": false,
  "people": [ Person, … ]
}
```

`hooks` = 훅 카드를 하나라도 읽었는가(또는 settings.json 에 우리 훅이 깔려 있는가). false 면 화면이 "대화 기록만으로 표시 중" 안내를 띄운다.

```jsonc
// Person — 프로젝트(폴더) 하나 = 캐릭터 하나. 같은 폴더의 세션 여러 개는 한 명으로 합친다.
{
  "id": "/Users/me/my-app",        // 안정 키 = 프로젝트 루트(git 최상위, 없으면 cwd) 정규화 경로
  "name": "my-app",                // 표시 이름 = 루트 폴더 이름(같은 이름이 둘이면 "my-app (parent)")
  "path": "/Users/me/my-app",
  "status": "working",             // "working" | "decision" | "rest"  (세션들 중 decision > working > rest)
  "pending": 0,                    // 승인 대기 중인 세션 수
  "ask": "Claude needs your permission to use Bash",   // decision 일 때 문구(≤80자), 아니면 ""
  "sessions": 1,                   // 합쳐진 세션 수
  "source": "hook",                // "hook" | "transcript"(대체 모드로만 잡힌 경우)
  "commits": 123,                  // git rev-list --count HEAD (10분 캐시), 못 세면 null
  "kid": false,                    // commits != null && commits < 50 → 70% 꼬마
  "home": null,                    // "server" 면 서버실에서 일한다(설정 homes 로 지정). 그 밖엔 null
  "subs": [ { "id": "a1b2", "type": "Explore", "desc": "find auth code", "doing": Act|null } ],  // 최대 12
  "subCount": 1,                   // 실제로 일하는 서브에이전트 수(12 초과 가능)
  "doing": Act|null,               // 지금 하는 일(가장 최근 활동)
  "log": [ { "at": "ISO", "k": "read", "a": "server.mjs" } ]  // 최근 8개, 오래된 것 → 최신
}
```

**Act** = 활동 한 줄을 언어와 무관하게 표현한 것. 화면(i18n.js)이 언어에 맞게 문장으로 만든다.

```jsonc
{ "k": "read",  "a": "server.mjs" }        // k 목록 ↓, a = 이미 잘라 둔 인자(문자열, 없으면 "")
```

| k | 원천(대화 기록 assistant 블록) | a |
|---|---|---|
| text | type=text | 마크다운 기호 뺀 글 60자 |
| read | Read | 파일 이름(basename) |
| edit | Edit·MultiEdit·NotebookEdit | 파일 이름 |
| write | Write | 파일 이름 |
| bash | Bash | description 44자, 없으면 command 앞 40자 |
| grep | Grep | pattern 24자 |
| glob | Glob | pattern 28자 |
| fetch | WebFetch | URL 호스트 이름 |
| search | WebSearch | query 24자 |
| agent | Agent·Task | description 30자 |
| todo | TodoWrite | "" |
| skill | Skill | skill 이름 24자 |
| mcp | `mcp__서버__도구` | 마지막 토막(도구 이름) |
| tool | 그 밖의 도구 | 도구 이름 24자 |

thinking·빈 글은 건너뛴다. 대화 기록 형식은 Claude Code 내부 형식이라 바뀔 수 있다 — 모르는 모양은 조용히 넘긴다.

## 5. 설정 (`~/.claude-office/config.json`, 없어도 됨)

```json
{ "port": 4777, "autoStart": true, "homes": { "my-main-project": "server" },
  "hide": ["scratch"], "fallbackMinutes": 20, "staleHours": 6, "kidCommits": 50, "lang": "auto" }
```

- `port` — 서버 포트(환경변수 `CLAUDE_OFFICE_PORT` 가 우선). 서버는 **127.0.0.1 에만** 붙는다.
- `autoStart` — SessionStart 훅이 서버가 꺼져 있으면 백그라운드로 띄운다(재부팅 뒤에도 Claude 만 켜면 화면이 산다).
- `homes` — 프로젝트 이름(또는 경로) → "server" 면 그 캐릭터는 서버실에 서서 일한다.
- `hide` — 사무실에 안 띄울 프로젝트 이름·경로.
- `lang` — "auto" | "ko" | "en". 화면에 그대로 전달(`GET /api/config`).

## 6. 생존 판정 (세션이 아직 켜져 있나)

1. SessionEnd 를 받으면 카드가 ended 가 된다(숨김).
2. 카드에 pid 가 있으면 그 프로세스가 살아 있어야 한다(`process.kill(pid, 0)`; EPERM 도 살아 있음).
   맥·리눅스는 pidStart(ps lstart, LC_ALL=C)까지 맞춰 pid 재사용에 속지 않는다.
3. pid 가 없으면 `max(카드 updatedAt, 대화 파일 mtime)` 이 `staleHours` 안이어야 한다.
4. 7일 넘은 카드 파일은 서버가 치운다.

상태 보정:
- decision 카드인데 대화 파일이 카드보다 1.5초 넘게 나중에 바뀌었다 → 사용자가 답했다 → working.
- working 카드인데 대화 마지막 줄이 assistant + stop_reason "end_turn" 이고 5초 넘게 조용하거나,
  마지막 user 줄에 "[Request interrupted by user" 가 있다 → rest (Esc 로 끊으면 Stop 훅이 안 울린다).
- working 카드인데 마지막 줄이 API 오류(assistant + `isApiErrorMessage: true` 또는 글이 "API Error" 로 시작) → rest (StopFailure 대신).

## 7. 훅 설치 (`scripts/setup.mjs`)

- `<config>/settings.json` 을 읽어(엄격 JSON, 못 읽으면 **중단**·덮어쓰지 않음) 백업(`settings.json.bak-office-YYYYMMDD-HHMMSS`) 후
  위 이벤트마다 `{ "hooks": [ { "type": "command", "command": CMD, "timeout": 10 } ] }` 를 **추가**(이미 있으면 건너뜀).
- 우리 훅 식별 = command 에 `office-hook.mjs` 가 들어 있음. uninstall 은 그것만 지운다(남의 훅 보존).
- CMD 는 bash·cmd·PowerShell 어디서 돌아도 되게: node 실행 파일 경로에 공백이 없으면 그 절대경로(따옴표 없이),
  있으면 `node`. 스크립트 경로는 **슬래시(/)로 바꾸고 큰따옴표로** 감싼다.
  예) `/opt/homebrew/bin/node "/Users/me/claude-3d-frog-office/hooks/office-hook.mjs"`
      `node "C:/Users/me/claude-3d-frog-office/hooks/office-hook.mjs"`
- 이미 열려 있던 Claude 세션은 훅을 새로 안 읽는다 → 그동안은 대체 모드로 보이고, 다시 켜면(또는 /hooks 확인) 정밀 모드.
