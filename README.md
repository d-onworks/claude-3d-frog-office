<h1 align="center">🐸 Claude 3D Frog Office</h1>

<p align="center"><b>Claude Code 창을 여러 개 띄워 놓고 일한다면, 이제 창을 하나씩 열어 보지 마세요.<br>
사무실 한 장면에 누가 일하고, 누가 쉬고, 누가 내 승인을 기다리는지 다 보입니다.</b></p>

<p align="center">
  <b>한국어</b> · <a href="README.en.md">English</a><br>
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows-supported-2f855a" alt="macOS · Windows 지원">
  <img src="https://img.shields.io/badge/node-18%2B-339933" alt="Node.js 18 이상">
  <img src="https://img.shields.io/badge/dependencies-0-1f6feb" alt="외부 의존성 0">
  <img src="https://img.shields.io/badge/license-MIT-b08800" alt="MIT 라이선스">
</p>

<p align="center">
  <a href="https://raw.githubusercontent.com/d-onworks/claude-3d-frog-office/master/docs/video/promo-ko.mp4"><img src="docs/img/promo-ko.gif" width="100%" alt="광고 영상 — 프로젝트마다 개구리·카피바라 직원이 되어 일하고, 말풍선으로 지금 하는 일을 보여 주고, 서브에이전트 꼬마가 주인을 따라다니는 3D 사무실"></a><br>
  <sub>그림을 누르면 소리 있는 16초 광고 영상(mp4)을 받습니다 · 오토프로그 스튜디오 제작 · 저희 사내 터미널 앱 화면으로 찍었습니다</sub>
</p>

## 창이 많아질수록 놓치는 것

Claude Code 세션을 서너 개만 띄워도 이런 일이 생깁니다.

- 한참 뒤에 창을 열어 보니 Claude 가 "이 명령 실행해도 될까요?" 하고 10분째 멈춰 있다.
- 어느 창이 아직 일하는 중이고 어느 창이 끝났는지 몰라서 하나씩 눌러 본다.
- 서브에이전트를 몇 개 띄웠는지, 지금 어떤 파일을 읽고 고치는지 보이지 않는다.

3D 개구리 사무실은 이 상황을 사무실 풍경 하나로 바꿉니다. 켜져 있는 프로젝트 하나가 직원 한 명입니다. 일하는 직원은 책상에서 타자를 치고, 내 대답이 필요한 직원은 자리에서 일어나 폴짝거립니다. 브라우저 탭 하나만 옆에 띄워 두면 됩니다.

## 설치는 Claude 에게 한마디

