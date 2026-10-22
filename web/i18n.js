"use strict";
// 화면 문구·대사 — 한국어(ko)·영어(en).
// 언어 = 주소의 ?lang= > 저장해 둔 선택(localStorage office.lang) > /api/config 의 lang(auto 가 아니면)
//      > 브라우저 언어(ko 로 시작하면 ko, 아니면 en).

const I18N = (() => {
  const STORE = "office.lang";

  const TEXT = {
    ko: {
      title: "3D 사무실",
      "lang.label": "언어",
      "side.people": "사무실 사람들",
      "side.log": "활동 로그",
      "side.hint": "캐릭터나 이름을 누르면 자세히 봅니다",
      "canvas.label": "사무실 — 캐릭터를 누르면 오른쪽 목록에서 자세히 봅니다",
      sum: "일하는 중 {w} · 승인 대기 {d} · 쉬는 중 {r}",
      "sum.subs": " · 서브에이전트 {n}",
      count: "{n}명 · 일하는 중 {w}",
      demo: "데모 데이터",
      "note.loading": "사무실 불 켜는 중…",
      "note.img": "사무실 그림을 불러오지 못했습니다 — 새로고침해 보세요",
      "note.net": "로컬 서버에 연결하지 못했습니다 — 잠시 뒤 다시 읽습니다",
      "note.empty": "켜진 Claude 세션이 없습니다 — 아무 폴더에서 claude 를 실행하면 사무실로 출근합니다",
      "note.hooks": "훅 미설치 — 대화 기록만으로 표시 중(승인 대기는 감지 안 됨)",
      "status.decision": "승인 대기", "status.working": "일하는 중", "status.rest": "쉬는 중",
      "chip.subs": "서브에이전트 {n}",
      needs: "승인 대기",
      "ask.tool": "{a} 사용 승인 대기",
      "ask.input": "입력 대기",
      "doing.subs": "서브에이전트에게 일을 맡겨 둠",
      "doing.work": "일하는 중…",
      "d.now": "지금", "d.path": "경로", "d.sessions": "세션 {n}개", "d.commits": "커밋 {n}",
      "d.transcript": "대화 기록으로 감지", "d.pending": "승인 대기 {n}건", "d.subs": "서브에이전트",
      "d.more": "외 {n}명", "d.idle": "지금은 쉬는 중", "d.subIdle": "대기 중",
      "ev.in": "출근했습니다", "ev.out": "퇴근했습니다", "ev.work": "일을 시작했습니다",
      "ev.ask": "승인을 기다립니다 — {a}", "ev.subwork": "서브에이전트와 일하는 중", "ev.done": "일을 마쳤습니다",
      "ev.subIn": "서브에이전트 출근 — {a}", "ev.subOut": "서브에이전트 퇴근 — {a}",
      "ev.check": "확인 필요", "ev.task": "일 받음", "ev.end": "일 끝",
    },
    en: {
      title: "3D Office",
      "lang.label": "Language",
      "side.people": "People in the office",
      "side.log": "Activity",
      "side.hint": "Click a character or a name for details",
      "canvas.label": "Office — click a character to see details in the list on the right",
      sum: "Working {w} · Needs you {d} · Idle {r}",
      "sum.subs": " · Subagents {n}",
      count: "{n} · {w} working",
      demo: "Demo data",
      "note.loading": "Turning on the lights…",
      "note.img": "Couldn't load the office images — try reloading",
      "note.net": "Can't reach the local server — retrying shortly",
      "note.empty": "No Claude sessions running — run claude in any folder and it shows up for work",
      "note.hooks": "Hooks not installed — showing transcripts only (approval waits aren't detected)",
      "status.decision": "Needs you", "status.working": "Working", "status.rest": "Idle",
      "chip.subs": "{n} subagent(s)",
      needs: "Needs you",
      "ask.tool": "Allow {a}?",
      "ask.input": "Needs your input",
      "doing.subs": "Subagents are on it",
      "doing.work": "Working…",
      "d.now": "Now", "d.path": "Path", "d.sessions": "{n} session(s)", "d.commits": "{n} commits",
      "d.transcript": "Detected from transcript", "d.pending": "{n} waiting for approval", "d.subs": "Subagents",
      "d.more": "+{n} more", "d.idle": "Taking a break", "d.subIdle": "Standing by",
      "ev.in": "Clocked in", "ev.out": "Clocked out", "ev.work": "Started working",
      "ev.ask": "Needs you — {a}", "ev.subwork": "Working with subagents", "ev.done": "Finished",
      "ev.subIn": "Subagent joined — {a}", "ev.subOut": "Subagent done — {a}",
      "ev.check": "check needed", "ev.task": "new task", "ev.end": "done",
    },
  };

  // 활동(Act) 한 줄 — {k, a}. CONTRACT 4절 표의 k 목록.
  const ACT = {
    ko: {
      text: "💬 {a}", read: "📖 {a} 읽는 중", edit: "✏️ {a} 고치는 중", write: "📝 {a} 쓰는 중", bash: "🔧 {a}",
      grep: "🔍 '{a}' 찾는 중", glob: "🔍 {a} 파일 찾는 중", fetch: "🌐 {a} 읽는 중", search: "🌐 '{a}' 검색 중",
      agent: "🐣 서브에이전트에게 맡김: {a}", todo: "🗒️ 할 일 정리 중", skill: "📚 {a} 펼치는 중",
      mcp: "🔌 {a} 쓰는 중", tool: "⚙️ {a} 쓰는 중",
    },
    en: {
      text: "💬 {a}", read: "📖 Reading {a}", edit: "✏️ Editing {a}", write: "📝 Writing {a}", bash: "🔧 {a}",
      grep: "🔍 Searching '{a}'", glob: "🔍 Finding files {a}", fetch: "🌐 Reading {a}", search: "🌐 Searching '{a}'",
      agent: "🐣 Delegated: {a}", todo: "🗒️ Updating the to-do list", skill: "📚 Opening skill {a}",
      mcp: "🔌 Using {a}", tool: "⚙️ Using {a}",
    },
  };
  // 인자가 비었을 때 대신 넣는 말
  const ACT_EMPTY = {
    ko: { read: "파일", edit: "파일", write: "파일", fetch: "웹", bash: "명령 실행 중", agent: "일", tool: "도구", mcp: "도구" },
    en: { read: "a file", edit: "a file", write: "a file", fetch: "the web", bash: "Running a command", agent: "a task",
          tool: "a tool", mcp: "a tool" },
  };

  // 대사 — 말풍선 한 줄. 수다는 주고받는 맛이 나게 묻고 답하는 말을 섞는다.
  const LINES = {
    ko: {
      talk: ["커피 한 잔 할래?", "빌드 됐어?", "테스트 다 통과!", "깃 충돌 났어…", "리뷰 좀 부탁해", "점심 뭐 먹지",
             "배포는 내일 하자", "토큰 아껴 써야지", "버그 하나 잡았다", "그거 커밋했어?", "ㅋㅋㅋㅋ", "승인 좀 눌러줘",
             "회의 언제야?", "로그 봤어?", "오늘 일 많네", "서버 괜찮아?", "PR 올렸어", "새로고침 해봐",
             "됐다 됐다!", "그거 내가 할게", "오 진짜?", "대박ㅋㅋ", "아 맞다", "그건 좀…", "천재인데?",
             "주말에 뭐 해?", "고양이 사진 볼래?", "어제 그 영상 봤어?", "다이어트는 내일부터", "졸려…"],
      phone: ["여보세요~", "지금 확인할게요", "네네 바로요", "아 그거요?", "네, 말씀하세요"],
      scroll: ["📱 쇼츠 하나만…", "📱 뉴스 보는 중", "알림 왔네", "📱 고양이 영상", "오 이거 괜찮네", "📱 맛집 검색"],
      texting: ["답장 중…", "📱 톡톡", "ㅇㅋㅇㅋ", "지금 가는 중~", "단톡 폭발"],
      lol: ["ㅋㅋㅋㅋ", "아 웃겨ㅋㅋ", "이거 봐ㅋㅋ", "ㅋㅋ 미쳤다"],
      think: ["배고프다…", "커피 땡긴다", "오늘 칼퇴 가능?", "음…", "뭐 하더라", "♪~", "졸려"],
      greet: ["안녕!", "하이~", "수고해!", "좋은 아침~", "오 왔어?"],
      work: ["타닥타닥…", "코드 짜는 중", "생각 중…", "확인 중…"],
      rack: ["🖥️ 랙 불빛 이상 무", "서버 온도 좋고", "백업 확인"],
      rackOk: ["🖥️ 랙 불빛 이상 무"],
      brew: ["☕ 커피 내리는 중"],
      sip: ["캬~", "아 좋다", "☕ 후루룩"],
      reading: ["📚 읽는 중"],
      stretch: ["으아아~"],
      meeting: ["자, 회의 시작합니다"],
      bye: ["또 봐~", "고고!", "ㅂㅂ", "나중에 봐"],
      cheer: ["됐다!", "통과!", "오예~"],
      askWave: ["여기요~!", "확인 부탁해요!", "승인해 주세요~"],
      miniIn: ["출근!", "넵!", "왔습니다"],
      miniBye: ["퇴근합니다! 👋"],
      miniIdle: ["넵!", "확인 중…", "보고드립니다", "뭐 하지?"],
    },
    en: {
      talk: ["Coffee?", "Did the build pass?", "All tests green!", "Merge conflict…", "Can you review this?", "Lunch?",
             "Ship it tomorrow", "Save some tokens", "Squashed a bug", "Did you commit that?", "lol", "Approve my PR?",
             "When's the meeting?", "Seen the logs?", "Busy day", "Server OK?", "PR is up", "Try a refresh",
             "It works!", "I'll take that", "Oh really?", "haha nice", "Oh right", "Hmm, not sure…", "Genius!",
             "Weekend plans?", "Wanna see a cat pic?", "Saw that video?", "Diet starts tomorrow", "Sleepy…"],
      phone: ["Hello~", "Checking now", "Yep, on it", "Oh, that one?", "Go ahead"],
      scroll: ["📱 One more short…", "📱 Reading news", "Got a ping", "📱 Cat videos", "Oh, this is nice", "📱 Food spots"],
      texting: ["Replying…", "📱 tap tap", "ok ok", "On my way~", "Group chat is wild"],
      lol: ["lol", "haha so funny", "look at this lol", "lmao"],
      think: ["Hungry…", "Need coffee", "Leave on time today?", "Hmm…", "What was I doing", "♪~", "Sleepy"],
      greet: ["Hi!", "Hey~", "Keep it up!", "Morning~", "Oh, you're here?"],
      work: ["tap tap tap…", "Writing code", "Thinking…", "Checking…"],
      rack: ["🖥️ Rack lights OK", "Temps look good", "Backups checked"],
      rackOk: ["🖥️ Rack lights OK"],
      brew: ["☕ Brewing coffee"],
      sip: ["Ahh~", "So good", "☕ sip sip"],
      reading: ["📚 Reading"],
      stretch: ["Stretch~"],
      meeting: ["OK, let's start"],
      bye: ["See ya~", "Let's go!", "bye bye", "Later!"],
      cheer: ["Done!", "Passed!", "Yay~"],
      askWave: ["Over here!", "Need your OK!", "Approve me~"],
      miniIn: ["Reporting!", "Yes sir!", "I'm here"],
      miniBye: ["Signing off! 👋"],
      miniIdle: ["On it!", "Checking…", "Reporting back", "What next?"],
    },
  };

  const norm = v => { const s = String(v || "").toLowerCase(); return s.startsWith("ko") ? "ko" : s.startsWith("en") ? "en" : ""; };
  const fill = (tpl, vars) => String(tpl).replace(/\{(\w+)\}/g, (_, k) => (vars && vars[k] != null ? String(vars[k]) : ""));
  const cut = (text, n) => { const a = Array.from(text || ""); return a.length > n ? a.slice(0, n).join("") + "…" : a.join(""); };
  const listeners = [];
  let lang = "en", fixed = false;

  (function detect() {
    const q = norm(new URLSearchParams(location.search).get("lang"));
    if (q) { lang = q; fixed = true; return; }
    let saved = "";
    try { saved = norm(localStorage.getItem(STORE)); } catch { /* 저장소를 못 쓰면 다음 순서로 */ }
    if (saved) { lang = saved; fixed = true; return; }
    lang = norm(navigator.language) === "ko" ? "ko" : "en";
  })();

  // 설정 파일의 lang 은 서버에서 받아 온다(주소·저장값이 없을 때만). 서버가 없으면 브라우저 언어 그대로.
  async function init() {
    if (!fixed) {
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 1500);
        const res = await fetch("/api/config", { signal: ctl.signal, cache: "no-store" });
        clearTimeout(timer);
        if (res.ok) { const c = await res.json(); const l = norm(c && c.lang); if (l) lang = l; }
      } catch { /* 설정을 못 읽어도 화면은 뜬다 */ }
    }
    document.documentElement.lang = lang;
  }
  function setLang(next) {
    next = norm(next);
    if (!next || next === lang) return;
    lang = next;
    try { localStorage.setItem(STORE, lang); } catch { /* 저장 못 해도 지금 화면은 바뀐다 */ }
    const url = new URL(location.href);
    if (url.searchParams.has("lang")) { url.searchParams.set("lang", lang); history.replaceState(null, "", url); }
    document.documentElement.lang = lang;
    for (const f of listeners) f(lang);
  }

  const t = (key, vars) => fill(TEXT[lang][key] ?? TEXT.ko[key] ?? key, vars);
  const lines = name => LINES[lang][name] || LINES.ko[name] || [""];
  function act(x) {
    if (!x) return "";
    if (typeof x === "string") return x;                     // 옛 형식(이미 글)이면 그대로
    const k = String(x.k || ""), a = String(x.a ?? "").trim();
    if (k === "text" && !a) return "";
    const tpl = Object.hasOwn(ACT[lang], k) ? ACT[lang][k] : "";   // 모르는 k 는 인자만
    if (!tpl) return a ? `⚙️ ${a}` : "";
    return fill(tpl, { a: a || (Object.hasOwn(ACT_EMPTY[lang], k) ? ACT_EMPTY[lang][k] : "") });
  }
  // 승인 문구 — Claude 의 영어 알림을 한국어 화면에서는 짧게 바꾼다. 영어 화면은 원문 그대로,
  // short(말풍선·로그)일 때만 짧게("Allow Bash?"). 모르는 문구는 그대로.
  function ask(text, short) {
    const s = String(text || "").replace(/\s+/g, " ").trim();
    if (!s) return "";
    const tool = s.match(/^Claude needs your permission to use (.+?)\.?$/i);
    if (tool) return lang === "ko" || short ? t("ask.tool", { a: tool[1] }) : s;
    if (/^Claude (needs your input|is waiting for your input)\.?$/i.test(s)) return lang === "ko" || short ? t("ask.input") : s;
    if (/^[A-Za-z][\w.:-]{0,39}$/.test(s)) return t("ask.tool", { a: s });   // 도구 이름만 왔다(PermissionRequest)
    return s;
  }
  function ev(key, arg) {
    if (key === "ask") return t("ev.ask", { a: cut(ask(arg, true) || t("ev.check"), 24) });
    if (key === "subIn") return t("ev.subIn", { a: cut(arg || t("ev.task"), 22) });
    if (key === "subOut") return t("ev.subOut", { a: cut(arg || t("ev.end"), 22) });
    return t("ev." + key);
  }
  // 로그 시각 — 보는 사람의 시간대
  const time = ms => new Date(ms).toLocaleTimeString(lang === "ko" ? "ko-KR" : "en-GB",
    { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return {
    get lang() { return lang; },
    init, setLang, onChange: f => listeners.push(f),
    t, lines, act, ask, ev, time, cut,
  };
})();
