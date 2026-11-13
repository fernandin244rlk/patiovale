// Geometria e grafo de vias do pátio (lógica pura, sem three.js)
export const GAUGE = 1.435, HG = GAUGE / 2;
const RAD = { 6: 120, 8: 190, 10: 300 };

export function tparams(N, W) {
  const R = RAD[N] || 190, a = Math.atan(1 / N);
  const xf = R * Math.sin(a), arc = R * (1 - Math.cos(a));
  const Ls = (W - 2 * arc) / Math.sin(a);
  const L = 2 * xf + Ls * Math.cos(a);
  return { N, R, a, xf, arc, Ls, L, W };
}
// deslocamento lateral do eixo da via desviada a u metros da ponta de agulha
export function vAt(p, u) {
  const { R, a, xf, arc, L, W } = p;
  if (u <= 0) return 0;
  if (u >= L) return W;
  if (u <= xf) return R - Math.sqrt(R * R - u * u);
  const u2 = L - u;
  if (u2 <= xf) return W - (R - Math.sqrt(R * R - u2 * u2));
  return arc + (u - xf) * Math.tan(a);
}
export function scurve(p) {
  const n = 2 * Math.ceil(p.L / 6), out = [];
  for (let i = 0; i <= n; i++) { const u = (p.L * i) / n; out.push({ u, v: vAt(p, u) }); }
  return out;
}
// posição (u) do coração: onde o eixo desviado está a 1 bitola do eixo reto
export function frogU(p) {
  let lo = 0, hi = p.L / 2;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (vAt(p, m) < GAUGE) lo = m; else hi = m; }
  return lo;
}

export class Poly {
  constructor(pts) {
    this.pts = pts; this.cum = [0];
    for (let i = 1; i < pts.length; i++) this.cum.push(this.cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    this.len = this.cum[this.cum.length - 1];
  }
  at(s) {
    const c = this.cum, P = this.pts; s = Math.max(0, Math.min(this.len, s));
    let lo = 0, hi = c.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= s) lo = m; else hi = m; }
    const seg = c[hi] - c[lo] || 1, t = (s - c[lo]) / seg;
    const a = P[lo], b = P[hi];
    return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, ang: Math.atan2(b.z - a.z, b.x - a.x) };
  }
}

