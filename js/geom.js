import * as THREE from 'three';
import { HG, GAUGE, vAt } from './track.js';

export const Y_RAIL_TOP = 0, Y_FOOT = -0.172, Y_SLEEPER_TOP = -0.172, Y_BALLAST = -0.3, Y_GROUND = -0.62;
const PROF = [[-0.034, 0], [0.034, 0], [0.036, -0.012], [0.036, -0.032], [0.0085, -0.05], [0.0085, -0.138], [0.075, -0.156], [0.075, -0.172], [-0.075, -0.172], [-0.075, -0.156], [-0.0085, -0.138], [-0.0085, -0.05], [-0.036, -0.032], [-0.036, -0.012]];

// varre um perfil (lat,y) ao longo de uma polilinha; devolve arrays de posição (triângulos soltos)
export function sweepInto(out, pts, off, prof = PROF, dy = 0) {
  const n = pts.length; if (n < 2) return;
  const rings = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const lx = -tz, lz = tx, cx = pts[i].x + lx * off, cz = pts[i].z + lz * off;
    rings.push(prof.map(([c, y]) => [cx + lx * c, y + dy, cz + lz * c]));
  }
  const m = prof.length;
  for (let i = 0; i + 1 < n; i++) for (let j = 0; j < m; j++) {
    const A = rings[i][j], B = rings[i][(j + 1) % m], C = rings[i + 1][(j + 1) % m], D = rings[i + 1][j];
    out.push(...A, ...B, ...C, ...A, ...C, ...D);
  }
}
export function toGeo(arr) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3)); g.computeVertexNormals(); return g;
}

export function noiseTex(base, vari, size = 256, rep = 1, dots = 5000) {
  const c = document.createElement('canvas'); c.width = c.height = size; const x = c.getContext('2d');
  x.fillStyle = base; x.fillRect(0, 0, size, size);
  for (let i = 0; i < dots; i++) {
    const v = Math.floor((Math.random() - 0.5) * vari), g = 128 + v;
    x.fillStyle = `rgba(${g},${g},${g - 6},0.5)`; const r = 0.6 + Math.random() * 2.2; x.fillRect(Math.random() * size, Math.random() * size, r, r);
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export function makeMats() {
  const bt = noiseTex('#6f6c66', 110, 256, 1, 9000);
  return {
    rail: new THREE.MeshStandardMaterial({ color: 0x7d7a76, metalness: 0.75, roughness: 0.42 }),
    railTop: new THREE.MeshStandardMaterial({ color: 0xb7b9bc, metalness: 0.9, roughness: 0.25 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x4a4d52, metalness: 0.7, roughness: 0.5 }),
    cast: new THREE.MeshStandardMaterial({ color: 0x3a3c40, metalness: 0.5, roughness: 0.65 }),
    concrete: new THREE.MeshStandardMaterial({ color: 0xa4a29b, roughness: 0.9 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x6b4a33, roughness: 0.95 }),
    plate: new THREE.MeshStandardMaterial({ color: 0x35383c, metalness: 0.6, roughness: 0.6 }),
    ballast: new THREE.MeshStandardMaterial({ map: bt, roughness: 1 }),
    ground: new THREE.MeshStandardMaterial({ map: noiseTex('#5b5a4c', 70, 256, 1, 6000), roughness: 1 }),
    green: new THREE.MeshStandardMaterial({ color: 0x1fa64a, roughness: 0.5, emissive: 0x0a4a20 }),
    yellow: new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.5, emissive: 0x4a3a00 }),
    white: new THREE.MeshStandardMaterial({ color: 0xe9e6dc, roughness: 0.6 }),
    red: new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.55 }),
    black: new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.7 }),
  };
}

// ---- lastro: fita trapezoidal ao longo de uma polilinha
export function ballastInto(out, uvs, pts, w = 4.6, wb = 6.6) {
  const n = pts.length, yt = Y_BALLAST, yb = Y_GROUND + 0.01, rings = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    const lx = -tz, lz = tx, p = pts[i];
    rings.push([[p.x - lx * wb / 2, yb, p.z - lz * wb / 2], [p.x - lx * w / 2, yt, p.z - lz * w / 2], [p.x + lx * w / 2, yt, p.z + lz * w / 2], [p.x + lx * wb / 2, yb, p.z + lz * wb / 2]]);
  }
  for (let i = 0; i + 1 < n; i++) for (let j = 0; j < 3; j++) {
    const A = rings[i][j], B = rings[i][j + 1], C = rings[i + 1][j + 1], D = rings[i + 1][j];
    out.push(...A, ...B, ...C, ...A, ...C, ...D);
    for (const P of [A, B, C, A, C, D]) uvs.push(P[0] * 0.22, P[2] * 0.22);
  }
}

function inRanges(x, r) { return r && r.some(([a, b]) => x >= a && x <= b); }