필요한 것은 [Claude Code](https://code.claude.com/docs/en/overview) 와 Node.js 18 이상뿐입니다. `npm install` 도 없습니다.

```bash
git clone https://github.com/d-onworks/claude-3d-frog-office.git
cd claude-3d-frog-office
claude
```

Claude 에게 이렇게 말합니다.

```
3D 사무실 적용해줘
```

Claude 가 이 저장소의 `CLAUDE.md` 를 읽고 설정 파일 백업, 훅 추가, 로컬 서버 실행, 브라우저 열기까지 해 줍니다. 브라우저에 `http://127.0.0.1:4777` 이 열리면 북마크해 두세요. 직접 하고 싶다면 `node scripts/setup.mjs` 한 줄이면 같습니다.

설치하기 전에 구경만 해 보고 싶다면 `npm run demo` 를 실행하세요. 가짜 데이터로 사무실이 돌아갑니다.

## 사무실에서 보이는 것

<p align="center"><img src="docs/img/office-ko.png" width="100%" alt="사무실 전체와 오른쪽 활동 로그 패널"></p>

<table>
<tr>
<td width="50%"><img src="docs/img/working-ko.png" alt="책상에서 일하는 개구리, 머리 위에 지금 하는 일 말풍선"></td>
<td width="50%"><img src="docs/img/needs-you-ko.png" alt="승인 대기로 일어나 빨간 글씨와 함께 폴짝거리는 캐릭터"></td>
</tr>
<tr>
<td><b>일하는 중</b><br>책상에서 타자를 치고, 머리 위에 지금 하는 일("📖 server.mjs 읽는 중")이 뜹니다. 서브에이전트는 같은 색 꼬마 직원이 되어 옆에 줄을 섭니다.</td>
<td><b>승인 대기</b><br>도구 사용 허락이나 대답을 기다리면 자리에서 일어나 빨간 글씨로 폴짝거립니다. 멀리서 봐도 눈에 띕니다.</td>
</tr>
<tr>
<td><img src="docs/img/break-ko.png" alt="소파와 탕비실에서 쉬는 캐릭터들"></td>
<td><img src="docs/img/panel-ko.png" alt="오른쪽 패널의 직원별 상태와 활동 로그"></td>
</tr>
<tr>
<td><b>쉬는 중</b><br>할 일을 끝내면 소파, 탕비실, 회의실로 가서 커피를 마시거나 수다를 떨거나 휴대폰을 봅니다.</td>
<td><b>활동 로그</b><br>오른쪽 패널에 직원별 상태와 최근 활동이 실시간으로 흐릅니다. 캐릭터를 누르면 그 프로젝트만 골라 봅니다.</td>
</tr>
</table>

## 사무실 생활 백서

직원들은 생각보다 성실하고, 생각보다 잘 놉니다.

- **출퇴근은 문으로.** 세션을 열면 문을 열고 들어와 빈 책상을 찾아 앉습니다. 세션을 닫으면 문으로 걸어 나가 퇴근합니다. 야근 수당은 따로 없습니다.
- **일할 때는 진심.** 어깨를 들썩이며 타자를 치고, 머리 위에 "📖 server.mjs 읽는 중"처럼 지금 하는 일을 띄웁니다.
- **결재가 필요하면 폴짝.** 승인을 기다리는 직원은 자리에서 일어나 빨간 글씨와 함께 폴짝폴짝 뜁니다. 못 본 척하기 꽤 어렵습니다.
- **서브에이전트는 꼬마 직원.** 같은 색 모자를 쓴 꼬마가 주인 옆에 줄을 서 있다가, 일이 끝나면 인사하고 퇴근합니다.
- **쉬는 시간은 확실하게.** 소파에서 휴대폰을 보며 킥킥대고, 탕비실에서 커피를 내리고, 회의실에 모여 "점심 뭐 먹지" 같은 중요한 안건을 다룹니다.
- **혼잣말도, 수다도.** "오늘 칼퇴 가능?", "깃 충돌 났어…". 어디서 많이 들어 본 말이라면 기분 탓입니다.
- **복도에서 마주치면 손 인사.** 사내 분위기가 좋습니다.
- **신입은 꼬마로 입사.** 커밋이 50개가 안 되는 새 저장소는 몸집이 작은 꼬마 직원으로 나옵니다. 커밋이 쌓이면 어른 직원이 됩니다.
- 같은 저장소에서 연 세션 여러 개는 직원 한 명으로 합쳐집니다. 설정에서 고른 프로젝트는 서버실 랙 앞에 서서 일합니다. 화면 오른쪽 위에서 한국어와 English 를 바꿀 수 있습니다.

## 왜 공유하나요

> 똑같은 코드를 받아서 쓰는 건 전기세를 아끼고 환경을 보호하는 일입니다. 그런 취지로 공유합니다.

같은 기능을 사람마다 AI 에게 처음부터 다시 만들게 하면 그만큼 GPU 가 돌고 전기가 듭니다. 이미 만들어서 맥과 윈도우에서 시험까지 마친 코드가 여기 있습니다. 그대로 받아서 쓰시고, 고친 것이 있으면 다시 나눠 주세요.

## 맥에서도, 윈도우에서도

| 환경 | 확인한 것 |
|---|---|
| macOS | 실제 Claude Code 로 시험했습니다. 세션 시작, 일하는 중, 승인 대기, 승인 후 쉬기, Esc 로 중단, 서브에이전트, 종료까지 화면이 따라옵니다 |
| Windows | 훅 명령을 Git Bash, PowerShell, cmd 세 가지 셸로 실행해 시험했습니다 |
| Linux | 같은 방식으로 동작하게 만들었지만 아직 직접 시험하지는 않았습니다 |

편집기도 가리지 않습니다. VS Code, Cursor, JetBrains 의 터미널이든 iTerm, Windows Terminal 이든 Claude Code 를 실행하는 곳이면 됩니다.

## 가볍고, 내 컴퓨터 밖으로 나가지 않습니다

- Node.js 표준 기능만 씁니다. 받아야 할 패키지가 하나도 없습니다.
- 훅은 세션 시작, 질문 받음, 승인 요청, 끝남 같은 몇 순간에만 불립니다. 도구를 쓸 때마다 불리지 않으므로 Claude 의 속도에 영향이 거의 없습니다.
- 서버는 `127.0.0.1` 에만 열리고 Host 헤더를 확인해 다른 웹사이트가 읽어 가지 못하게 막습니다(DNS 리바인딩 방어). 외부 서버, CDN, 분석 도구를 쓰지 않습니다.
- 설치할 때 `settings.json` 을 먼저 백업(`settings.json.bak-office-…`)하고 훅을 추가만 합니다. 이미 있던 다른 훅은 건드리지 않고, 지울 때도 이 저장소가 넣은 훅만 지웁니다.
- 화면에는 대화 기록에서 뽑은 도구 이름, 파일 이름, 명령 설명(Bash 의 description)이 보입니다. 화면을 공유할 때는 이 점을 참고하세요.

## 어떻게 동작하나

```
Claude Code ──훅──▶ hooks/office-hook.mjs ──▶ ~/.claude-office/sessions/<세션>.json
브라우저 ◀──3초마다── 로컬 서버(127.0.0.1) ──▶ 세션 카드 + ~/.claude/projects 의 대화 기록 끝부분
```

1. [Claude Code 훅](https://code.claude.com/docs/en/hooks)이 정해진 순간마다 작은 스크립트를 부르고, 스크립트는 세션마다 카드 파일 하나를 씁니다.
2. 로컬 서버가 카드와 대화 기록(jsonl)의 끝부분만 읽어 누가 무엇을 하는지 만듭니다. 서브에이전트는 대화 기록 옆의 `subagents/` 폴더로 셉니다.
3. 같은 폴더(git 저장소면 저장소 최상위)에서 연 세션들은 캐릭터 한 명으로 합쳐집니다.

| Claude 상태 | 판단 근거 | 캐릭터 |
|---|---|---|
| 일하는 중 | 질문을 받은 뒤 아직 답을 끝내지 않음, 또는 서브에이전트가 일하는 중 | 책상에 앉아 코딩, 머리 위에 하는 일 |
| 승인 대기 | 권한 요청·입력 요청 알림 | 책상 앞에서 빨간 글씨로 폴짝 |
| 쉬는 중 | 답을 끝냄(Stop), Esc 로 끊음 | 소파·탕비실·회의실에서 쉼 |
| 사라짐 | 세션 종료, 또는 Claude 프로세스가 없어짐 | 문으로 퇴근 |

## 자주 묻는 질문

**설치 전에 열어 둔 Claude 세션도 보이나요?**
보입니다. 대화 기록으로 찾아서 띄웁니다. 다만 그런 세션은 새 훅을 모르기 때문에 승인 대기는 잡히지 않습니다. 한 번 `/exit` 하고 `claude --continue` 로 다시 열면 정확하게 표시됩니다.

**캐릭터를 누르면 그 터미널로 넘어가나요?**
아닙니다. 보기 전용입니다. 오른쪽 패널에 그 프로젝트의 자세한 정보를 보여 줄 뿐, 터미널을 조작하지 않습니다. 광고 영상에서 캐릭터를 눌러 터미널로 들어가는 장면은, 이 사무실이 처음 태어난 저희 사내 터미널 앱(프로그터미널)의 기능입니다.

**개구리가 하루 종일 소파에만 있어요.**
일을 안 시키셨군요. Claude 에게 일을 주면 바로 책상으로 돌아갑니다.

**컴퓨터를 다시 켜면 서버도 다시 켜야 하나요?**
아닙니다. Claude 세션이 시작될 때 서버가 꺼져 있으면 훅이 알아서 띄웁니다(`autoStart`). 북마크만 열면 됩니다.

## 설정

`~/.claude-office/config.json` (없으면 기본값):

```json
{
  "port": 4777,
  "autoStart": true,
  "homes": { "my-main-project": "server" },
  "hide": ["scratch"],
  "fallbackMinutes": 20,
  "staleHours": 6,
  "kidCommits": 50,
  "lang": "auto"
}
```

| 키 | 뜻 |
|---|---|
| `port` | 서버 포트. 환경변수 `CLAUDE_OFFICE_PORT` 가 우선합니다 |
| `autoStart` | Claude 세션이 시작될 때 서버가 꺼져 있으면 자동으로 띄웁니다 |
| `homes` | 지정한 프로젝트는 서버실 랙 앞에 서서 일합니다 |
| `hide` | 사무실에 띄우지 않을 프로젝트(폴더 이름 또는 경로) |
| `fallbackMinutes` | 훅이 없는 세션을 대화 기록으로 찾을 때, 최근 몇 분 안에 바뀐 기록까지 볼지 |
| `staleHours` | 프로세스를 확인할 수 없는 세션을 몇 시간 조용하면 퇴근시킬지 |
| `kidCommits` | 이보다 커밋이 적으면 꼬마 직원 |
| `lang` | `auto`·`ko`·`en`. 화면 오른쪽 위 버튼으로도 바꿀 수 있습니다 |

## 명령

| 명령 | 하는 일 |
|---|---|
| `node scripts/setup.mjs` | 훅 설치 + 서버 실행 + 브라우저 열기 |
| `node scripts/start.mjs --open` | 서버 실행 후 브라우저 열기 |
| `node scripts/stop.mjs` | 서버 끄기 |
| `node scripts/status.mjs` | 훅 설치 여부, 서버 상태, 잡힌 세션 수 확인 |
| `node scripts/uninstall.mjs` | 이 저장소가 넣은 훅만 지우고 서버 끄기 (`--purge` 면 `~/.claude-office` 도 삭제) |
| `npm run demo` | 가짜 데이터로 화면 미리보기 |
| `npm test` | 시험 |

## 제거

```bash
node scripts/uninstall.mjs
```

이 저장소가 넣은 훅만 지웁니다. 그다음 폴더를 지우면 끝입니다.

## 라이선스와 고지

MIT 라이선스입니다. 캐릭터와 사무실 그림은 AI 이미지 생성 도구로 만든 뒤 손질했습니다.

이 프로젝트는 Anthropic 이 만들거나 보증한 것이 아닙니다. Claude 는 Anthropic 의 상표입니다. 코드는 있는 그대로(AS IS) 제공하며, 사용 결과에 대한 책임은 사용자에게 있습니다.