export function buildYard(o = {}) {
  const N = o.N || 8, BL = o.BL || 380, APP = o.approach || 320, SP = 5, SP6 = 7;
  const p5 = tparams(N, SP), p6 = tparams(N, SP6);
  const sp = p5.L + 8, xT0 = -4 * sp - 40;
  const Y = { N, BL, nodes: [], edges: [], switches: [], crosses: [], buffers: [], zones: [], lines: {}, excl: {}, p5, p6, sp };
  const lz = { L1: 0, L2: 5, L3: 10, L4: 15, L5: 20, L6: -7 };
  Y.lines = lz;
  const chains = {}; for (const k in lz) chains[k] = [];
  let nid = 0, eid = 0;
  const mk = (type, x, z, ex = {}) => { const n = { id: nid++, type, x, z, ports: {}, ...ex }; Y.nodes.push(n); return n; };
  const link = (nA, pA, nB, pB, pts, ex = {}) => {
    const e = { id: eid++, pts, a: { n: nA, p: pA }, b: { n: nB, p: pB }, ...ex };
    e.poly = new Poly(pts); nA.ports[pA] = { edge: e, end: 'a' }; nB.ports[pB] = { edge: e, end: 'b' };
    Y.edges.push(e); return e;
  };
  const addSwitch = (name, line, x, f, s, p) => {
    const n = mk('switch', x, lz[line], { sw: { name, line, x, z: lz[line], f, s, p, state: 0 } });
    n.sideW = f > 0 ? 'base' : 'straight'; n.sideE = f > 0 ? 'straight' : 'base';
    n.sw.node = n; Y.switches.push(n.sw); chains[line].push(n);
    (Y.excl[line] = Y.excl[line] || []).push(f > 0 ? [x, x + 31.5] : [x - 31.5, x]);
    return n;
  };
  const addJoin = (line, x, curveSide) => {
    const n = mk('join', x, lz[line], { curveSide }); n.sideW = 'W'; n.sideE = 'E'; chains[line].push(n); return n;
  };
  const addEnd = (line, x, side, ex = {}) => {
    const n = mk(ex.buffer ? 'buffer' : 'open', x, lz[line], { lead: !ex.buffer, ...ex });
    n.sideW = n.sideE = 'e'; chains[line].push(n); return n;
  };
  const sCurve = (nA, nB, p, x0, zA, f, s) => scurve(p).map(q => ({ x: x0 + f * q.u, z: zA + s * q.v }));

  // ---- cabeceira esquerda (escada em cascata) ----
  const L = {}, R = {};
  addEnd('L1', xT0 - APP, 'W');
  L.T0 = addSwitch('T0', 'L1', xT0, 1, -1, p6);
  const J0 = addJoin('L6', xT0 + p6.L, 'W');
  link(L.T0, 'div', J0, 'W', sCurve(L.T0, J0, p6, xT0, 0, 1, -1), { kind: 'curve' });
  let prevL = 'L1';
  for (let k = 1; k <= 4; k++) {
    const x = -(5 - k) * sp, from = 'L' + k, to = 'L' + (k + 1);
    L[k] = addSwitch('T' + k, from, x, 1, 1, p5);
    const j = addJoin(to, x + p5.L, 'W');
    link(L[k], 'div', j, 'W', sCurve(L[k], j, p5, x, lz[from], 1, 1), { kind: 'curve' });
  }
  // ---- cabeceira direita (espelho) ----
  for (let k = 1; k <= 4; k++) {
    const x = BL + (5 - k) * sp, from = 'L' + k, to = 'L' + (k + 1);
    R[k] = addSwitch("T" + k + "'", from, x, -1, 1, p5);
    const j = addJoin(to, x - p5.L, 'E');
    link(R[k], 'div', j, 'E', sCurve(R[k], j, p5, x, lz[from], -1, 1), { kind: 'curve' });
  }
  addEnd('L1', BL + 4 * sp + APP, 'E');
  addEnd('L6', 250, 'E', { buffer: true });
  Y.buffers.push({ x: 250, z: lz.L6 });

  // ---- opções: comunicações e tesouras ----
  const X = { name: o.preset || 'A' };
  const crossover = (nm, lA, lB, x0) => {
    const W = Math.abs(lz[lB] - lz[lA]), p = tparams(N, W), s = Math.sign(lz[lB] - lz[lA]);
    Y.zones.push({ line: lA, x1: x0 - 4, x2: x0 + p.L + 4 }, { line: lB, x1: x0 - 4, x2: x0 + p.L + 4 });
    const a = addSwitch(nm + 'a', lA, x0, 1, s, p), b = addSwitch(nm + 'b', lB, x0 + p.L, -1, -s, p);
    link(a, 'div', b, 'div', sCurve(a, b, p, x0, lz[lA], 1, s), { kind: 'curve' });
    return { a, b, p };
  };
  const scissors = (nm, lA, lB, x0) => {
    const W = Math.abs(lz[lB] - lz[lA]), p = tparams(N, W), s = Math.sign(lz[lB] - lz[lA]);
    Y.zones.push({ line: lA, x1: x0 - 4, x2: x0 + p.L + 4 }, { line: lB, x1: x0 - 4, x2: x0 + p.L + 4 });
    const a1 = addSwitch(nm + 'a', lA, x0, 1, s, p), b1 = addSwitch(nm + 'b', lB, x0 + p.L, -1, -s, p);
    const a2 = addSwitch(nm + 'c', lB, x0, 1, -s, p), b2 = addSwitch(nm + 'd', lA, x0 + p.L, -1, s, p);
    const c1 = sCurve(a1, b1, p, x0, lz[lA], 1, s), c2 = sCurve(a2, b2, p, x0, lz[lB], 1, -s);
    const m = c1.length >> 1;
    const cx = mk('cross', c1[m].x, c1[m].z); Y.crosses.push({ x: c1[m].x, z: c1[m].z, ang: Math.atan2(c1[m + 1].z - c1[m - 1].z, c1[m + 1].x - c1[m - 1].x), ang2: Math.atan2(c2[m + 1].z - c2[m - 1].z, c2[m + 1].x - c2[m - 1].x) });
    link(a1, 'div', cx, 's1a', c1.slice(0, m + 1), { kind: 'curve' }); link(cx, 's1b', b1, 'div', c1.slice(m), { kind: 'curve' });
    link(a2, 'div', cx, 's2a', c2.slice(0, m + 1), { kind: 'curve' }); link(cx, 's2b', b2, 'div', c2.slice(m), { kind: 'curve' });
  };
  const pr = o.preset || 'A';
  const ext = (o.extras || []);
  const has = k => ext.includes(k) || (pr === 'B' && (k === 'x12' || k === 'x23')) || (pr === 'C' && (k === 's23' || k === 's45')) || (pr === 'D');
  if (has('x12')) crossover('X12', 'L1', 'L2', 60);
  if (has('x23')) crossover('X23', 'L2', 'L3', 300);
  if (has('s23')) scissors('S23', 'L2', 'L3', 230);
  if (has('s45')) scissors('S45', 'L4', 'L5', 230);
  Y.preset = pr;

  // ---- trechos retos de cada linha ----
  for (const k in chains) {
    const ch = chains[k].sort((a, b) => a.x - b.x);
    for (let i = 0; i + 1 < ch.length; i++) {
      const n1 = ch[i], n2 = ch[i + 1];
      link(n1, n1.sideE, n2, n2.sideW, [{ x: n1.x, z: lz[k] }, { x: n2.x, z: lz[k] }], { kind: 'line', line: k, x1: n1.x, x2: n2.x });
    }
  }
  Y.extent = { x1: xT0 - APP, x2: BL + 4 * sp + APP };
  return Y;
}

