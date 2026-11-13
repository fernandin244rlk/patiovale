import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildYard, planMove, lineEdgeAt, Poly } from './track.js';
import { makeMats, buildTrack } from './geom.js';
import { SwitchView, buildDiamond } from './amv.js';
import { buildScenery } from './scenery.js';
import { loadModels, instantiate } from './models.js';
import { Consist, makeConsist, merge, mergeContact, crop as cropPoly, GAP } from './consist.js';
import { buildAhead, MARGIN } from './drive.js';

const $ = id => document.getElementById(id);
const S = { opts: { N: 8, preset: 'A', act: 'manual', loaded: true }, consists: [], views: [], speed: 3, selC: null, selK: null, follow: null, busy: false, labels: true, markers: true, paused: false, eb: false, stopAMV: true, autoCouple: true, waiting: null, hintSw: null, resume: null };
const logEl = $('log');
export function log(msg, cls = '') {
  const d = document.createElement('div'); d.textContent = msg; if (cls) d.className = cls; logEl.prepend(d);
  while (logEl.children.length > 40) logEl.lastChild.remove();
}
window.addEventListener('error', e => log('Erro: ' + e.message, 'err'));
window.addEventListener('unhandledrejection', e => log('Erro: ' + (e.reason && e.reason.message || e.reason), 'err'));

// ---------- cena ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0; renderer.outputColorSpace = THREE.SRGBColorSpace;
$('stage').appendChild(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color(0xb9d0e2); scene.fog = new THREE.Fog(0xb9d0e2, 500, 2600);
const pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; scene.environmentIntensity = 0.55;
const cam = new THREE.PerspectiveCamera(48, 1, 0.3, 6000);
const controls = new OrbitControls(cam, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = 0.08; controls.maxPolarAngle = Math.PI * 0.49; controls.maxDistance = 1800; controls.minDistance = 4;
scene.add(new THREE.HemisphereLight(0xdfeaf6, 0x6b6a55, 1.0));
const sun = new THREE.DirectionalLight(0xfff1d8, 2.6); sun.position.set(120, 180, 80); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); const sc = sun.shadow.camera; sc.left = -90; sc.right = 90; sc.top = 90; sc.bottom = -90; sc.near = 10; sc.far = 500; sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
scene.add(sun, sun.target);
function resize() { const w = $('stage').clientWidth, h = $('stage').clientHeight; renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();

const M = makeMats();
let world = null, vehGroup = null, Y = null, protos = null, diamonds = [];
const markers = [], proxies = [];
const hintRing = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.18, 8, 36), new THREE.MeshBasicMaterial({ color: 0xff3b30, depthTest: false, transparent: true, opacity: 0.95 })); hintRing.rotation.x = Math.PI / 2; hintRing.renderOrder = 9; hintRing.visible = false; scene.add(hintRing);
const selArrow = new THREE.Mesh(new THREE.ConeGeometry(1.1, 2.6, 4), new THREE.MeshBasicMaterial({ color: 0x00d2ff })); selArrow.rotation.x = Math.PI; selArrow.visible = false; scene.add(selArrow);

// ---------- pátio ----------
function lineOf(z) { for (const k in Y.lines) if (Math.abs(Y.lines[k] - z) < 0.3) return k; return null; }
function rebuild() {
  if (world) { scene.remove(world); world.traverse(o => { if (o.geometry && !o.userData.shared) o.geometry.dispose(); }); }
  world = new THREE.Group(); scene.add(world);
  Y = buildYard({ N: S.opts.N, preset: S.opts.preset });
  world.add(buildTrack(Y, M), buildScenery(Y));
  S.views = Y.switches.map(sw => { const v = new SwitchView(sw, M); v.setActuation(S.opts.act); v.setLabels(S.labels); world.add(v.root); return v; });
  for (const c of Y.crosses) world.add(buildDiamond(c, M));
  buildSwitchPanel(); resetScenario();
}
function clearVehicles() {
  if (vehGroup) scene.remove(vehGroup);
  vehGroup = new THREE.Group(); scene.add(vehGroup); S.consists = []; proxies.length = 0; S.selC = S.selK = S.follow = null; S.busy = false;
}
function mkVeh(kind, opt) {
  const obj = instantiate(kind, protos, { loaded: S.opts.loaded, ...opt });
  const d = obj.userData; const half = { loco: 9.7, gondola: 9.03, shunter: 5.79 }[kind];
  const px = new THREE.Mesh(new THREE.BoxGeometry(half * 2, 3.4, 3.2), new THREE.MeshBasicMaterial({ visible: false })); px.position.y = 1.9; obj.add(px);
  const v = { kind, obj, half, def: null, rev: 0, label: '' };
  v.def = { piv: { loco: 5.7, gondola: 5.8, shunter: 2.3 }[kind] }; px.userData.veh = v; proxies.push(px); vehGroup.add(obj); return v;
}
function resetScenario() {
  clearVehicles(); if (!protos) return;
  const Z = Y.lines, add = c => { S.consists.push(c); c.place(); return c; };
  const train = [mkVeh('loco', { paint: 0x2f6f73 })]; for (let i = 0; i < 9; i++) train.push(mkVeh('gondola'));
  train.forEach((v, i) => v.label = i ? 'Vagão ' + i : 'Locomotiva');
  add(makeConsist(train, 8, Z.L3, 'Trem principal'));
  const h = mkVeh('shunter'); h.label = 'Helper'; add(makeConsist([h], 14, Z.L1, 'Locomotiva helper'));
  let n = 1; const loose = (line, x, count, gap) => { for (let i = 0; i < count; i++) { const v = mkVeh('gondola'); v.label = 'Vagão avulso ' + n; add(makeConsist([v], x + i * (18.06 + gap), Z[line], 'Vagão avulso ' + (n++))); } };
  loose('L2', 150, 3, 3); loose('L4', 165, 2, 3); loose('L5', 165, 3, 3); loose('L6', 40, 2, 4);
  buildMarkers(); refreshLists(); controls.update();
}

