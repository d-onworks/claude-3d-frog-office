# claude-3d-frog-office — Claude Code 작업 지침

이 저장소는 **Claude Code 세션을 아이소메트릭 사무실 캐릭터로 보여 주는 로컬 웹 화면**이다.
사용자가 이 폴더에서 Claude 에게 설치·실행을 부탁하면 아래 절차를 그대로 따른다. 사용자의 언어(한국어/영어)로 답한다.

## 사용자가 이렇게 말하면

| 사용자 말 (예) | 할 일 |
|---|---|
| "3D 사무실 적용해줘", "설치해줘", "install", "set it up", "apply 3D office", "Set up the 3D office" | 아래 **설치 절차** |
| "3D 사무실 열어줘", "켜줘", "open the office", "start" | `node scripts/start.mjs --open` |
| "꺼줘", "서버 멈춰", "stop" | `node scripts/stop.mjs` |
| "상태 봐줘", "안 보여", "doctor", "status" | `node scripts/status.mjs` 결과를 읽고 아래 **문제 해결** 참고 |
| "데모 보여줘", "demo" | `node scripts/start.mjs --demo --open` (가짜 데이터, 실제 세션과 무관) |
| "지워줘", "제거", "uninstall" | `node scripts/uninstall.mjs` (상태 폴더까지 지우려면 `--purge`) |

## 설치 절차

1. `node --version` 으로 Node.js 18 이상인지 확인한다.
   - 없거나 낮으면 사용자에게 설치를 제안한다: macOS `brew install node`(Homebrew 가 있을 때) 또는 https://nodejs.org ,
     Windows `winget install OpenJS.NodeJS.LTS`, Linux 는 배포판 패키지 관리자. **사용자 동의 없이 시스템 프로그램을 설치하지 않는다.**
2. `node scripts/setup.mjs` 를 실행한다. 이 스크립트가 하는 일:
   - Claude 설정(`~/.claude/settings.json`, `CLAUDE_CONFIG_DIR` 이 있으면 그 폴더)을 **백업한 뒤** 이 저장소의 훅을 **추가**한다(기존 훅은 그대로 둔다).
   - `~/.claude-office/config.json` 이 없으면 기본 설정을 만든다.
   - 로컬 서버(127.0.0.1:4777)를 백그라운드로 띄우고 브라우저를 연다.
3. 결과를 사용자에게 짧게 알린다:
   - 주소: `http://127.0.0.1:4777` (북마크 권장)
   - **이미 열려 있던 Claude 세션**은 새 훅을 아직 모른다. 그 세션들은 대화 기록만으로 표시되고(승인 대기는 감지 안 됨),
     세션을 다시 시작하면(`/exit` 후 `claude --continue`) 정확하게 잡힌다.
   - 서버는 Claude 세션이 시작될 때 꺼져 있으면 자동으로 다시 뜬다(`autoStart`, 설정에서 끌 수 있음).

**`settings.json` 을 손으로 고치지 않는다** — 항상 `scripts/setup.mjs` / `scripts/uninstall.mjs` 를 쓴다. setup 이 settings.json 을 읽지 못하면(JSON 오류) 멈추고 그 이유를 사용자에게 보여 준다. 고칠지는 사용자가 정한다.

## 문제 해결

- 화면에 아무도 없다 → `node scripts/status.mjs` 로 훅 설치 여부·서버 상태를 확인. 열린 Claude 세션이 없으면 정상이다.
- 포트가 겹친다 → `~/.claude-office/config.json` 의 `port` 를 바꾸고 `node scripts/stop.mjs && node scripts/start.mjs --open`. 훅도 새 포트를 읽는다.
- 특정 프로젝트를 숨기고 싶다 → config.json 의 `hide` 에 폴더 이름을 넣는다.
- 한 프로젝트를 서버실에서 일하게 하고 싶다 → config.json 의 `homes` 에 `"폴더이름": "server"`.

## 개발 규칙 (이 저장소를 고칠 때)

- 외부 의존성 0 — Node.js 18+ 표준 라이브러리만. 화면도 CDN·웹폰트 없이 오프라인으로 돈다.
- 데이터 형식·구조는 `docs/CONTRACT.md` 가 정본. 스프라이트 교체는 `docs/SPRITES.md`.
- 시험: `npm test`. 시험은 진짜 `~/.claude` 를 건드리지 않게 `CLAUDE_CONFIG_DIR`·`CLAUDE_OFFICE_HOME` 을 임시 폴더로 둔다.
- 서버는 127.0.0.1 에만 붙고 Host 헤더를 검사한다. 이 보안 성질을 깨는 변경 금지.