// ---- constrói todos os trilhos, dormentes, lastro e pranchas do pátio
export function buildTrack(Y, M, quality = 1) {
  const g = new THREE.Group();
  const railArr = [], ballArr = [], ballUV = [], conc = [], wood = [], plates = [];
  const sampleEdge = (e) => {
    // devolve pontos com amostras de 3 m em retas longas só nas pontas
    return e.pts;
  };
  const sleepAt = (list, x, z, ang, len = 2.6) => list.push({ x, z, ang, len });
  for (const e of Y.edges) {
    const pts = sampleEdge(e);
    sweepInto(railArr, pts, HG); sweepInto(railArr, pts, -HG);
    ballastInto(ballArr, ballUV, pts);
    // dormentes
    const P = e.poly, sp = 0.6;
    const ranges = e.kind === 'line' ? Y.excl[e.line] : null;
    for (let s = sp / 2; s < P.len; s += sp) {
      const q = P.at(s);
      if (e.kind === 'line') { if (inRanges(q.x, ranges)) continue; }
      else {
        if (e.a.n.type === 'switch' && s < 31.5) continue;
        if (e.b.n.type === 'switch' && s > P.len - 31.5) continue;
      }
      sleepAt(conc, q.x, q.z, q.ang);
      if (e.kind !== 'line' || quality > 0) if (Math.round(s / sp) % 2 === 0) { plates.push({ x: q.x, z: q.z, ang: q.ang, off: HG }, { x: q.x, z: q.z, ang: q.ang, off: -HG }); }
    }
  }
  // pranchas de madeira + lastro largo em cada AMV
  for (const sw of Y.switches) {
    const { f, s, p } = sw, N = Math.ceil(31.5 / 0.6);
    const ctr = [];
    for (let i = 0; i <= N; i++) {
      const u = i * 0.6, v = vAt(p, u), x = sw.x + f * u, zc = sw.z + s * v / 2;
      sleepAt(wood, x, zc, 0, 2.7 + v);
      for (const off of [-HG, HG]) plates.push({ x, z: sw.z + off, ang: 0, off: 0, wood: true });
      if (v > 1.9) for (const off of [-HG, HG]) plates.push({ x, z: sw.z + s * v + off, ang: 0, off: 0, wood: true });
    }
    for (let u = 0; u <= 33; u += 3) { ctr.push({ x: sw.x + f * u, z: sw.z + s * vAt(p, u) / 2 }); }
    ballastInto(ballArr, ballUV, ctr, 5.4 + 0, 7.4);
  }
  const rg = toGeo(railArr); const rm = new THREE.Mesh(rg, M.rail); rm.castShadow = true; g.add(rm);
  const bg = new THREE.BufferGeometry(); bg.setAttribute('position', new THREE.Float32BufferAttribute(ballArr, 3));
  bg.setAttribute('uv', new THREE.Float32BufferAttribute(ballUV, 2)); bg.computeVertexNormals();
  const bm = new THREE.Mesh(bg, M.ballast); bm.receiveShadow = true; g.add(bm);

  const dummy = new THREE.Object3D();
  const inst = (list, geo, mat, yc, shadow) => {
    if (!list.length) return;
    const im = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((s, i) => { dummy.position.set(s.x, yc, s.z); dummy.rotation.set(0, -s.ang, 0); dummy.scale.set(1, 1, (s.len || 2.6) / 2.6); dummy.updateMatrix(); im.setMatrixAt(i, dummy.matrix); });
    im.receiveShadow = true; im.castShadow = !!shadow; g.add(im);
  };
  inst(conc, new THREE.BoxGeometry(0.26, 0.22, 2.6), M.concrete, -0.282, false);
  const woodList = wood;
  const wm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.24, 0.2, 2.6), M.wood, woodList.length);
  const col = new THREE.Color();
  woodList.forEach((s, i) => {
    dummy.position.set(s.x, -0.272, s.z); dummy.rotation.set(0, -s.ang, 0); dummy.scale.set(1, 1, s.len / 2.6); dummy.updateMatrix(); wm.setMatrixAt(i, dummy.matrix);
    const k = 0.8 + Math.random() * 0.4; wm.setColorAt(i, col.setRGB(k, k, k));
  });
  wm.receiveShadow = true; g.add(wm);
  // placas de apoio
  const pm = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.014, 0.3), M.plate, plates.length);
  plates.forEach((s, i) => {
    const nx = -Math.sin(s.ang), nz = Math.cos(s.ang);
    dummy.position.set(s.x + nx * s.off, Y_SLEEPER_TOP + 0.002, s.z + nz * s.off);
    dummy.rotation.set(0, -s.ang, 0); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); pm.setMatrixAt(i, dummy.matrix);
  });
  g.add(pm);
  // solo
  const gnd = new THREE.Mesh(new THREE.PlaneGeometry(6000, 2200), M.ground);
  M.ground.map.repeat.set(600, 220); gnd.rotation.x = -Math.PI / 2; gnd.position.set(Y.BL / 2, Y_GROUND, 0); gnd.receiveShadow = true; g.add(gnd);
  return g;
}