// ---------- roteamento ----------
const PAIR = { s1a: 's1b', s1b: 's1a', s2a: 's2b', s2b: 's2a' };
export function exits(n, port) {
  switch (n.type) {
    case 'switch':
      if (port === 'base') return [{ port: 'straight', set: 0 }, { port: 'div', set: 1 }];
      return [{ port: 'base', set: port === 'straight' ? 0 : 1 }];
    case 'join': return [{ port: port === 'W' ? 'E' : 'W' }];
    case 'cross': return [{ port: PAIR[port] }];
    case 'open': return n.lead ? [{ port, reverse: true }] : [];
    default: return [];
  }
}
export function lineEdgeAt(Y, line, x) {
  return Y.edges.find(e => e.kind === 'line' && e.line === line && x >= e.x1 - 1e-6 && x <= e.x2 + 1e-6);
}
const key = (e, t) => e.id + t;

// Planeja o movimento: sai de (startEdge, toward, leadX) até a linha 'line' com a ponta em stopX.
export function planMove(Y, startEdge, toward, leadX, line, stopX) {
  const startKey = key(startEdge, toward);
  const goal = (e, t, first) => {
    if (e.kind !== 'line' || e.line !== line || stopX < e.x1 - 1e-6 || stopX > e.x2 + 1e-6) return false;
    if (!first) return true;
    return toward === 'b' ? stopX >= leadX : stopX <= leadX;
  };
  if (goal(startEdge, toward, true)) return { legs: [{ pts: [{ x: leadX, z: Y.lines[startEdge.line] }, { x: stopX, z: Y.lines[startEdge.line] }], sets: [] }] };
  const prev = new Map(); prev.set(startKey, null);
  const q = [{ e: startEdge, t: toward }]; let found = null;
  while (q.length) {
    const cur = q.shift();
    const node = cur.e[cur.t].n, port = cur.e[cur.t].p;
    for (const ex of exits(node, port)) {
      const ent = node.ports[ex.port]; if (!ent) continue;
      const nt = ex.reverse ? (cur.t === 'a' ? 'b' : 'a') : (ent.end === 'a' ? 'b' : 'a');
      const ne = ent.edge, k = key(ne, nt);
      if (prev.has(k)) continue;
      prev.set(k, { from: cur, ex, node });
      const st = { e: ne, t: nt };
      if (goal(ne, nt, false)) { found = st; break; }
      q.push(st);
    }
    if (found) break;
  }
  if (!found) return null;
  const steps = []; let c = found;
  while (c) { const pv = prev.get(key(c.e, c.t)); steps.unshift({ e: c.e, t: c.t, via: pv }); c = pv ? pv.from : null; }
  // monta as pernas
  const legs = []; let pts = [], sets = [];
  const oriented = (e, t) => (t === 'b' ? e.pts.slice() : e.pts.slice().reverse());
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (i === 0) { const z = Y.lines[s.e.line]; pts.push({ x: leadX, z }); const o = oriented(s.e, s.t).filter(p => (s.t === 'b' ? p.x > leadX : p.x < leadX)); pts.push(...o); continue; }
    const ex = s.via.ex, node = s.via.node;
    if (ex.set !== undefined && node.type === 'switch') sets.push({ sw: node.sw, state: ex.set, facing: s.via.from.e[s.via.from.t].p === 'base', pos: { x: node.x, z: node.z } });
    if (ex.reverse) {
      const endp = pts[pts.length - 1]; const bx = endp.x + (s.t === 'b' ? -8 : 8) * 0; // para na ponta
      legs.push({ pts, sets }); pts = [{ x: endp.x, z: endp.z }]; sets = [];
    }
    let o = oriented(s.e, s.t);
    if (i === steps.length - 1) {
      const cut = []; for (const p of o) { cut.push(p); }
      o = [{ x: o[0].x, z: o[0].z }, { x: stopX, z: o[0].z }];
    }
    pts.push(...o.slice(1));
  }
  legs.push({ pts, sets });
  // pernas de reversão param 6 m antes da ponta aberta
  for (let i = 0; i < legs.length - 1; i++) {
    const l = legs[i], P = l.pts, a = P[P.length - 2], b = P[P.length - 1];
    const d = Math.hypot(b.x - a.x, b.z - a.z), k = Math.max(0, d - 6) / (d || 1);
    P[P.length - 1] = { x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k };
    legs[i + 1].pts[0] = { ...P[P.length - 1] };
  }
  return { legs };
}
