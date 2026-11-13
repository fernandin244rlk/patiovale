// Condução livre: segue os AMVs como estiverem alinhados e para antes de cada AMV de ponta (para o operador alinhar).
// Lógica pura (sem three.js).
import { exits } from './track.js';

export const MARGIN = 9;      // m entre a frente da composição e a ponta de agulha ao parar
const TAL_MARGIN = 6;         // m antes de um AMV contra a rota (talão)
const CONTACT_GAP = 0.9;      // folga entre os engates ao encostar (igual a GAP de consist.js)

// acha a aresta em que está a frente da composição e o sentido de marcha
export function locate(Y, x, z, ang) {
  const hx = Math.cos(ang), hz = Math.sin(ang), cand = [];
  for (const e of Y.edges) {
    const P = e.poly; let bd = 1e9, bs = 0;
    for (let i = 1; i < P.pts.length; i++) {
      const a = P.pts[i - 1], b = P.pts[i], dx = b.x - a.x, dz = b.z - a.z, l2 = dx * dx + dz * dz || 1e-9;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / l2)), px = a.x + dx * t, pz = a.z + dz * t, d = Math.hypot(x - px, z - pz);
      if (d < bd) { bd = d; bs = P.cum[i - 1] + t * Math.sqrt(l2); }
    }
    if (bd > 0.7) continue;
    const q = P.at(bs), dot = Math.cos(q.ang) * hx + Math.sin(q.ang) * hz;
    if (Math.abs(dot) < 0.45) continue;
    const t = dot >= 0 ? 'b' : 'a', rem = t === 'b' ? P.len - bs : bs;
    cand.push({ edge: e, t, s: bs, rem, d: bd });
  }
  if (!cand.length) return null;
  const ahead = cand.filter(c => c.rem > 0.05).sort((a, b) => a.d - b.d || b.rem - a.rem);
  return ahead[0] || cand.sort((a, b) => a.d - b.d)[0];
}

// pontos de uma aresta no sentido de marcha, a partir de s
function edgePts(e, t, s) {
  const P = e.poly, out = [];
  if (t === 'b') { for (let i = 0; i < P.pts.length; i++) if (P.cum[i] > s + 1e-6) out.push({ x: P.pts[i].x, z: P.pts[i].z }); }
  else { for (let i = P.pts.length - 1; i >= 0; i--) if (P.cum[i] < s - 1e-6) out.push({ x: P.pts[i].x, z: P.pts[i].z }); }
  return out;
}
function cut(pts, d) { // corta a polilinha em d metros
  const out = [pts[0]]; let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], l = Math.hypot(b.x - a.x, b.z - a.z);
    if (acc + l >= d - 1e-9) { const t = l ? (d - acc) / l : 0; out.push({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }); return out; }
    out.push(b); acc += l;
  }
  return out;
}

// Constrói o caminho à frente da composição c e decide onde ela para.
// opts: { amv: bool (parar antes de AMV de ponta), others: [Consist], gap }
export function buildAhead(Y, c, opts = {}) {
  const f = c.front(), loc = locate(Y, f.x, f.z, f.ang);
  if (!loc) return null;
  const pts = [{ x: f.x, z: f.z }], events = []; let dist = 0;
  const push = arr => { for (const p of arr) { const l = pts[pts.length - 1]; dist += Math.hypot(p.x - l.x, p.z - l.z); pts.push(p); } };
  let cur = { e: loc.edge, t: loc.t }; push(edgePts(cur.e, cur.t, loc.s));
  for (let it = 0; it < 80 && dist < 2500; it++) {
    const node = cur.e[cur.t].n, port = cur.e[cur.t].p, nd = dist, ex = exits(node, port);
    let nextPort = null;
    if (node.type === 'switch') {
      if (port === 'base') { events.push({ dist: nd, type: 'amv', sw: node.sw }); nextPort = ex[node.sw.state].port; }
      else { const need = ex[0].set; if (node.sw.state !== need) events.push({ dist: nd, type: 'talao', sw: node.sw, need }); nextPort = 'base'; }
    } else if (node.type === 'join' || node.type === 'cross') nextPort = ex[0].port;
    else { events.push({ dist: nd, type: 'end', node }); break; }
    const ent = node.ports[nextPort]; if (!ent) { events.push({ dist: nd, type: 'end', node }); break; }
    const nt = ent.end === 'a' ? 'b' : 'a'; cur = { e: ent.edge, t: nt };
    push(edgePts(cur.e, cur.t, nt === 'b' ? 0 : ent.edge.poly.len));
  }
  // onde para
  let stop = dist, reason = 'fim', info = null;
  for (const ev of events) {
    let s = null;
    if (ev.type === 'amv') { if (opts.amv && ev.dist > MARGIN + 0.6) { s = ev.dist - MARGIN; } }
    else if (ev.type === 'talao') { s = Math.max(0, ev.dist - TAL_MARGIN); }
    else if (ev.type === 'end') { s = Math.max(0, ev.dist - (ev.node.type === 'buffer' ? 1.6 : 0.6)); }
    if (s !== null && s < stop) { stop = s; reason = ev.type; info = ev; }
    if (s !== null) break; // eventos vêm em ordem; o primeiro que para vale
  }
  // contato com outra composição à frente
  const gap = opts.gap ?? CONTACT_GAP;
  const ends = [];
  for (const o of (opts.others || [])) { if (o === c) continue; for (const p of [o.front(), o.rear()]) ends.push({ o, x: p.x, z: p.z }); }
  if (ends.length) {
    let acc = 0, hit = null;
    for (let i = 1; i < pts.length && acc < stop + 1 && !hit; i++) {
      const a = pts[i - 1], b = pts[i], l = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(l / 0.25));
      for (let k = (i === 1 ? 0 : 1); k <= n; k++) {
        const t = k / n, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t, d = acc + l * t;
        for (const e of ends) if (Math.hypot(e.x - x, e.z - z) <= gap + 0.1) { hit = { d, o: e.o }; break; }
        if (hit) break;
      }
      acc += l;
    }
    if (hit && hit.d < stop) { stop = hit.d; reason = 'contato'; info = { other: hit.o }; }
  }
  return { pts: cut(pts, Math.max(0, stop)), stop, total: dist, reason, info, events };
}
