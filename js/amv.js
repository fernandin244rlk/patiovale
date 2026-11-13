import * as THREE from 'three';
import { HG, GAUGE, vAt, frogU } from './track.js';
import { sweepInto, toGeo } from './geom.js';

const LB = 6.1, THROW = 0.11;
const box = (w, h, d, mat, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); m.castShadow = true; return m; };
const cyl = (r, h, mat, x = 0, y = 0, z = 0, seg = 12) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, seg), mat); m.position.set(x, y, z); m.castShadow = true; return m; };

// agulha (tongue): afunila da ponta (x=-LB) ao talão (x=0), pivô no talão
function tongueGeo() {
  const prof = [[-0.034, 0], [0.034, 0], [0.036, -0.012], [0.036, -0.032], [0.0085, -0.05], [0.0085, -0.138], [0.075, -0.156], [0.075, -0.172], [-0.075, -0.172], [-0.075, -0.156], [-0.0085, -0.138], [-0.0085, -0.05], [-0.036, -0.032], [-0.036, -0.012]];
  const out = [], n = 14, m = prof.length, rings = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, x = -LB * (1 - t), k = Math.min(1, 0.12 + t * 2.2), hk = Math.min(1, 0.35 + t * 2);
    rings.push(prof.map(([c, y]) => [x, y < -0.05 ? y : y * hk + (1 - hk) * -0.0 - (1 - hk) * 0.0, c * (y > -0.05 ? k : 1)]));
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
    const A = rings[i][j], B = rings[i][(j + 1) % m], C = rings[i + 1][(j + 1) % m], D = rings[i + 1][j];
    out.push(...A, ...B, ...C, ...A, ...C, ...D);
  }
  return toGeo(out);
}
const TONGUE = tongueGeo();

function label(text) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64; const x = c.getContext('2d');
  x.fillStyle = 'rgba(20,22,26,.82)'; x.beginPath(); x.roundRect(4, 4, 120, 56, 10); x.fill();
  x.strokeStyle = '#f2c200'; x.lineWidth = 3; x.stroke();
  x.fillStyle = '#fff'; x.font = 'bold 34px system-ui,sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(text, 64, 34);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true, sizeAttenuation: false }));
  s.scale.set(0.085, 0.0425, 1); s.renderOrder = 10; return s;
}