// ---------- marcadores de engate ----------
function buildMarkers() {
  markers.forEach(m => scene.remove(m)); markers.length = 0;
  const ringM = new THREE.MeshBasicMaterial({ color: 0xffd21a, transparent: true, opacity: 0.9, depthTest: false });
  for (let i = 0; i < 40; i++) {
    const g = new THREE.Group(); g.renderOrder = 5;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.08, 8, 24), ringM.clone()); ring.rotation.y = Math.PI / 2; ring.renderOrder = 5; g.add(ring);
    const link = new THREE.Mesh(new THREE.BoxGeometry(GAP + 0.7, 0.14, 0.14), new THREE.MeshStandardMaterial({ color: 0x2a2c30, metalness: 0.7, roughness: 0.4 })); link.position.y = -0.1; g.add(link);
    const hit = new THREE.Mesh(new THREE.SphereGeometry(1.3, 8, 6), new THREE.MeshBasicMaterial({ visible: false })); g.add(hit); hit.userData.marker = g;
    g.userData = { ring, hit, used: false }; g.visible = false; scene.add(g); markers.push(g);
  }
}
function updateMarkers() {
  let mi = 0;
  for (const c of S.consists) {
    const off = c.offsets();
    for (let i = 0; i + 1 < c.vehicles.length; i++) {
      const m = markers[mi++]; if (!m) return;
      const s = c.sFront - (off[i + 1] - c.vehicles[i + 1].half) + GAP / 2 + (c.vehicles[i].dev + c.vehicles[i + 1].dev) / 2, p = c.poly.at(s);
      m.position.set(p.x, 1.1, p.z); m.rotation.y = -p.ang; m.visible = true; m.userData.cid = c.id; m.userData.k = i;
      m.userData.ring.visible = S.markers; const sel = S.selC === c.id && S.selK === i;
      m.userData.ring.material.color.setHex(sel ? 0xff3b30 : 0xffd21a); m.userData.ring.scale.setScalar(sel ? 1.35 : 1);
    }
  }
  for (; mi < markers.length; mi++) markers[mi].visible = false;
}

// ---------- painel de AMVs ----------
function buildSwitchPanel() {
  const box = $('switches'); box.innerHTML = '';
  for (const sw of Y.switches) {
    const b = document.createElement('button'); b.className = 'chip'; b.dataset.sw = sw.name; b.title = 'Alternar AMV ' + sw.name;
    b.innerHTML = `<span class="dot"></span><b>${sw.name}</b><i></i>`; b.onclick = () => throwSwitch(sw); box.appendChild(b);
  }
  updateChips();
}
function updateChips() {
  document.querySelectorAll('#switches .chip').forEach(b => {
    const sw = Y.switches.find(s => s.name === b.dataset.sw); if (!sw) return;
    b.classList.toggle('rev', sw.state === 1); b.querySelector('i').textContent = sw.state ? 'desviado' : 'normal';
  });
}
function throwSwitch(sw) {
  const busy = S.consists.some(c => c.moving && c.poly && onSwitch(c, sw));
  if (busy) { log('AMV ' + sw.name + ' ocupado: manobra bloqueada.', 'err'); return; }
  sw.state ^= 1; updateChips(); log(`AMV ${sw.name} → ${sw.state ? 'DESVIADA (amarelo)' : 'NORMAL (verde)'}`);
  if (S.waiting && S.waiting.sw === sw && sw.state === S.waiting.need) log(`AMV ${sw.name} alinhado. Aperte Continuar.`, 'ok');
  else if (S.hintSw === sw) { S.hintSw = null; log(`AMV ${sw.name} alinhado. Aperte Frente ou Ré para seguir.`, 'ok'); }
}
function onSwitch(c, sw) { const f = c.front(), r = c.rear(); const x1 = Math.min(f.x, r.x), x2 = Math.max(f.x, r.x); return Math.abs(f.z - sw.z) < 12 && x2 > sw.x - 8 && x1 < sw.x + 36 && sw.f > 0 || (Math.abs(f.z - sw.z) < 12 && x2 > sw.x - 36 && x1 < sw.x + 8 && sw.f < 0); }

