import * as THREE from 'three';
import { Y_GROUND } from './geom.js';

const mat = (c, r = 0.8, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
const bx = (w, h, d, m, x, y, z) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; return o; };

function textSprite(text, sub, w = 14) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 160; const x = c.getContext('2d');
  x.fillStyle = 'rgba(16,24,32,.86)'; x.fillRect(0, 0, 512, 160);
  x.fillStyle = '#f2c200'; x.fillRect(0, 0, 14, 160);
  x.fillStyle = '#fff'; x.font = 'bold 74px system-ui,sans-serif'; x.textBaseline = 'middle'; x.fillText(text, 36, 58);
  x.fillStyle = '#b9c7d3'; x.font = '34px system-ui,sans-serif'; x.fillText(sub, 36, 125);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.scale.set(w, w * 160 / 512, 1); return s;
}

export function bufferStop(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z);
  const steel = mat(0x2d2f33, 0.6, 0.5), red = mat(0xc0281e), white = mat(0xf0eee6);
  g.add(bx(1.2, 0.5, 3.4, mat(0x6b4a33, 0.95), 0.5, -0.38, 0));
  for (const s of [-1, 1]) { g.add(bx(0.35, 1.5, 0.35, steel, 0.4, 0.55, s * 1.25)); g.add(bx(1.0, 0.12, 0.28, steel, 0.1, -0.1, s * HGx)); }
  g.add(bx(0.4, 0.42, 3.2, steel, 0.4, 1.05, 0));
  for (let i = 0; i < 8; i++) g.add(bx(0.42, 0.44, 0.4, i % 2 ? white : red, 0.4, 1.05, -1.4 + i * 0.4));
  for (const s of [-0.7, 0.7]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.5, 14), steel); b.rotation.z = Math.PI / 2; b.position.set(-0.05, 1.05, s); g.add(b); }
  const lamp = bx(0.25, 0.25, 0.25, new THREE.MeshBasicMaterial({ color: 0xff2a1a }), 0.4, 1.9, 0); g.add(lamp);
  g.add(bx(0.06, 0.8, 0.06, steel, 0.4, 1.4, 0));
  return g;
}
const HGx = 0.7175;

export function derailer(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z + 0.7175);
  g.add(bx(1.2, 0.1, 0.25, mat(0xf2c200, 0.5), 0, 0.04, 0), bx(0.5, 0.18, 0.16, mat(0xf2c200, 0.5), 0.1, 0.12, -0.12));
  const pole = bx(0.03, 0.9, 0.03, mat(0x333333), 0, 0.5, 0.25); g.add(pole);
  g.add(bx(0.4, 0.28, 0.02, mat(0xc0281e), 0.2, 0.85, 0.25));
  return g;
}

export function buildScenery(Y) {
  const g = new THREE.Group(), conc = mat(0xb8b5ac, 0.9), dark = mat(0x31353a, 0.7, 0.4);
  // fim de linha da linha morta
  const bs = Y.buffers[0]; g.add(bufferStop(bs.x + 0.9, bs.z), derailer(bs.x - 24, bs.z));
  // doca de carga ao lado da linha morta
  const zD = Y.lines.L6 - 3.9;
  g.add(bx(70, 1.05, 4.4, conc, 150, 0.52 - 0.3 + 0.2, zD));
  g.add(bx(70.6, 0.12, 0.3, mat(0xf2c200, 0.7), 150, 1.0, zD + 2.0));
  g.add(bx(10, 0.6, 4.4, conc, 112, 0.0, zD));
  for (let i = 0; i < 5; i++) {
    const c = new THREE.Mesh(new THREE.ConeGeometry(2.2, 2.0, 14), mat([0x5a3a2a, 0x2a2a2c, 0x8a7a55][i % 3], 1)); c.position.set(128 + i * 9.5, 2.1, zD - 0.2); c.castShadow = true; g.add(c);
  }
  for (const sx of [135, 160]) {
    const silo = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 11, 24), mat(0xcfd2d4, 0.5, 0.2)); silo.position.set(sx, 6, zD - 6.5); silo.castShadow = true; g.add(silo);
    const top = new THREE.Mesh(new THREE.ConeGeometry(3.1, 2, 24), mat(0x9aa0a4, 0.5, 0.3)); top.position.set(sx, 12.5, zD - 6.5); g.add(top);
    g.add(bx(1.2, 5, 1.2, dark, sx, 2.5, zD - 3));
  }
  // cabine de controle
  const cab = new THREE.Group(); cab.position.set(190, 0, 34);
  cab.add(bx(10, 3.2, 5, mat(0xe6e1d3, 0.8), 0, 1.3, 0), bx(10.8, 0.3, 5.8, mat(0x6b3b2a), 0, 3.1, 0));
  const win = bx(6.6, 1.1, 0.06, new THREE.MeshStandardMaterial({ color: 0x6fa9c9, metalness: 0.4, roughness: 0.15 }), 0, 1.7, -2.53); cab.add(win);
  const sg = textSprite('Cabine de AMV', 'Controle de manobras', 7); sg.position.set(0, 6, 0); cab.add(sg); g.add(cab);
  // torres de iluminação
  const pole = mat(0x6d737a, 0.5, 0.6), lampM = new THREE.MeshBasicMaterial({ color: 0xfff4cf });
  for (const [x, z] of [[-250, 28], [-20, 28], [190, -16], [380, 28], [600, 28], [-250, -14], [380, -16]]) {
    g.add(bx(0.4, 22, 0.4, pole, x, 10.7, z));
    const h = bx(4.2, 0.5, 1.2, pole, x, 21.9, z); g.add(h);
    for (let i = 0; i < 4; i++) g.add(bx(0.8, 0.12, 0.8, lampM, x - 1.5 + i, 21.6, z));
  }
  // placas de linha
  const names = { L1: 'Linha 1', L2: 'Linha 2', L3: 'Linha 3', L4: 'Linha 4', L5: 'Linha 5', L6: 'Linha 6' };
  const subs = { L1: 'principal · passagem', L2: 'cruzamento · estoque', L3: 'composição principal', L4: 'vagões isolados', L5: 'vagões isolados', L6: 'linha morta · desvio de carga' };
  for (const k in names) {
    const s = textSprite(names[k], subs[k], 12); s.position.set(10, 8.5, Y.lines[k]); g.add(s);
  }
  return g;
}