export class SwitchView {
  constructor(sw, M) {
    this.sw = sw; this.M = M; this.t = sw.state; this.root = new THREE.Group();
    this.root.position.set(sw.x, 0, sw.z); this.root.scale.set(sw.f, 1, sw.s);
    const p = sw.p, vL = vAt(p, LB), uf = frogU(p);
    const g = this.root;
    // agulhas
    this.tl = new THREE.Mesh(TONGUE, M.railTop); this.tl.position.set(LB, 0.004, -HG); this.tl.castShadow = true;
    this.tr = new THREE.Mesh(TONGUE, M.railTop); this.tr.position.set(LB, 0.004, HG + vL); this.tr.castShadow = true;
    g.add(this.tl, this.tr); this.vL = vL;
    // tirantes de agulha
    this.bars = [0.45, 2.2, 4.0, 5.6].map(u => { const b = box(0.07, 0.035, 1.75, M.steel, u, -0.07, 0.25); b.userData.u = u; g.add(b); return b; });
    this.lugs = [];
    // talão: talas de junção
    for (const z of [-HG, HG + vL * 0.0]) g.add(box(0.55, 0.11, 0.03, M.steel, LB + 0.1, -0.09, z - 0.045));
    // coração + contratrilhos
    const nose = new THREE.Shape(); const ta = Math.tan(p.a), Ln = 2.6;
    nose.moveTo(0, 0); nose.lineTo(Ln, 0); nose.lineTo(Ln, Ln * ta + 0.07); nose.lineTo(0.0, 0.0);
    const ng = new THREE.ExtrudeGeometry(nose, { depth: 0.165, bevelEnabled: false }); ng.rotateX(Math.PI / 2);
    const fr = new THREE.Mesh(ng, M.railTop); fr.position.set(uf, 0, HG); fr.castShadow = true; g.add(fr);
    const noseTip = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.02, 0.06), M.steel); noseTip.position.set(uf + 0.1, 0.002, HG); g.add(noseTip);
    g.add(box(3.4, 0.05, 0.75 + uf * 0 + 0.55, M.cast, uf + 1.1, -0.15, HG + 0.12));
    // asas (wing rails) curtas
    for (const sg of [-1, 1]) {
      const pts = []; for (let i = 0; i <= 8; i++) { const u = uf - 1.6 + i * 0.5; pts.push({ x: u, z: sg < 0 ? -HG + (vAt(p, u) - 0) * 0 + HG * 2 - (HG * 2 - (vAt(p, u) - HG)) * 1 + 0.0 : 0 }); }
    }
    const wing = [];
    const w1 = [], w2 = [];
    for (let i = 0; i <= 6; i++) { const u = uf - 3 + i * 0.6; w1.push({ x: u, z: HG }); w2.push({ x: u, z: vAt(p, u) - HG }); }
    // contratrilho na via reta (lado oposto ao coração)
    const ck1 = [], ck2 = [];
    for (let i = 0; i <= 10; i++) { const u = uf - 1.9 + i * 0.38; ck1.push({ x: u, z: -HG + 0.0 + (i < 2 ? 0.06 * (2 - i) : 0) }); }
    for (let i = 0; i <= 10; i++) { const u = uf - 1.9 + i * 0.38; ck2.push({ x: u, z: vAt(p, u) + HG + (i < 2 ? -0.0 : 0) }); }
    const prof = [[-0.02, 0.0], [0.02, 0], [0.022, -0.04], [0.01, -0.06], [0.01, -0.13], [0.045, -0.15], [0.045, -0.172], [-0.045, -0.172], [-0.045, -0.15], [-0.01, -0.13], [-0.01, -0.06], [-0.022, -0.04]];
    const cArr = [];
    const sh = pts => pts.map(q => ({ x: q.x, z: q.z }));
    // eixo do check rail = rail + deslocamento para dentro da bitola (0,1 m)
    sweepInto(cArr, ck1.map(q => ({ x: q.x, z: q.z + 0.1 })), 0, prof, 0.0);
    sweepInto(cArr, ck2.map(q => ({ x: q.x, z: q.z - 0.1 })), 0, prof, 0.0);
    const cm = new THREE.Mesh(toGeo(cArr), M.rail); cm.castShadow = true; g.add(cm);
    // calços dos check rails
    for (let i = 1; i < 10; i += 2) { g.add(box(0.06, 0.05, 0.1, M.steel, ck1[i].x, -0.06, ck1[i].z + 0.045)); g.add(box(0.06, 0.05, 0.1, M.steel, ck2[i].x, -0.06, ck2[i].z - 0.045)); }

    // ---- acionamento manual (alavanca + bandeirola) ----
    const su = 2.2, sv = -2.15;
    this.manual = new THREE.Group(); this.manual.position.set(su, 0, sv); g.add(this.manual);
    const mm = this.manual;
    mm.add(box(0.6, 0.12, 0.5, M.wood, 0, -0.2, 0), box(0.42, 0.24, 0.3, M.cast, 0, -0.02, 0.0), box(0.26, 0.2, 0.2, M.steel, 0, 0.2, 0));
    mm.add(cyl(0.03, 0.42, M.steel, 0, 0.42, 0));
    this.lever = new THREE.Group(); this.lever.position.y = 0.6; mm.add(this.lever);
    this.lever.add(box(0.95, 0.04, 0.045, M.steel, 0.42, 0, 0));
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), M.red); ball.position.set(0.92, 0, 0); this.lever.add(ball);
    const grip = cyl(0.022, 0.3, M.black, -0.08, 0.1, 0, 8); this.lever.add(grip);
    mm.add(cyl(0.035, 1.9, M.cast, -0.15, 0.95, 0));
    // alvo (bandeirola) com duas faces: verde (normal) e amarela (desviado)
    this.target = new THREE.Group(); this.target.position.set(-0.15, 1.55, 0); mm.add(this.target);
    const pg = box(0.03, 0.5, 0.62, M.green, 0, 0, 0); pg.scale.x = 1;
    const py = box(0.62, 0.5, 0.03, M.yellow, 0, 0, 0);
    const bg1 = box(0.022, 0.56, 0.68, M.white, 0, 0, 0), bg2 = box(0.68, 0.56, 0.022, M.white, 0, 0, 0);
    this.target.add(bg1, bg2, pg, py);
    // pequeno mastro com flâmula
    mm.add(cyl(0.012, 0.8, M.steel, -0.15, 2.3, 0));
    const tri = new THREE.Shape(); tri.moveTo(0, 0.0); tri.lineTo(0.62, 0.0); tri.lineTo(0.0, 0.3);
    this.flagMat = new THREE.MeshStandardMaterial({ color: 0x1fa64a, side: THREE.DoubleSide, roughness: 0.7 });
    this.flag = new THREE.Group(); this.flag.position.set(-0.15, 2.5, 0); const fm = new THREE.Mesh(new THREE.ShapeGeometry(tri), this.flagMat); this.flag.add(fm); mm.add(this.flag);
    // lanterna
    this.lensMat = new THREE.MeshBasicMaterial({ color: 0x38ff7a });
    const lant = new THREE.Group(); lant.position.set(-0.15, 1.95, 0); lant.add(box(0.2, 0.22, 0.2, M.black));
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.42, 14), this.lensMat); lens.rotation.x = Math.PI / 2; lens.scale.set(1, 1, 1); lant.add(lens);
    const lens2 = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.22, 14), this.lensMat); lens2.rotation.z = Math.PI / 2; lant.add(lens2);
    mm.add(lant);
    // ---- acionamento elétrico (máquina de AMV) ----
    this.motor = new THREE.Group(); this.motor.position.set(su, 0, -2.0); g.add(this.motor); this.motor.visible = false;
    this.motor.add(box(0.9, 0.42, 0.55, new THREE.MeshStandardMaterial({ color: 0x4d6b8a, roughness: 0.5, metalness: 0.3 }), 0, 0.0, 0));
    this.motor.add(box(0.94, 0.05, 0.6, M.black, 0, 0.23, 0), cyl(0.03, 1.5, M.cast, 0.3, 0.9, 0));
    const mlant = new THREE.Group(); mlant.position.set(0.3, 1.7, 0); mlant.add(box(0.2, 0.22, 0.2, M.black));
    const l3 = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.42, 14), this.lensMat); l3.rotation.x = Math.PI / 2; mlant.add(l3);
    this.motor.add(mlant);
    // haste de manobra e de verificação
    this.rod = box(0.05, 0.04, 1.2, M.steel, su, -0.07, -1.35); g.add(this.rod);
    // etiqueta
    this.lab = label(sw.name); this.lab.position.set(su, 3.0, sv); g.add(this.lab);
    for (const o of [this.manual, this.motor, this.rod]) o.traverse(c => { c.userData.sw = sw; });
    this.hit = box(1.4, 3.2, 1.4, new THREE.MeshBasicMaterial({ visible: false }), su, 1.5, sv); this.hit.userData.sw = sw; g.add(this.hit);
    this.apply(true);
  }
  setActuation(kind) { this.manual.visible = kind === 'manual'; this.motor.visible = kind !== 'manual'; this.hit.position.z = kind === 'manual' ? -2.15 : -2.0; }
  setLabels(v) { this.lab.visible = v; }
  update(dt, time) {
    const tgt = this.sw.state;
    if (this.t !== tgt) { const d = Math.sign(tgt - this.t) * dt / 0.9; this.t = Math.abs(tgt - this.t) <= Math.abs(d) ? tgt : this.t + d; this.apply(); }
    this.flag.rotation.y = Math.sin(time * 4 + this.sw.x) * 0.25;
  }
  apply() {
    const t = this.t, e = t * t * (3 - 2 * t), vL = this.vL;
    // esquerda: fechada(0) -> aberta(+THROW) ; direita: aberta(-THROW) -> fechada(0)
    this.tl.rotation.y = (THROW * e) / LB;
    this.tr.rotation.y = -(vL + THROW * (1 - e)) / LB;
    for (const b of this.bars) b.position.z = 0.25 + THROW * e * (1 - b.userData.u / LB);
    this.rod.position.z = -1.35 + THROW * e * 0.64;
    this.lever.rotation.y = e * Math.PI;
    this.target.rotation.y = e * Math.PI / 2;
    const col = t < 0.5 ? 0x38ff7a : 0xffd21a; this.lensMat.color.setHex(col);
    this.flagMat.color.setHex(t < 0.5 ? 0x1fa64a : 0xf2c200);
  }
}