// ---------- listas ----------
const byId = id => S.consists.find(c => c.id === id);
function bounds(c) { const f = c.front(), r = c.rear(); return { x1: Math.min(f.x, r.x), x2: Math.max(f.x, r.x), z: f.z }; }
let lastSig = '';
export function refreshLists(force) {
  const sig = S.consists.map(c => c.id + '|' + c.vehicles.length + '|' + lineOf(bounds(c).z) + '|' + c.name).join(';') + S.selC + '/' + S.selK + '/' + S.busy + '/' + (S.waiting ? 1 : 0) + '/' + S.consists.map(c => (c.powered() ? 'p' : 'u') + (c.moving ? 'm' : '')).join('');
  if (!force && sig === lastSig) return; lastSig = sig;
  const box = $('consists'); box.innerHTML = '';
  for (const c of S.consists) {
    const b = bounds(c), line = lineOf(b.z), d = document.createElement('button'); d.className = 'row' + (S.selC === c.id ? ' sel' : '');
    const hasLoco = c.vehicles.some(v => v.kind !== 'gondola');
    d.innerHTML = `<b>${c.name}</b><span>${c.vehicles.length} veíc. · ${c.length().toFixed(0)} m · ${line ? 'Linha ' + line.slice(1) : 'em trânsito'}${hasLoco ? ' · loc.' : ''}</span>`;
    d.onclick = () => selectConsist(c.id); box.appendChild(d);
  }
  const c = byId(S.selC);
  $('selinfo').textContent = c ? (c.powered() ? '' : 'Sem locomotiva: não se move sozinha. ') + (S.selK != null ? `Engate selecionado: ${c.vehicles[S.selK].label || 'veíc. ' + (S.selK + 1)} ↔ ${c.vehicles[S.selK + 1].label || 'veíc. ' + (S.selK + 2)}` : `Selecionada: ${c.name}`) : 'Clique numa composição, num engate (anel amarelo) ou num AMV.';
  $('btnUncouple').disabled = !(c && S.selK != null) || S.busy;
  $('btnCouple').disabled = !c || S.busy; $('btnHelper').disabled = !c || S.busy || c.vehicles.some(v => v.kind === 'shunter');
  $('btnMove').disabled = S.waiting ? false : (!c || S.busy); $('btnMove').textContent = S.waiting ? 'Continuar ▶' : 'Mover';
  const pw = !!c && c.powered() && !S.busy && !S.waiting; $('btnFwd').disabled = !pw; $('btnRev').disabled = !pw; $('btnStop').disabled = !(c && (c.moving || S.waiting));
  $('btnSeq').disabled = S.busy; $('btnRelease').disabled = !(c && c.vehicles.some(v => v.kind === 'shunter') && c.vehicles.length > 1) || S.busy;
}
function selectConsist(id, k = null) { S.selC = id; S.selK = k; refreshLists(); }

// ---------- operações ----------
const wait = async ms => { let t = 0; const lim = ms / Math.max(1, S.speed / 2); while (t < lim) { await new Promise(r => setTimeout(r, 50)); if (!S.paused) t += 50; } };
function applySets(leg) { for (const s of leg.sets) s.sw.state = s.state; updateChips(); }
function run(c, legs) { return new Promise(res => c.go(legs, applySets, res)); }
function replace(oldArr, newArr) { const i = S.consists.indexOf(oldArr[0]); for (const o of oldArr) { const j = S.consists.indexOf(o); if (j >= 0) S.consists.splice(j, 1); } S.consists.splice(Math.max(0, i), 0, ...newArr); }
function ends(c) { const b = bounds(c); return { x1: b.x1, x2: b.x2, line: lineOf(b.z) }; }
function legLen(p) { return p ? p.legs.reduce((a, l) => a + new Poly(l.pts).len, 0) : Infinity; }

