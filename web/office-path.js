"use strict";
// 사무실 사람들의 몸 — 벽·바닥 판정, 통로 길 찾기, 한 걸음 걷기(끼임 풀기), 서로 안 겹치기.
// 지도는 office-world.js, 무엇을 할지(하루)는 office-life.js.

const OfficePath = (() => {
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  // ---------- 벽·바닥 — 선분이 벽을 가로지르는가, 점이 바닥 안인가 ----------
  const orient = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  function cross(p1, p2, q1, q2) {
    const d1 = orient(q1, q2, p1), d2 = orient(q1, q2, p2), d3 = orient(p1, p2, q1), d4 = orient(p1, p2, q2);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0)) && d1 !== 0 && d2 !== 0;
  }
  const EDGES = [...OFFICE_WALLS, ...OFFICE_BLOCKS.flatMap(poly => poly.map((pt, i) => [pt, poly[(i + 1) % poly.length]]))];
  const blocked = (a, b) => EDGES.some(([q1, q2]) => cross(a, b, q1, q2));
  function inPoly([x, y], poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  const onFloor = pt => inPoly(pt, OFFICE_FLOOR) && !OFFICE_BLOCKS.some(poly => inPoly(pt, poly));
  // 한 걸음(a→b)이 괜찮은가 — 바닥 안이고 벽을 안 넘는다
  const canMove = (a, b) => onFloor(b) && !blocked(a, b);

  // ---------- 길 찾기 — 통로 점을 잇는 최단 경로 ----------
  const ADJ = {};
  for (const [a, b] of OFFICE_EDGES) {
    const d = dist(OFFICE_NODES[a], OFFICE_NODES[b]);
    (ADJ[a] ||= []).push([b, d]);
    (ADJ[b] ||= []).push([a, d]);
  }
  function nearest(pt) {                    // 벽 너머의 점은 아무리 가까워도 고르지 않는다
    let best = null, bd = Infinity, any = null, ad = Infinity;
    for (const [k, p] of Object.entries(OFFICE_NODES)) {
      const d = dist(p, pt);
      if (d < ad) { ad = d; any = k; }
      if (d < bd && !blocked(pt, p)) { bd = d; best = k; }
    }
    return best || any;
  }
  function nodePath(a, b) {
    const d = { [a]: 0 }, prev = {}, todo = new Set(Object.keys(OFFICE_NODES));
    while (todo.size) {
      let u = null;
      for (const k of todo) if (d[k] !== undefined && (u === null || d[k] < d[u])) u = k;
      if (u === null || u === b) break;
      todo.delete(u);
      for (const [v, w] of ADJ[u] || []) if (d[u] + w < (d[v] ?? Infinity)) { d[v] = d[u] + w; prev[v] = u; }
    }
    const out = [];
    for (let k = b; k; k = prev[k]) { out.unshift(OFFICE_NODES[k]); if (k === a) break; }
    return out;
  }
  function route(from, to, via) {
    if (dist(from, to) < 60 && !blocked(from, to)) return [to];
    const pts = nodePath(nearest(from), via || nearest(to));
    while (pts.length > 1 && dist(from, pts[1]) < dist(pts[0], pts[1]) && !blocked(from, pts[1])) pts.shift();
    return [...pts, to];
  }
  function segDist(pt, a, b) {
    const vx = b[0] - a[0], vy = b[1] - a[1], l2 = vx * vx + vy * vy || 1;
    const k = Math.max(0, Math.min(1, ((pt[0] - a[0]) * vx + (pt[1] - a[1]) * vy) / l2));
    return Math.hypot(pt[0] - a[0] - k * vx, pt[1] - a[1] - k * vy);
  }

  return { dist, blocked, onFloor, canMove, nearest, route, segDist };
})();