// cruzamento em diamante (tesoura)
export function buildDiamond(c, M) {
  const g = new THREE.Group(); g.position.set(c.x, 0, c.z);
  const d1 = [Math.cos(c.ang), Math.sin(c.ang)], d2 = [Math.cos(c.ang2), Math.sin(c.ang2)];
  const n1 = [-d1[1], d1[0]], n2 = [-d2[1], d2[0]];
  const det = d1[0] * (-d2[1]) - d1[1] * (-d2[0]);
  for (const o1 of [-HG, HG]) for (const o2 of [-HG, HG]) {
    // c + n1*o1 + d1*t = c + n2*o2 + d2*r
    const bx = n2[0] * o2 - n1[0] * o1, bz = n2[1] * o2 - n1[1] * o1;
    const t = (bx * (-d2[1]) - bz * (-d2[0])) / det;
    const px = n1[0] * o1 + d1[0] * t, pz = n1[1] * o1 + d1[1] * t;
    const blk = box(0.9, 0.06, 0.34, M.railTop, px, -0.02, pz); blk.rotation.y = -(c.ang + c.ang2) / 2; g.add(blk);
    g.add(cyl(0.12, 0.08, M.steel, px, 0.0, pz, 8));
  }
  const base = box(6.2, 0.06, 2.9, M.cast, 0, -0.16, 0); base.rotation.y = -(c.ang + c.ang2) / 2; g.add(base);
  return g;
}