async function nudge(c, dist) {
  const f = c.front(), d = [Math.cos(f.ang), Math.sin(f.ang)];
  await run(c, [{ pts: [{ x: f.x, z: f.z }, { x: f.x + d[0] * dist, z: f.z + d[1] * dist }], sets: [] }]);
}
async function uncouple(cid, k) {
  const c = byId(cid); if (!c) return; S.busy = true; refreshLists();
  const [a, b] = c.split(k); b.name = c.name + ' · corte'; replace([c], [a, b]);
  log(`Desacoplado: ${c.vehicles[k].label} | ${c.vehicles[k + 1].label}. Cabeça avança 5 m.`);
  S.selC = b.id; S.selK = null; await nudge(a, 5); S.busy = false; refreshLists();
}
function approachPlans(c, line, stopForDir) {
  const e = ends(c), best = [];
  for (const east of [true, false]) {
    const lx = east ? e.x2 : e.x1, edge = lineEdgeAt(Y, e.line, lx); if (!edge) continue;
    const stop = stopForDir(east); if (stop == null) continue;
    const p = planMove(Y, edge, east ? 'b' : 'a', lx, line, stop); if (p) best.push({ east, p, len: legLen(p), stop });
  }
  return best.sort((a, b) => a.len - b.len)[0] || null;
}
function freeStop(c, line, east) {
  const z = Y.lines[line], L = c.length(), others = S.consists.filter(o => o !== c && Math.abs(bounds(o).z - z) < 0.3).map(bounds);
  const lo = 6, hi = line === 'L6' ? 243 : (Y.preset === 'A' ? 372 : 224);
  const zones = Y.zones.filter(zn => zn.line === line);
  const blocked = (x1, x2) => others.some(o => x2 > o.x1 - 3 && x1 < o.x2 + 3) || zones.some(zn => x2 > zn.x1 && x1 < zn.x2);
  const minO = others.length ? Math.min(...others.map(o => o.x1)) : Infinity, maxO = others.length ? Math.max(...others.map(o => o.x2)) : -Infinity;
  if (east) { for (let x = lo; x + L <= Math.min(hi, minO - 3); x += 1) if (!blocked(x, x + L)) return x + L; return null; }
  if (line === 'L6') return null;
  for (let x = hi - L; x >= Math.max(lo, maxO + 3); x -= 1) if (!blocked(x, x + L)) return x; return null;
}
async function moveTo(c, line, guided = S.stopAMV) {
  if (!c.powered()) { log(c.name + ' não tem locomotiva: acople o helper ou a locomotiva principal para movimentá-la.', 'err'); return false; }
  const L = c.length(), plan = approachPlans(c, line, east => freeStop(c, line, east));
  if (!plan) { log('Sem rota/vaga livre para ' + c.name + ' na Linha ' + line.slice(1), 'err'); return false; }
  if (plan.east !== c.dirEast()) c.flip();
  log(`${c.name} → Linha ${line.slice(1)} (${plan.p.legs.length} perna${plan.p.legs.length > 1 ? 's' : ''}, ${plan.len.toFixed(0)} m)${guided ? ' · pára antes de cada AMV' : ''}`);
  S.follow = c; let ok = true;
  if (guided) ok = await guidedRun(c, plan.p.legs); else await run(c, plan.p.legs);
  S.follow = null; return ok;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
function slicePoly(P, s0, s1) { return cropPoly(P, s0, s1); }
// rota guiada: a composição para MARGIN m antes de cada AMV de ponta e espera o operador alinhar e apertar Continuar
async function guidedRun(c, legs) {
  S.cancel = false;
  const seg = (pts, sets) => new Promise(res => { if (sets) for (const st of sets) st.sw.state = st.state; updateChips(); c.go([{ pts, sets: [] }], null, res); });
  for (let li = 0; li < legs.length; li++) {
    let pts = legs[li].pts.map(p => ({ x: p.x, z: p.z }));
    if (li > 0) { c.flip(); await sleep(900 / Math.max(1, S.speed / 2)); const P0 = new Poly(pts); pts = cropPoly(P0, Math.min(c.length(), P0.len - 0.5), P0.len); }
    const P = new Poly(pts), cps = [], trailing = [];
    for (const st of legs[li].sets) {
      let best = -1, bd = 1e9; P.pts.forEach((q, i) => { const d = Math.hypot(q.x - st.pos.x, q.z - st.pos.z); if (d < bd) { bd = d; best = i; } });
      if (bd > 0.8) continue; (st.facing ? cps : trailing).push({ s: P.cum[best], st });
    }
    cps.sort((a, b) => a.s - b.s);
    let cur = 0;
    const go = async to => { if (to - cur < 0.3) { cur = Math.max(cur, to); return true; }
      const sets = trailing.filter(t => t.s > cur - 0.1 && t.s <= to + 0.1).map(t => t.st); // AMVs de talão alinham sozinhos (mola)
      await seg(slicePoly(P, cur, to), sets); cur = to; return !(c.userStop || S.cancel); };
    for (const cp of cps) {
      if (!(await go(cp.s - MARGIN))) { S.follow = null; return false; }
      const sw = cp.st.sw, need = cp.st.state;
      S.waiting = { c, sw, need }; S.hintSw = sw; refreshLists(true);
      log(`Parado a ${MARGIN} m do AMV ${sw.name}. Alinhe para ${need ? 'DESVIADA (amarelo)' : 'NORMAL (verde)'} (agora: ${sw.state ? 'desviada' : 'normal'}) e aperte Continuar.`, 'ok');
      const go2 = await new Promise(res => { S.resume = res; });
      S.waiting = null; S.hintSw = null; S.resume = null; refreshLists(true);
      if (!go2) { log('Rota cancelada.'); return false; }
    }
    if (!(await go(P.len))) return false;
  }
  return true;
}
function continueRoute() {
  const w = S.waiting; if (!w) return;
  if (w.sw.state !== w.need) { log(`AMV ${w.sw.name} ainda está ${w.sw.state ? 'DESVIADA' : 'NORMAL'}; a rota exige ${w.need ? 'DESVIADA (amarelo)' : 'NORMAL (verde)'}. Clique no AMV para alternar.`, 'err'); return; }
  const r = S.resume; if (r) r(true);
}
function stopSelected() {
  if (S.waiting) { S.cancel = true; const r = S.resume; if (r) r(false); return; }
  const c = byId(S.selC); if (!c) return;
  if (c.moving) { c.stopNow(); log(c.name + ': frenando.'); } else log('A composição já está parada.');
}

// ---------- condução livre (Frente / Ré) ----------
function mergedName(a, b) {
  if (a.name.includes('principal') || b.name.includes('principal')) return 'Trem principal';
  const p = a.powered() ? a : (b.powered() ? b : a), o = p === a ? b : a;
  return o.name.includes('corte') ? o.name : (p.powered() ? p.name : p.name) + (o.powered() ? ' + ' + o.name : '');
}
function coupleContact(a, b, why) {
  const m = mergeContact(a, b); m.name = mergedName(a, b); replace([a, b], [m]); m.impact(Math.max(1.0, a.lastSpeed * 2)); m.place();
  log(`Acoplado: ${m.name} (${m.vehicles.length} veículos${why ? ' · ' + why : ''})`, 'ok'); selectConsist(m.id); return m;
}
function onArrive(c, plan, fwd) {
  if (c.userStop) { log(c.name + ' parou.'); return; }
  const r = plan.reason, i = plan.info;
  if (r === 'amv') { S.hintSw = i.sw; log(`${c.name} parou a ${MARGIN} m do AMV ${i.sw.name} (agora ${i.sw.state ? 'DESVIADA' : 'NORMAL'}). Clique no AMV para alinhar e aperte ${fwd ? 'Frente' : 'Ré'} de novo.`, 'ok'); }
  else if (r === 'talao') { log(`AMV ${i.sw.name} está contra a rota (talão). Alinhe para ${i.need ? 'DESVIADA (amarelo)' : 'NORMAL (verde)'} e aperte ${fwd ? 'Frente' : 'Ré'}.`, 'err'); S.hintSw = i.sw; }
  else if (r === 'contato') { if (S.autoCouple) coupleContact(c, i.other, 'impacto ' + (c.lastSpeed * 3.6).toFixed(1) + ' km/h'); else log(c.name + ' encostou em ' + i.other.name + '. Use "Reacoplar vizinho" para engatar.'); }
  else log(c.name + ': fim de linha.');
}
function driveManual(fwd) {
  const c = byId(S.selC);
  if (!c) { log('Selecione uma composição (clique num vagão ou locomotiva).', 'err'); return; }
  if (!c.powered()) { log(c.name + ' não tem locomotiva: acople o helper ou a locomotiva principal.', 'err'); return; }
  if (S.busy || S.waiting) { log('Há uma manobra guiada em andamento: use Continuar ou Parar.', 'err'); return; }
  if (c.moving) { if (c.driveFwd === fwd) return; c.stopNow(); log('Frenando para inverter o sentido… aperte ' + (fwd ? 'Frente' : 'Ré') + ' quando parar.'); return; }
  S.hintSw = null;
  if (c.noseFront() !== fwd) c.flip();               // Frente = nariz da locomotiva; Ré = oposto
  const plan = buildAhead(Y, c, { amv: S.stopAMV, others: S.consists });
  if (!plan) { log(c.name + ' não está sobre a via.', 'err'); return; }
  c.driveFwd = fwd;
  if (plan.pts.length < 2 || plan.stop < 0.3) { c.lastSpeed = 0.5; onArrive(c, plan, fwd); return; }
  log(`${c.name} ${fwd ? '▶ frente' : '◀ ré'} · ${plan.reason === 'amv' ? 'até o AMV ' + plan.info.sw.name : plan.reason === 'contato' ? 'até encostar em ' + plan.info.other.name : plan.stop.toFixed(0) + ' m'}`);
  c.go([{ pts: plan.pts, sets: [] }], null, () => onArrive(c, plan, fwd));
}

async function coupleTo(h, t) {
  const e = ends(t), line = e.line;
  const plan = approachPlans(h, line, east => east ? e.x1 - GAP : e.x2 + GAP);
  if (!plan) { log('Helper não alcança ' + t.name, 'err'); return null; }
  if (plan.east !== h.dirEast()) h.flip();
  log(`Helper → ${t.name} (Linha ${line.slice(1)}), ${plan.len.toFixed(0)} m`);
  S.follow = h; await run(h, plan.p.legs); S.follow = null;
  const m = mergeContact(h, t); m.name = (t.name.includes('corte') ? t.name : h.name + ' + ' + t.name); replace([h, t], [m]); m.impact(Math.max(1.0, h.lastSpeed * 2)); m.place();
  log('Acoplado: ' + m.name); S.selC = m.id; S.selK = null; return m;
}
async function release(c) {
  const i = c.vehicles.findIndex(v => v.kind === 'shunter'); if (i < 0 || c.vehicles.length < 2) return;
  const k = i === 0 ? 0 : c.vehicles.length - 2; const [a, b] = c.split(k);
  const helper = i === 0 ? a : b, cut = i === 0 ? b : a; helper.name = 'Locomotiva helper'; cut.name = 'Corte (vagões)';
  replace([c], [a, b]); log('Helper desacoplado do corte.');
  if (helper === b) helper.flip(); await nudge(helper, 5); selectConsist(helper.id);
  return { helper, cut };
}
function findHelper() { return S.consists.find(c => c.vehicles.length === 1 && c.vehicles[0].kind === 'shunter'); }

async function sequence() {
  S.busy = true; S.stopAMV0 = S.stopAMV; refreshLists(); const tgt = $('selLine').value;
  try {
    let main = S.consists.find(c => c.name === 'Trem principal' && c.vehicles.length === 10);
    if (!main) { resetScenario(); main = S.consists[0]; }
    S.follow = main; log('Sequência: 1) desacoplar o trem entre os vagões 4 e 5');
    const [a, b] = main.split(4); b.name = 'Corte (vagões 5-9)'; replace([main], [a, b]); await nudge(a, 6); S.follow = null; await wait(600);
    log('2) helper vai até o corte e acopla');
    const h = findHelper(); const m = await coupleTo(h, b); if (!m) throw new Error('falha ao acoplar'); await wait(600);
    log('3) helper leva o corte para a Linha ' + tgt.slice(1));
    if (!(await moveTo(m, tgt, false))) throw new Error('sem rota'); await wait(600);
    log('4) desacoplar o helper do corte'); const r = await release(m); await wait(500);
    log('5) helper volta para a Linha 1'); await moveTo(r.helper, 'L1', false);
    log('Sequência concluída. Trem principal na Linha 3, corte na Linha ' + tgt.slice(1) + '.', 'ok');
  } catch (e) { log('Sequência interrompida: ' + e.message, 'err'); }
  S.busy = false; S.follow = null; refreshLists();
}

// ---------- pausa, freio e telemetria ----------
function setPaused(p) {
  S.paused = p; $('btnPause').textContent = p ? '▶ Retomar' : '⏸ Pausar'; $('btnPause').classList.toggle('on', p);
  $('state').textContent = p ? 'PAUSADO' : S.eb ? 'FREIO APLICADO' : ''; log(p ? 'Simulação pausada.' : 'Simulação retomada.');
}
function setEB(on) {
  S.eb = on; $('btnEB').textContent = on ? 'Soltar freio' : 'Freio de emergência'; $('btnEB').classList.toggle('on', on);
  $('state').textContent = S.paused ? 'PAUSADO' : on ? 'FREIO APLICADO' : ''; log(on ? 'Freio de emergência aplicado: composições param com a folga dos engates (corrida de folgas).' : 'Freio solto, manobra continua.', on ? 'err' : 'ok');
}
$('btnPause').onclick = () => setPaused(!S.paused);
$('btnEB').onclick = () => setEB(!S.eb);
addEventListener('keydown', e => { if (/^(SELECT|INPUT)$/.test(document.activeElement.tagName)) return;
  if (e.code === 'ArrowUp' || e.code === 'KeyW') { e.preventDefault(); driveManual(true); return; }
  if (e.code === 'ArrowDown' || e.code === 'KeyS') { e.preventDefault(); driveManual(false); return; }
  if (e.code === 'KeyX') { stopSelected(); return; }
  if (e.code === 'Space' && !/^(SELECT|INPUT|BUTTON)$/.test(document.activeElement.tagName)) { e.preventDefault(); setPaused(!S.paused); } });
function telemetry() {
  const c = byId(S.selC); const el = $('tele');
  if (!c) { el.textContent = 'Selecione uma composição para ver a física.'; return; }
  const devs = c.vehicles.map(v => Math.abs(v.dev || 0)), slack = Math.max(0, ...devs);
  el.innerHTML = `<span>Velocidade</span><b>${(c.speed * 3.6).toFixed(1)} km/h</b><span>Aceleração</span><b>${c.aF.toFixed(2)} m/s²</b><span>Massa</span><b>${(c.totalMass() / 1000).toFixed(0)} t</b><span>Esforço no engate</span><b>${(c.maxF / 1000).toFixed(0)} kN</b><span>Corrida de folga</span><b>${(slack * 100).toFixed(0)} cm</b>`;
}

// ---------- UI ----------
$('btnUncouple').onclick = () => uncouple(S.selC, S.selK);
$('btnRelease').onclick = async () => { const c = byId(S.selC); if (!c) return; S.busy = true; await release(c); S.busy = false; refreshLists(); };
$('btnCouple').onclick = async () => {
  const c = byId(S.selC); if (!c || c.moving) return; S.busy = true; refreshLists();
  const best = [];
  for (const fwd of [true, false]) {
    if (fwd !== true) c.flip();
    const plan = buildAhead(Y, c, { amv: false, others: S.consists });
    if (plan && plan.reason === 'contato' && plan.stop <= 60) best.push({ plan, flipped: fwd !== true });
    if (fwd !== true) c.flip();
  }
  best.sort((a, b) => a.plan.stop - b.plan.stop); const cand = best[0];
  if (!cand) { log('Nenhuma composição a até 60 m, à frente ou atrás, na mesma via e sem AMV desalinhado no caminho.', 'err'); S.busy = false; refreshLists(); return; }
  if (cand.flipped) c.flip();
  const plan = buildAhead(Y, c, { amv: false, others: S.consists });
  if (plan.stop > 0.3) { S.follow = c; await new Promise(res => c.go([{ pts: plan.pts, sets: [] }], null, res)); S.follow = null; }
  coupleContact(c, plan.info.other, 'reacoplar'); S.busy = false; refreshLists();
};
$('btnHelper').onclick = async () => {
  const t = byId(S.selC), h = findHelper(); if (!t || !h) { log('Helper livre não encontrado.', 'err'); return; }
  S.busy = true; refreshLists(); await coupleTo(h, t); S.busy = false; refreshLists();
};
$('btnMove').onclick = async () => {
  if (S.waiting) { continueRoute(); return; }
  const c = byId(S.selC); if (!c) return; S.busy = true; refreshLists(); await moveTo(c, $('selLine').value); S.busy = false; S.waiting = null; refreshLists(true);
};
$('btnFwd').onclick = () => driveManual(true);
$('btnRev').onclick = () => driveManual(false);
$('btnStop').onclick = stopSelected;
$('chkAMV').onchange = e => { S.stopAMV = e.target.checked; log(S.stopAMV ? 'A composição pára antes de cada AMV de ponta.' : 'A composição passa direto pelos AMVs (segue o alinhamento atual).'); };
$('chkAuto').onchange = e => { S.autoCouple = e.target.checked; };
$('btnSeq').onclick = sequence;
$('btnReset').onclick = () => { resetScenario(); log('Cenário reiniciado.'); };
$('selPreset').onchange = e => { S.opts.preset = e.target.value; rebuild(); log('Esquema de AMV: ' + e.target.selectedOptions[0].textContent); };
$('selN').onchange = e => { S.opts.N = +e.target.value; rebuild(); log('AMV nº ' + e.target.value + ' (ângulo 1:' + e.target.value + ')'); };
$('selAct').onchange = e => { S.opts.act = e.target.value; S.views.forEach(v => v.setActuation(S.opts.act)); };
$('chkLoaded').onchange = e => { S.opts.loaded = e.target.checked; vehGroup.traverse(o => { if (o.name === 'cargo') o.visible = e.target.checked; }); };
$('chkLabels').onchange = e => { S.labels = e.target.checked; S.views.forEach(v => v.setLabels(S.labels)); };
$('chkMarkers').onchange = e => { S.markers = e.target.checked; };
$('rngSpeed').oninput = e => { S.speed = +e.target.value; $('lblSpeed').textContent = '×' + S.speed; };
$('chkFollow').onchange = e => { if (!e.target.checked) S.follow = null; };

const CAMS = {
  geral: [190, 0, 6, 0, 330, 330], cab: [-150, 0, 8, -60, 120, 190], amv1: [-4 * 71.7 + 6, 0, 2, -4 * 71.7 - 22, 14, 26],
  trem: [100, 0, 10, 60, 40, 70], helper: [14, 0, 0, -4, 18, 22], morta: [150, 0, -9, 90, 50, -70], tesoura: [262, 0, 12, 230, 28, 40],
};
document.querySelectorAll('[data-cam]').forEach(b => b.onclick = () => {
  const [tx, ty, tz, cx, cy, cz] = CAMS[b.dataset.cam]; S.follow = null; controls.target.set(tx, ty, tz); cam.position.set(cx, cy, cz); controls.update();
});

// clique / seleção
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(); let down = null;
renderer.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
renderer.domElement.addEventListener('pointerup', e => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5) return; down = null;
  const r = renderer.domElement.getBoundingClientRect(); mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(mouse, cam);
  const targets = [...markers.filter(m => m.visible).map(m => m.userData.hit), ...S.views.map(v => v.hit), ...proxies];
  const hit = ray.intersectObjects(targets, false)[0]; if (!hit) return;
  const o = hit.object;
  if (o.userData.marker) { const u = o.userData.marker.userData; selectConsist(u.cid, u.k); return; }
  if (o.userData.sw) { throwSwitch(o.userData.sw); return; }
  if (o.userData.veh) { const c = S.consists.find(cc => cc.vehicles.includes(o.userData.veh)); if (c) selectConsist(c.id); }
});