// 걷기·밀어내기 — 하루(office-life.js)의 상태 L 을 받아 그 사람들을 움직인다
function officeMotion(L, SIT_DESK) {
  const { dist, blocked, onFloor, canMove, nearest, route, segDist } = OfficePath;

  // ---------- 한 걸음 ----------
  // 막힘 풀기 — 통로 점 바로 옆에 앉은 사람·승인 대기로 폴짝 뛰는 사람은 안 밀린다(무게 0). 그러면 그 점을
  // 지나야 하는 사람이 밀려났다 다시 다가가기를 끝없이 되풀이했다(빨리 감기 실측: 20분에 끼임 238건). 그래서
  // 같은 점에 1초 넘게 못 다가가면: 다음 점이 바로 보이면 이 점은 건너뛰고, 아니면 옆으로 비켜 도는 점을
  // 하나 끼운다(좌우 번갈아). 마지막 점(앉을 자리)인데 6초 넘게 못 가면 그 자리로 옮겨 놓는다.
  const UNSTICK_S = 1, UNSTICK_JUMP = 6;
  // 지름길이 남의 의자 곁(앉는 점 22픽셀 안)을 지나는가 — 의자는 벽이 아니라서 따로 본다(목적지 의자는 빼고)
  const SEATS = (OFFICE_ATLAS.chairs || []).map(c => [c.seat[0], c.seat[1] + SIT_DESK]);
  // 출발점 바로 곁(30픽셀 안)의 의자는 뺀다 — 방금 일어난 자기 의자에서 멀어지는 걸음까지 막으면 못 움직인다
  const nearChair = (a, b, goal) => SEATS.some(q => dist(q, goal) > 4 && dist(q, a) > 30 && segDist(q, a, b) < 22);
  function unstick(e, d) {
    const to = e.path[0], g = e.prog;
    if (!g || g.to !== to) { e.prog = { to, best: d, t: L.t, side: g?.side || 1, stuck: g?.stuck || 0 }; return; }
    if (d < g.best - 2) { g.best = d; g.t = L.t; g.stuck = 0; return; }
    if (L.t - g.t < UNSTICK_S) return;
    g.t = L.t; g.best = d; g.stuck++;
    const here = [e.x, e.y];
    const goal = e.path[e.path.length - 1];
    // 남의 의자 곁을 지나는 지름길은 3초 넘게 막혔을 때만(등받이 뒤로 걸어 다니지 않게)
    if (e.path.length > 1 && !blocked(here, e.path[1]) && (g.stuck >= 3 || !nearChair(here, e.path[1], goal))) { e.path.shift(); return; }
    if (g.stuck >= UNSTICK_JUMP && (d < 90 || g.stuck >= 10) && onFloor(to) && !blocked(here, to)) { e.x = to[0]; e.y = to[1]; return; }
    const vx = to[0] - e.x, vy = to[1] - e.y, vl = Math.hypot(vx, vy) || 1;
    for (const s of [g.side, -g.side]) {
      const side = [e.x - vy / vl * 26 * s + vx / vl * 8, e.y + vx / vl * 26 * s + vy / vl * 8];
      if (canMove(here, side) && !blocked(side, to) && !nearChair(here, side, goal) && !nearChair(side, to, goal)) {
        e.path.unshift(side); g.side = -s; return;
      }
    }
  }
  function step(e, speed, dt, rate) {
    if (!e.path.length) return false;
    if (rate) e.wp = (e.wp || 0) + dt * rate;             // 서브에이전트 걸음 위상 — π 마다 한 걸음(그리기가 이걸로 다리를 바꾼다)
    if (blocked([e.x, e.y], e.path[0])) {
      const goal = e.path[e.path.length - 1];
      e.path = route([e.x, e.y], goal);
      if (blocked([e.x, e.y], e.path[0])) e.path.unshift(OFFICE_NODES[nearest([e.x, e.y])]);
    }
    unstick(e, dist([e.x, e.y], e.path[0]));
    const [tx, ty] = e.path[0];
    const dx = tx - e.x, dy = ty - e.y, d = Math.hypot(dx, dy);
    const mv = rate ? speed * dt * (0.7 + 0.6 * Math.abs(Math.sin(e.wp))) : speed * dt;   // 어른은 고르게(저벅저벅)
    e.vx = dx; e.vy = dy;
    e.dist = (e.dist || 0) + Math.min(d, mv);            // 걸은 거리 — 어른 걷기 그림은 이걸로 장을 넘긴다
    if (d <= mv) { e.x = tx; e.y = ty; e.path.shift(); return !e.path.length; }
    e.x += dx / d * mv; e.y += dy / d * mv;
    return false;
  }

  // ---------- 안 겹치기 — 발밑 타원끼리 밀어낸다 ----------
  // 아이소 바닥이라 가로로 넓고 세로로 얇은 타원. 앉은 사람·일하는 사람·승인 대기는 자리에 박혀 있어야
  // 가구와 맞으므로 고정(밀리지 않는다), 서 있는 사람은 조금, 걷는 사람·서브에이전트는 많이 밀린다. 걷는
  // 사람이 고정된 사람에 막히면 정면으로 밀려 멈추지 않게 진행 방향의 옆으로 비켜 돌아간다.
  const STAND_PX = 96;
  function sizeOf(e) {
    if (e.owner) return STAND_PX * 0.5 * (L.people.get(e.owner)?.kid ? 0.7 : 1);
    return STAND_PX * (e.kid ? 0.7 : 1);
  }
  function weightOf(e) {
    if (e.gone || e.alpha < 0.2) return -1;                       // 사라지는 중 — 부딪히지 않는다
    if (e.owner) return e.state === "wait" && !e.path.length ? 0.6 : 1;
    if (e.path.length) return 1;
    const a = e.act;
    if (!a || a.fixed || a.work || a.hop || /^sit/.test(a.pose)) return 0;
    return 0.5;
  }
  const seating = (e, sitter) => /^sit/.test(sitter.act?.pose || "") && e.path.length && !e.owner
    && /^sit/.test(e.steps?.[e.si + 1]?.pose || "") && dist([e.x, e.y], e.path[e.path.length - 1]) < 48;
  function separate(dt) {
    const ents = [...L.people.values(), ...L.minis.values()];
    const rate = Math.min(1, dt * 10);
    for (let i = 0; i < ents.length; i++) {
      const a = ents[i], wa = weightOf(a);
      if (wa < 0) continue;
      for (let j = i + 1; j < ents.length; j++) {
        const b = ents[j], wb = weightOf(b);
        if (wb < 0 || (wa === 0 && wb === 0)) continue;
        if (a.owner && b.owner && a.owner === b.owner) continue;   // 같은 줄 서브에이전트끼리는 줄 간격이 정한다
        if ((a.owner === b.id && !a.path.length) || (b.owner === a.id && !b.path.length)) continue;
        // 앉은 사람은 옆자리에 앉으러 들어오는 마지막 걸음을 밀어내지 않는다 — 회의실 의자는 46픽셀 간격이라
        // 양옆이 앉아 있으면 가운데 의자에 영영 못 다가갔다
        if ((wa === 0 && seating(b, a)) || (wb === 0 && seating(a, b))) continue;
        const sa = sizeOf(a), sb = sizeOf(b);
        const both = a.path.length && b.path.length;                 // 둘 다 걷는 중 — 엇갈려 지나가게 작게
        const rx = (sa + sb) * (both ? 0.16 : 0.3), ry = (sa + sb) * (both ? 0.06 : 0.14);
        let dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx / rx, dy / ry);
        if (d >= 1) continue;
        if (d < 1e-3) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; }
        const n = Math.hypot(dx / rx, dy / ry) || 1;
        const px = (dx / rx) / n * rx * (1 - d), py = (dy / ry) / n * ry * (1 - d);
        const total = wa + wb, ka = wa / total, kb = wb / total;
        for (const [e, k, sign] of [[a, ka, -1], [b, kb, 1]]) {
          if (!k) continue;
          let mx = sign * px * k * rate, my = sign * py * k * rate;
          if (e.path.length && (sign < 0 ? wb : wa) === 0) {       // 막혔다 — 옆걸음으로 돌아간다
            const vx = e.vx || 0, vy = e.vy || 0, vl = Math.hypot(vx, vy) || 1;
            const side = (vx * my - vy * mx) >= 0 ? 1 : -1;
            mx += -vy / vl * side * 1.2 * rate * 4; my += vx / vl * side * 1.2 * rate * 4;
          }
          const from = [e.x, e.y];
          if (canMove(from, [e.x + mx, e.y + my])) { e.x += mx; e.y += my; }
          else if (canMove(from, [e.x + mx, e.y])) e.x += mx;                 // 벽을 따라 미끄러진다
          else if (canMove(from, [e.x, e.y + my])) e.y += my;
        }
      }
    }
  }

  return { step, separate };
}
