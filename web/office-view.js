"use strict";
// 사무실 화면 — 캔버스 그리기(30fps), 3초마다 /api/office 읽기, 캐릭터 누르기(고르기), 위 막대·안내 줄.
// Claude 세션(프로젝트) 하나 = 캐릭터 하나(개구리는 모자 색, 카피바라는 가디건 색으로 프로젝트를 가른다).
// 누가 무엇을 하는지는 office-life.js, 걷기·충돌은 office-path.js, 지도는 office-world.js, 칸 규격은
// office-atlas.js(그림 만들 때 자동 생성), 오른쪽 패널은 office-panel.js, 문구는 i18n.js.
// 탭이 안 보이면 그리기도 데이터 읽기도 멈춘다. 보기 전용 — 누르면 고르기만 한다.

(function () {
  const A = OFFICE_ATLAS;
  // 자세 이름 → [시트 꼬리, 칸, 원래 보는 쪽(-1 왼쪽·1 오른쪽·0 정면)]
  const POSES = {
    stand: ["", 0, -1], sitBack: ["", 3, 0], sitFront: ["", 4, 0], mug: ["", 5, 0],
    talk: ["2", 1, 1], laugh: ["2", 2, 0], sip: ["2", 3, 0], wave: ["2", 4, 0], think: ["2", 5, 0],
    phone: ["2", 6, 0], stretch: ["2", 7, 0],
    // 걷기 = walk 시트. 앞걸음(walkF*)·뒷걸음(walkB*)·서브에이전트 앞(mWalk*)·뒤(mBack*) — 바꿀 땐 docs/SPRITES.md
    walkF: ["walk", 0, -1], walkF2: ["walk", 1, -1], walkB: ["walk", 2, 1], walkB2: ["walk", 3, 1],
    mWalk: ["walk", 4, -1], mWalk2: ["walk", 5, -1], mBack: ["walk", 6, 1], mBack2: ["walk", 7, 1],
    standBack: ["walk", 2, 1],      // 등 보이고 서 있기(서버실 랙·커피 머신 앞) — 뒷걸음 첫 칸을 빌려 쓴다
    cheer: ["3", 5, 0], scratch: ["3", 6, 0], sofaTalk: ["3", 7, 0],
    mStand: ["mini", 0, 0], mBye: ["mini", 3, 0], mJump: ["mini", 4, 0], mSide: ["mini", 5, 1], mBow: ["mini", 6, 0],
    // 휴대폰 만지작 — 서서 스크롤·문자·킥킥, 앉아서(소파 정면) 스크롤·문자·킥킥, 책상 등지고
    phScroll: ["phone", 1, 0], phText: ["phone", 2, 0], phLol: ["phone", 3, 0],
    sitScroll: ["phone", 4, 0], sitText: ["phone", 5, 0], sitBackPhone: ["phone", 6, 0], sitLol: ["phone", 7, 0],
  };
  // 걷기 한 바퀴(두 걸음 = 걸음 위상 2π)에 돌리는 칸 — 칸이 늘면 배열만 늘린다(위상을 칸 수로 나눈다)
  const WALK = {
    front: ["walkF", "walkF2"], back: ["walkB", "walkB2"],
    miniFront: ["mWalk", "mWalk2"], miniBack: ["mBack", "mBack2"],
  };
  // 걷기 자세는 여기서만 고른다 — 위로(화면 안쪽) 걸으면 뒷모습, 아니면 앞모습
  function walkPose(e, mini) {
    const up = (e.vy || 0) < -Math.abs(e.vx || 0) * (mini ? 0.3 : 0.25);
    const set = mini ? (up ? WALK.miniBack : WALK.miniFront) : (up ? WALK.back : WALK.front);
    return set[Math.floor((e.wp || 0) / (2 * Math.PI / set.length)) % set.length];
  }
  const SHEETS = ["frog", "frog2", "frog3", "frogmini", "frogwalk", "frogphone",
                  "capy", "capy2", "capy3", "capymini", "capywalk", "capyphone"];
  const TINT = 0.6;              // 색칠한 칸 축척 — 쓰는 자세만 그때그때 칠해 메모리를 아낀다
  const STAND = 96;              // 보통 캐릭터 키(사무실 그림 픽셀)
  const KID = 0.7;               // 커밋이 적은 저장소 = 꼬마(70%)
  const MINI = 0.5;              // 서브에이전트 = 주인 키의 50%
  const FRAME_MS = 1000 / 30, POLL_MS = 3000;
  const BG = "#EDEFF1";
  const FONT = '-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';
  const Q = new URLSearchParams(location.search);
  const DEBUG = Q.has("debug") || Q.has("officedebug");
  const L = OfficeLife.L;
  const t = (k, v) => I18N.t(k, v);
  const $ = id => document.getElementById(id);
  const st = { imgs: null, loaded: false, failImg: false, failNet: false, cells: new Map(), raf: 0, last: 0,
               people: null, meta: null, sel: null, view: { s: 1, ox: 0, oy: 0, dpr: 1, small: false }, parts: [] };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];

  // ---------- 그림 ----------
  function loadImages() {
    if (st.imgs) return;
    st.imgs = {};
    const names = ["floor", "chairs", ...SHEETS.flatMap(s => [s, s + "-key"])];
    let left = names.length;
    for (const n of names) {
      const img = new Image();
      img.onload = () => { if (--left === 0) { st.loaded = true; bar(); } };
      img.onerror = () => { st.failImg = true; bar(); };
      img.src = `office/${n}.webp`;
      st.imgs[n] = img;
    }
  }
  function canvasOf(w, h) { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }
  // 자세 한 칸을 프로젝트 색으로 — 마스크에 색을 채워 본판에 곱한다(명암·니트 결은 살고 색만 바뀐다)
  function cell(sheet, i, color) {
    const key = `${sheet}|${i}|${color}`;
    let c = st.cells.get(key);
    if (c) return c;
    const w = Math.round(A.cellW * TINT), h = Math.round(A.cellH * TINT);
    const m = canvasOf(w, h), mc = m.getContext("2d");
    mc.drawImage(st.imgs[sheet + "-key"], i * A.cellW, 0, A.cellW, A.cellH, 0, 0, w, h);
    mc.globalCompositeOperation = "source-in";
    mc.fillStyle = color;
    mc.fillRect(0, 0, w, h);
    c = canvasOf(w, h);
    const cc = c.getContext("2d");
    cc.drawImage(st.imgs[sheet], i * A.cellW, 0, A.cellW, A.cellH, 0, 0, w, h);
    cc.globalCompositeOperation = "multiply";
    cc.drawImage(m, 0, 0);
    st.cells.set(key, c);
    return c;
  }

  // 자세 하나를 발끝(x,y) 기준으로 — 돌려주는 값 = 눌림 판정·글씨 자리용 상자(그림 좌표)
  function sprite(ctx, species, color, pose, x, y, stand, face, o = {}) {
    const [tail, i, native] = POSES[pose] || POSES.stand;
    const sheet = species + tail;
    const c = cell(sheet, i, color);
    const k = stand * (o.k || 1) / (A.stand * TINT);
    const dw = c.width * k, dh = c.height * k;
    const mirror = native ? face !== native : (!pose.startsWith("sitBack") && face > 0);
    ctx.save();
    ctx.globalAlpha = o.alpha ?? 1;
    ctx.translate(x, y);
    if (o.tilt) ctx.rotate(o.tilt);
    ctx.scale((mirror ? -1 : 1) * (o.sx || 1), o.sy || 1);
    ctx.drawImage(c, -dw / 2, -dh + 2 * TINT * k, dw, dh);
    ctx.restore();
    const h = stand * (o.k || 1) * (A.heights[sheet]?.[i] ?? 1) * (o.sy || 1);
    return { x: x - h * 0.34, y: y - h, w: h * 0.68, h, top: y - h };
  }
  function shadow(ctx, x, y, w) {
    ctx.fillStyle = "rgba(20, 30, 25, .15)";
    ctx.beginPath();
    ctx.ellipse(x, y - 1, w, w * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---------- 꼬물거림 — 같은 자세라도 늘 조금씩 움직인다 ----------
  const jelly = (t, speed, amt) => { const w = Math.sin(t * speed); return { sx: 1 - w * amt * 0.7, sy: 1 + w * amt }; };
  function hopFx(since, h) {                 // 폴짝 한 번: 웅크림 → 늘어나며 뜀 → 찌그러지며 착지
    if (since < 0 || since > 0.62) return null;
    if (since < 0.08) return { dy: 0, sx: 1.1, sy: 0.88 };
    if (since < 0.5) { const u = (since - 0.08) / 0.42; return { dy: -Math.sin(u * Math.PI) * h, sx: 0.94, sy: 1.08 }; }
    return { dy: 0, sx: 1.12, sy: 0.86 };
  }
  const standOf = p => STAND * (p.kid ? KID : 1);

  // 방향을 바꾸면 '뿅' — 가로가 잠깐 좁아졌다 돌아온다(휙 뒤집히는 대신)
  function turn(e, face, t) { if (e.face !== face) { e.face = face; e.turnT = t; } }
  const turnSx = (e, t) => (e.turnT && t - e.turnT < 0.14 ? 0.62 + (t - e.turnT) / 0.14 * 0.38 : 1);
  function poseOf(p, t) {
    if (p.over && t < p.over.until) return p.over.pose;
    if (p.path.length) {
      if (Math.abs(p.vx || 0) > 0.5) turn(p, p.vx > 0 ? 1 : -1, t);
      return walkPose(p, false);                                  // 발 딛는 순간(위상)에만 칸이 바뀐다
    }
    return p.act?.pose || "stand";
  }

  function drawPerson(ctx, p) {
    const t = L.t, stand = standOf(p), ph = p.phase, pose = poseOf(p, t);
    let dy = 0, dx = 0, tilt = 0, { sx, sy } = jelly(t + ph, 3.2, 0.03);
    if (p.path.length && !(p.over && t < p.over.until)) {            // 걸음 — 한 걸음에 한 번 통, 좌우로 살랑
      const w = Math.sin(p.wp || 0), c = 1 - Math.abs(w);             // c = 1 이면 발이 땅에 닿은 순간
      dy = -Math.abs(w) * 3.6;
      tilt = w * 0.045;
      sy = 1 - 0.05 * c * c + 0.02 * (1 - c); sx = 1 + 0.04 * c * c - 0.015 * (1 - c);
    } else if (pose === "sitBack" && p.act?.work) {                   // 빡 코딩 — 어깨 들썩 + 잔떨림
      dx = Math.sin(t * 38 + ph) * 0.6; dy = -Math.abs(Math.sin(t * 17 + ph)) * 1.6;
      tilt = Math.sin(t * 7 + ph) * 0.03; ({ sx, sy } = jelly(t + ph, 17, 0.02));
    } else if (p.act?.hop && pose === "stand") {                      // 승인 대기 — 쉬지 않고 폴짝폴짝
      ({ dy, sx, sy } = hopFx(((t + ph) * 1.15) % 0.9, 18) || { dy: 0, sx: 1, sy: 1 });
      tilt = Math.sin(t * 6 + ph) * 0.06;
    } else if (pose === "sitLol" || pose === "phLol") {              // 휴대폰 보다 킥킥 — 작게 들썩
      dy = -Math.abs(Math.sin(t * 13 + ph)) * 1.8; tilt = Math.sin(t * 6.5 + ph) * 0.04;
    } else if (pose.startsWith("sit")) {                              // 앉아서(휴대폰 포함) — 느릿한 숨 + 갸웃
      ({ sx, sy } = jelly(t + ph, 1.8, 0.025)); tilt = Math.sin(t * 0.9 + ph) * 0.035;
    } else if (pose === "phScroll" || pose === "phText") {            // 서서 휴대폰 — 고개 까딱, 엄지 톡톡
      tilt = Math.sin(t * 1.3 + ph) * 0.025; dy = -Math.abs(Math.sin(t * 5 + ph)) * 0.6;
    } else if (pose === "laugh") {                                    // 깔깔 — 빠르게 들썩
      dy = -Math.abs(Math.sin(t * 16)) * 3; tilt = Math.sin(t * 8) * 0.05;
    } else if (pose === "talk" || pose === "sofaTalk" || pose === "phone") {
      dy = -Math.abs(Math.sin(t * 7 + ph)) * 2; tilt = Math.sin(t * 3.5 + ph) * 0.05;
    } else if (pose === "cheer") {
      ({ dy, sx, sy } = hopFx((t * 1.6) % 0.62, 8) || { dy: 0, sx: 1, sy: 1 });
    } else if (pose === "wave") {
      tilt = Math.sin(t * 9) * 0.07;
    } else if (pose === "sip" || pose === "mug") {
      tilt = Math.sin(t * 1.4 + ph) * 0.04;
    } else if (pose === "stretch") {
      sy = 1 + Math.abs(Math.sin(t * 2.5)) * 0.05; sx = 1 - (sy - 1) * 0.6;
    } else {
      tilt = Math.sin(t * 1.7 + ph) * 0.035;
    }
    if (!pose.startsWith("sit")) shadow(ctx, p.x, p.y, stand * 0.21 * (1 + dy / 60));
    // 의자의 꼬마는 방석을 깔고 앉은 듯 올린다 — 안 그러면 등받이에 모자만 보인다. 앞줄 의자일수록 커서(원근)
    // 의자마다 올리는 양(chairs[].kid)을 그림 만들 때 재 둔다: 어느 줄에서나 머리가 비슷하게 나온다.
    const chair = p.kid && !p.path.length && p.act?.chair >= 0 ? A.chairs?.[p.act.chair] : null;
    if (chair) dy -= chair.kid || 0;
    p.box = sprite(ctx, p.species, p.color, pose, p.x + dx, p.y + dy, stand, p.face,
                   { alpha: p.alpha, sx: sx * turnSx(p, t), sy, tilt });
    p.feet = p.y;
  }

  function drawMini(ctx, m) {
    const p = L.people.get(m.owner);
    const species = p?.species || "frog", color = p?.color || "#888", stand = p ? standOf(p) : STAND;
    const t = L.t, ph = m.phase;
    let pose = "mStand", face = m.face, dy = 0, dx = 0, tilt, sx, sy;
    if (m.over && t < m.over.until) pose = m.over.pose;
    if (m.path.length) {                                              // 종종걸음 — 빠른 걸음, 발 딛을 때 통
      if (Math.abs(m.vx || 0) > 0.5) turn(m, m.vx > 0 ? 1 : -1, t);
      face = m.face;
      pose = walkPose(m, true);
      const w = Math.sin(m.wp || 0), c = 1 - Math.abs(w);
      tilt = w * 0.08; dy = -Math.abs(w) * 2.6;
      sy = 1 - 0.06 * c * c; sx = 1 + 0.05 * c * c;
    } else {                                                          // 줄 서서 꼼지락 — 한시도 가만히 안 있는다
      const w = Math.sin(t * 6 + ph);
      tilt = w * 0.12; dx = Math.sin(t * 2.3 + ph) * 2; dy = -Math.abs(w) * 1.6;
      ({ sx, sy } = jelly(t + ph, 6, 0.05));
      if (pose === "mJump") ({ dy, sx, sy } = hopFx(0.6 - (m.over.until - t), 9) || { dy, sx, sy });
      if (m.flipT && t - m.flipT < 0.15) sx *= 0.7 + (t - m.flipT) / 0.15 * 0.3;   // 고개 돌릴 때 '뿅'
    }
    shadow(ctx, m.x, m.y, stand * MINI * 0.2);
    m.box = sprite(ctx, species, color, pose, m.x + dx, m.y + dy, stand, face,
                   { alpha: m.alpha, k: MINI, sx: sx * turnSx(m, t), sy, tilt });
  }

  // 고른 사람 발밑 고리 — 그 사람 색으로. 뒤쪽 반은 캐릭터보다 먼저(바닥에), 앞쪽 반은 캐릭터 다음에 그려
  // 고리가 발을 둘러싼 것처럼 보이게 한다(앉은 사람은 의자 등받이 위로 앞쪽 반이 보인다).
  function drawRing(ctx, front) {
    const p = st.sel && L.people.get(st.sel);
    if (!p || p.alpha < 0.3) return;
    const r = standOf(p) * 0.42 * (1 + Math.sin(L.t * 4) * 0.05), ry = r * 0.34;
    ctx.save();
    ctx.globalAlpha = Math.min(1, p.alpha);
    ctx.strokeStyle = p.color;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    if (front) ctx.ellipse(p.x, p.y - 1, r, ry, 0, 0, Math.PI);
    else {
      ctx.fillStyle = p.color + "38";
      ctx.ellipse(p.x, p.y - 1, r, ry, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(p.x, p.y - 1, r, ry, 0, Math.PI, Math.PI * 2);
    }
    ctx.stroke();
    ctx.restore();
  }
  // 색 위에 올릴 글자색 — 밝은 색이면 진한 글자, 어두우면 흰 글자
  const inkOn = hex => {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? "#1E2622" : "#FFFFFF";
  };

  // ---------- 글씨 — 이름표(발밑)·말풍선(머리 위) ----------
  function roundBox(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x + 0.5, y + 0.5, w, h, r); }
  function nameTags(ctx) {
    const tags = [], fs = st.view.small ? 10 : 12, th = fs + 6;
    ctx.font = `600 ${fs}px ${FONT}`;
    for (const p of L.people.values()) {
      if (!p.box || p.alpha < 0.3) continue;
      const [x, y] = scr(p.x, p.feet);
      tags.push({ p, x, y: y + 3, w: ctx.measureText(p.name).width + 18, h: th });
    }
    tags.sort((a, b) => a.y - b.y);
    const placed = [];
    for (const g of tags) {                    // 겹치면 아래로 비켜 쌓는다
      for (let k = 0; k < 6; k++) {
        const o = placed.find(q => Math.abs(q.x - g.x) < (q.w + g.w) / 2 + 2 && g.y < q.y + q.h + 1 && g.y + g.h > q.y - 1);
        if (!o) break;
        g.y = o.y + o.h + 2;
      }
      placed.push(g);
      const lx = Math.round(g.x - g.w / 2), on = g.p.id === st.sel;   // 고른 사람 이름표는 그 색으로 채운다
      ctx.fillStyle = on ? g.p.color : "rgba(255, 255, 255, .9)";
      ctx.strokeStyle = on ? "rgba(20, 30, 25, .5)" : "rgba(20, 30, 25, .14)";
      ctx.lineWidth = 1;
      roundBox(ctx, lx, g.y, g.w, g.h, 3); ctx.fill(); ctx.stroke();
      ctx.fillStyle = on ? inkOn(g.p.color) : g.p.color;
      ctx.beginPath(); ctx.arc(lx + 8, g.y + g.h / 2 + 0.5, 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = on ? inkOn(g.p.color) : "#1E2622"; ctx.textBaseline = "middle"; ctx.font = `${on ? 800 : 600} ${fs}px ${FONT}`;
      ctx.fillText(g.p.name, lx + 14, g.y + g.h / 2 + 1);
    }
  }
  function bubbles(ctx) {
    const items = [], fs = st.view.small ? 11 : 13;
    const add = (e, text, kind, color) => {
      if (!e.box || e.alpha < 0.3) return;
      const [x, top] = scr(e.x, e.box.top);
      ctx.font = kind === "ask" ? `700 ${fs}px ${FONT}` : `${kind === "work" ? 600 : 500} ${fs}px ${FONT}`;
      const w = ctx.measureText(text).width + (kind === "ask" ? 8 : kind === "work" ? 22 : 16);
      items.push({ x, bottom: top - 4, w, h: kind === "ask" ? fs + 6 : fs + 11, text, kind, color, fs });
    };
    for (const p of L.people.values()) {
      if (p.status === "decision") add(p, OfficeLife.cut(I18N.ask(p.ask, true) || t("needs"), 22), "ask", p.color);
      if (p.bubble) add(p, p.bubble.text, p.bubble.kind, p.color);
    }
    for (const m of L.minis.values()) if (m.bubble) add(m, m.bubble.text, m.bubble.kind, L.people.get(m.owner)?.color);
    items.sort((a, b) => b.bottom - a.bottom);
    const placed = [];
    for (const b of items) {                  // 겹치면 위로 비켜 쌓는다
      for (let k = 0; k < 8; k++) {
        const o = placed.find(q => Math.abs(q.x - b.x) < (q.w + b.w) / 2 + 3 && b.bottom > q.bottom - q.h - 3 && b.bottom - b.h < q.bottom + 3);
        if (!o) break;
        b.bottom = o.bottom - o.h - 4;
      }
      placed.push(b);
      drawBubble(ctx, b);
    }
  }
  function drawBubble(ctx, b) {
    const lx = Math.round(b.x - b.w / 2), ty = Math.round(b.bottom - b.h);
    ctx.textBaseline = "middle";
    if (b.kind === "ask") {                    // 승인 대기 — 빨간 글씨(흰 테두리로 어디서나 읽히게)
      ctx.font = `700 ${b.fs}px ${FONT}`; ctx.textAlign = "center"; ctx.lineJoin = "round";
      ctx.lineWidth = 4; ctx.strokeStyle = "rgba(255, 255, 255, .95)";
      ctx.strokeText(b.text, b.x, ty + b.h / 2);
      ctx.fillStyle = "#D7263D"; ctx.fillText(b.text, b.x, ty + b.h / 2);
      ctx.textAlign = "start";
      return;
    }
    const think = b.kind === "think";
    ctx.fillStyle = think ? "#F2F4F6" : "#FFFFFF";
    ctx.strokeStyle = "rgba(20, 30, 25, .2)"; ctx.lineWidth = 1;
    roundBox(ctx, lx, ty, b.w, b.h, think ? 11 : 6); ctx.fill(); ctx.stroke();
    if (think) {                               // 생각 = 동글동글 꼬리
      ctx.beginPath(); ctx.arc(b.x - 2, ty + b.h + 4, 2.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else {
      ctx.beginPath(); ctx.moveTo(b.x - 5, ty + b.h); ctx.lineTo(b.x, ty + b.h + 6); ctx.lineTo(b.x + 5, ty + b.h); ctx.fill();
    }
    if (b.kind === "work") { ctx.fillStyle = b.color || "#4ADE80"; ctx.fillRect(lx + 4, ty + 5, 3, b.h - 10); }
    ctx.fillStyle = think ? "#3F4A55" : "#1E2622";
    ctx.font = `${b.kind === "work" ? 600 : 500} ${b.fs}px ${FONT}`;
    ctx.fillText(b.text, lx + (b.kind === "work" ? 12 : 8), ty + b.h / 2 + 1);
  }

  // ---------- 한 장 그리기 ----------
  function layout() {
    const cv = $("office-canvas"), box = $("office-box");
    const cw = box.clientWidth, ch = box.clientHeight;
    if (!cw || !ch) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
    cv.style.width = cw + "px"; cv.style.height = ch + "px";
    const s = Math.min(cw / (OFFICE_W - 40), ch / (OFFICE_H - 30));    // 벽 바깥 여백은 조금 잘라도 된다
    st.view = { s, ox: cw / 2 - OFFICE_W / 2 * s, oy: ch / 2 - (OFFICE_H / 2 + 4) * s, dpr, small: cw < 700 };
  }
  const scr = (x, y) => [st.view.ox + x * st.view.s, st.view.oy + y * st.view.s];

  function draw() {
    const cv = $("office-canvas"), ctx = cv.getContext("2d"), v = st.view;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, cv.width, cv.height);
    if (!st.loaded) return;
    ctx.setTransform(v.s * v.dpr, 0, 0, v.s * v.dpr, v.ox * v.dpr, v.oy * v.dpr);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(st.imgs.floor, 0, 0, OFFICE_W, OFFICE_H);
    drawRing(ctx, false);
    // 깊이 순서(발끝 y)대로 — 책상·회의실 의자 등받이도 끼워 넣는다: 앉은 사람(발끝 = 등받이 아래끝 - 2)보다 나중,
    // 의자 앞 통로를 지나는 사람보다 먼저. 그래서 앉은 사람은 허리 아래가 등받이에 가려진다.
    const all = [...L.people.values(), ...L.minis.values(), ...CHAIRS].sort((a, b) => a.y - b.y);
    for (const e of all) (e.chair ? drawChair : e.owner ? drawMini : drawPerson)(ctx, e);
    drawRing(ctx, true);
    if (DEBUG) debugMarks(ctx);
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);    // 글씨는 화면 좌표로 — 사무실을 줄여도 크기 그대로
    for (const q of st.parts) {
      const a = 1 - (L.t - q.born) / q.life;
      const [x, y] = scr(q.x, q.y - (L.t - q.born) * 22);
      ctx.globalAlpha = Math.max(0, a);
      ctx.font = "700 12px ui-monospace, Menlo, Consolas, monospace";
      ctx.fillStyle = q.color;
      ctx.fillText(q.text, x - 8, y);
    }
    ctx.globalAlpha = 1;
    nameTags(ctx);
    bubbles(ctx);
    for (const p of L.people.values()) {
      if (p.extra > 0 && p.box) {
        const [mx, my] = scr(p.x + 30 + 6 * 21, p.y + 34);
        ctx.font = `700 12px ${FONT}`; ctx.fillStyle = "#1E2622"; ctx.fillText(`+${p.extra}`, mx, my);
      }
    }
  }
  const CHAIRS = (A.chairs || []).map(c => ({ chair: c.box, y: c.seat[1] + OfficeLife.SIT_DESK + 1 }));
  function drawChair(ctx, c) {
    const [x, y, w, h] = c.chair;
    ctx.drawImage(st.imgs.chairs, x, y, w, h, x, y, w, h);
  }
  function particles() {
    const t = L.t;
    for (const p of L.people.values()) {
      if (st.parts.length > 60 || t < p.nextPart) continue;
      if (p.act?.work && !p.path.length) {
        p.nextPart = t + rnd(0.5, 1.1);
        const side = Math.random() < 0.5 ? -1 : 1;
        st.parts.push({ x: p.x + side * rnd(14, 26), y: p.y - standOf(p) * rnd(0.55, 0.8), text: pick(OFFICE_CODE),
                        color: p.color, born: t, life: 1.6 });
      } else if (p.act?.sleepy && !p.path.length && t - p.arrivedAt > 8 && !(p.over && t < p.over.until)) {
        p.nextPart = t + rnd(1.6, 2.6);
        st.parts.push({ x: p.x + 12, y: p.y - standOf(p) * 0.75, text: "z", color: "#7A8A99", born: t, life: 2.2 });
      }
    }
    st.parts = st.parts.filter(q => t - q.born < q.life);
  }
  function debugMarks(ctx) {
    ctx.font = "11px monospace";
    ctx.strokeStyle = "rgba(220,0,0,.8)"; ctx.lineWidth = 3;
    for (const [a, b] of OFFICE_WALLS) { ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.stroke(); }
    ctx.strokeStyle = "rgba(230,120,0,.9)"; ctx.lineWidth = 2;
    for (const poly of OFFICE_BLOCKS) { ctx.beginPath(); poly.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p))); ctx.closePath(); ctx.stroke(); }
    ctx.strokeStyle = "rgba(0,150,0,.6)";
    ctx.beginPath(); OFFICE_FLOOR.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p))); ctx.closePath(); ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(0,0,170,.35)";
    for (const [a, b] of OFFICE_EDGES) { ctx.beginPath(); ctx.moveTo(...OFFICE_NODES[a]); ctx.lineTo(...OFFICE_NODES[b]); ctx.stroke(); }
    for (const [k, [x, y]] of Object.entries(OFFICE_NODES)) { ctx.fillStyle = "#00A"; ctx.fillRect(x - 3, y - 3, 6, 6); ctx.fillText(k, x + 4, y - 4); }
    ctx.fillStyle = "#C00";
    for (const d of OFFICE_DESKS) ctx.fillRect(d.seat[0] - 4, d.seat[1] - 4, 8, 8);
    ctx.fillStyle = "#0A0";
    for (const list of Object.values(OFFICE_SPOTS)) for (const s of list) ctx.fillRect(s.at[0] - 4, s.at[1] - 4, 8, 8);
    for (const p of L.people.values()) {                  // 가는 길
      if (!p.path.length) continue;
      ctx.strokeStyle = p.color; ctx.beginPath(); ctx.moveTo(p.x, p.y);
      for (const q of p.path) ctx.lineTo(...q);
      ctx.stroke();
    }
  }

  function frame(now) {
    st.raf = requestAnimationFrame(frame);
    if (document.hidden || now - st.last < FRAME_MS) return;
    const dt = Math.min(0.1, (now - (st.last || now)) / 1000);
    st.last = now;
    OfficeLife.update(dt);
    particles();
    draw();
  }

  // ---------- 데이터 ----------
  // Person(CONTRACT 4절) → 하루가 쓰는 모양. 활동(Act)은 지금 언어의 글로 바꿔 넘긴다.
  const norm = d => ({ ...d, id: String(d.id ?? d.path ?? d.name), name: String(d.name ?? d.id ?? "?"),
                       subs: Array.isArray(d.subs) ? d.subs : [], log: Array.isArray(d.log) ? d.log : [] });
  const toLife = d => ({
    id: d.id, name: d.name, status: d.status, ask: d.ask, kid: d.kid, home: d.home, commits: d.commits, path: d.path,
    doing: I18N.act(d.doing), subCount: d.subCount || 0,
    subs: d.subs.map(s => ({ id: String(s.id), type: s.type || "", desc: s.desc || "", doing: I18N.act(s.doing) })),
  });
  async function load() {
    if (document.hidden) return;
    try {
      const res = await fetch("/api/office", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const body = await res.json();
      const people = (Array.isArray(body?.people) ? body.people : []).filter(d => d && (d.id || d.path || d.name)).map(norm);
      st.people = people;
      st.meta = { hooks: body.hooks !== false, demo: !!body.demo };
      st.failNet = false;
      OfficeLife.sync(people.map(toLife));
      if (st.sel && !people.some(p => p.id === st.sel)) st.sel = null;     // 퇴근한 사람은 고르기 해제
      OfficePanel.collect(people, OfficeLife.drainEvents());
      OfficePanel.render(people, st.sel);
    } catch {
      st.failNet = true;
    }
    bar();
  }
  // 위 막대(상태 요약·데모 표시)와 캔버스 위 안내 줄
  function bar() {
    const ppl = st.people;
    const c = s => (ppl || []).filter(p => OfficePanel.modeOf(p) === s).length;
    const subs = (ppl || []).reduce((n, p) => n + (p.subCount || 0), 0);
    $("summary").textContent = ppl ? t("sum", { w: c("working"), d: c("decision"), r: c("rest") }) + (subs ? t("sum.subs", { n: subs }) : "") : "";
    $("demo").hidden = !st.meta?.demo;
    const notes = [];
    if (st.failImg) notes.push(t("note.img"));
    if (st.failNet) notes.push(t("note.net"));
    else if (!ppl) notes.push(t("note.loading"));
    else {
      if (!ppl.length) notes.push(t("note.empty"));
      if (st.meta && !st.meta.hooks) notes.push(t("note.hooks"));
    }
    const box = $("notice");
    box.replaceChildren(...notes.map(n => { const p = document.createElement("p"); p.textContent = n; return p; }));
    box.hidden = !notes.length;
  }

  // ---------- 고르기 — 캐릭터나 목록을 누르면 그 사람을 펼쳐 보이고 발밑에 고리 ----------
  function hit(ev) {
    const r = $("office-canvas").getBoundingClientRect();
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    const all = [...L.people.values(), ...L.minis.values()].filter(e => e.box && e.alpha > 0.3).sort((a, b) => b.y - a.y);
    for (const e of all) {
      const [bx, by] = scr(e.box.x, e.box.y), w = e.box.w * st.view.s, h = e.box.h * st.view.s;
      if (x >= bx && x <= bx + w && y >= by && y <= by + h) return e.owner || e.id;
    }
    return null;
  }
  // 같은 사람을 다시 누르면 해제. keep = 해제하지 않고 고르기만(로그 줄을 누를 때)
  function select(id, keep) {
    st.sel = id && (keep || id !== st.sel) ? id : null;
    OfficePanel.render(st.people || [], st.sel, { focus: !!st.sel });
  }

  // ---------- 고정 문구·언어 ----------
  function applyText() {
    document.title = t("title");
    for (const e of document.querySelectorAll("[data-i18n]")) e.textContent = t(e.dataset.i18n);
    for (const e of document.querySelectorAll("[data-i18n-aria]")) e.setAttribute("aria-label", t(e.dataset.i18nAria));
    for (const b of document.querySelectorAll("#lang button")) b.setAttribute("aria-pressed", b.dataset.lang === I18N.lang ? "true" : "false");
  }

  // 시험·점검용 — 지금 사무실에 누가 어디서 무엇을 하는지(화면 좌표 포함)
  window.officeDebug = () => [...L.people.values()].map(p => ({
    id: p.id, name: p.name, species: p.species, color: p.color, kid: !!p.kid, status: p.status, home: p.home,
    act: p.path.length ? "walk" : p.act?.work ? "desk" : p.act?.hop ? "ask" : (p.act?.pose || "idle"),
    pose: p.box ? poseOf(p, L.t) : null, bubble: p.bubble?.text || "", selected: p.id === st.sel,
    minis: [...L.minis.values()].filter(m => m.owner === p.id && (m.state === "wait" || m.state === "in")).length,
    at: p.box ? scr(p.x, p.box.top + p.box.h * 0.55) : null,
    minisAt: [...L.minis.values()].filter(m => m.owner === p.id && m.state === "wait" && m.box)
      .map(m => scr(m.x, m.box.top + m.box.h * 0.6)),
  }));
  window.officeDebug.scr = scr;                    // 테스트가 사무실 좌표 → 캔버스 좌표를 바꿀 때
  window.officeDebug.select = id => select(id, true);

  async function boot() {
    await I18N.init();
    applyText();
    for (const b of document.querySelectorAll("#lang button")) b.onclick = () => I18N.setLang(b.dataset.lang);
    I18N.onChange(() => {
      applyText();
      if (st.people) OfficeLife.sync(st.people.map(toLife));   // 말풍선 글도 새 언어로
      OfficePanel.relabel();
      bar();
    });
    OfficePanel.onPick((id, keep) => select(id, keep));
    const cv = $("office-canvas");
    cv.addEventListener("click", ev => select(hit(ev)));
    cv.addEventListener("mousemove", ev => { cv.style.cursor = hit(ev) ? "pointer" : "default"; });
    new ResizeObserver(layout).observe($("office-box"));
    document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });
    loadImages();
    layout();
    bar();
    load();
    setInterval(load, POLL_MS);
    setInterval(() => { if (!document.hidden) OfficePanel.drip(); }, 450);
    st.raf = requestAnimationFrame(frame);
  }
  boot();
})();