// ---------- laço ----------
const clock = new THREE.Clock(); let acc = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime, sdt = S.paused ? 0 : dt;
  for (const c of S.consists) { c.hold = S.eb; c.update(sdt * (S.speed / 2), 18, 1.0); c.place(); }
  if (!S.paused) for (const v of S.views) v.update(dt, t);
  updateMarkers();
  const hs = S.hintSw; hintRing.visible = !!hs;
  if (hs) { hintRing.position.set(hs.x + hs.f * 3.2, 0.25, hs.z + hs.s * 1.2); hintRing.scale.setScalar(1 + 0.15 * Math.sin(t * 6)); }
  const bn = $('amvHint');
  if (S.waiting) { bn.hidden = false; bn.textContent = `Parado antes do AMV ${S.waiting.sw.name}: alinhe para ${S.waiting.need ? 'DESVIADA (amarelo)' : 'NORMAL (verde)'} e aperte Continuar`; }
  else if (hs) { bn.hidden = false; bn.textContent = `Parado antes do AMV ${hs.name}: clique no AMV para alinhar e aperte Frente ou Ré`; } else bn.hidden = true;
  const sc = byId(S.selC);
  if (sc) { const f = sc.front(); selArrow.visible = true; selArrow.position.set(f.x, 8 + Math.sin(t * 3) * 0.5, f.z); } else selArrow.visible = false;
  if ($('chkFollow').checked && (S.follow || (sc && sc.moving))) { const f = (S.follow || sc).front(); const d = new THREE.Vector3(f.x, 0, f.z).sub(controls.target).multiplyScalar(0.08); controls.target.add(d); cam.position.add(d); }
  controls.update();
  sun.target.position.copy(controls.target); sun.position.copy(controls.target).add(new THREE.Vector3(110, 170, 70)); sun.target.updateMatrixWorld();
  acc += dt; if (acc > 0.2) { acc = 0; refreshLists(); telemetry(); }
  renderer.render(scene, cam);
  requestAnimationFrame(frame);
}

// ---------- início ----------
(async function init() {
  try {
    const res = await loadModels((p, k) => { $('bar').style.width = Math.round(p * 100) + '%'; $('loadmsg').textContent = 'Carregando modelos 3D… ' + k; });
    protos = res.protos; for (const k in res.status) if (res.status[k] !== 'ok') log('Modelo ' + k + ' ' + res.status[k], 'err');
  } catch (e) { log('Falha ao carregar modelos: ' + e.message, 'err'); protos = {}; }
  rebuild(); CAMS.geral && document.querySelector('[data-cam=geral]').click();
  $('loading').remove(); log('Pátio pronto. Selecione um engate (anel amarelo) e clique em Desacoplar.', 'ok'); frame();
})();

