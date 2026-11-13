import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const DEFS = {
  loco: { file: 'models/loco.txt', half: 9.7, piv: 5.7, rotY: Math.PI, y: 0, name: 'Locomotiva C36-7' },
  gondola: { file: 'models/gondola.txt', half: 9.03, piv: 5.8, rotY: 0, y: 0, name: 'Vagão' },
  shunter: { file: 'models/shunter.txt', half: 5.79, piv: 2.3, rotY: Math.PI / 2, y: -0.6, name: 'Locomotiva helper' },
};
export const PAINTS = [0xa83a2e, 0x3d5a80, 0x4a6b3a, 0x8a6a2a, 0x6b3f6b, 0x2f6f73, 0x7a4a2a];
const CARGOS = [0x6b2f1f, 0x1a1a1c, 0xb59a62, 0x8a8a84];

// junta todas as malhas com o mesmo material para reduzir drawcalls
function mergeByMaterial(root, skip) {
  root.updateMatrixWorld(true);
  const groups = new Map(), keep = [];
  root.traverse(o => {
    if (!o.isMesh || (skip && skip(o))) return;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    if (mat.transmission > 0) { mat.transmission = 0; mat.transparent = true; mat.opacity = Math.min(mat.opacity, 0.35); mat.depthWrite = false; }
    mat.envMapIntensity = 0.8;
    const g = o.geometry.clone();
    for (const k of ['position', 'normal', 'uv']) {   // mergeGeometries não aceita atributos entrelaçados (normais compactas do C36)
      const a = g.attributes[k];
      if (a && a.isInterleavedBufferAttribute) {
        const s = a.itemSize, arr = new Float32Array(a.count * s);
        for (let i = 0; i < a.count; i++) { arr[i * s] = a.getX(i); arr[i * s + 1] = a.getY(i); if (s > 2) arr[i * s + 2] = a.getZ(i); }
        g.setAttribute(k, new THREE.BufferAttribute(arr, s));
      }
    }
    g.applyMatrix4(o.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.index) { const n = g.attributes.position.count, ix = new Uint32Array(n); for (let i = 0; i < n; i++) ix[i] = i; g.setIndex(new THREE.BufferAttribute(ix, 1)); }
    else if (g.index.array instanceof Uint16Array) g.setIndex(new THREE.BufferAttribute(Uint32Array.from(g.index.array), 1));
    if (!groups.has(mat)) groups.set(mat, []); groups.get(mat).push(g);
  });
  const out = new THREE.Group();
  for (const [mat, gs] of groups) {
    try {
      const mg = mergeGeometries(gs, false); if (!mg) throw new Error('merge');
      const m = new THREE.Mesh(mg, mat); m.castShadow = true; m.receiveShadow = false; out.add(m);
    } catch (e) { console.warn('merge falhou', mat.name, e); }
  }
  return out;
}

// monte de carga dentro do vagão aberto
function cargoMesh(color, seed) {
  const g = new THREE.PlaneGeometry(15.4, 2.7, 56, 10); g.rotateX(-Math.PI / 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i), ex = 1 - Math.pow(Math.abs(x) / 7.7, 6), ez = 1 - Math.pow(Math.abs(z) / 1.35, 4);
    const n = Math.sin(x * 1.7 + seed) * 0.09 + Math.sin(x * 0.55 + z * 2.3 + seed * 2) * 0.12 + Math.sin(z * 5 + x * 0.9) * 0.05;
    p.setY(i, 2.15 + (0.55 + n) * Math.max(0, Math.min(1, ex * ez * 1.4)) + (1 - Math.min(1, ex * ez * 1.4)) * -0.2);
  }
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true }));
  m.name = 'cargo'; m.castShadow = false; return m;
}

function fallback(def, color) {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.BoxGeometry(def.half * 2, 1.6, 2.8), new THREE.MeshStandardMaterial({ color }));
  b.position.y = 2.2; b.castShadow = true; g.add(b); g.userData.fallback = true; return g;
}

export async function loadModels(onProgress) {
  const loader = new GLTFLoader(), protos = {}, status = {};
  const names = Object.keys(DEFS); let done = 0;
  await Promise.all(names.map(async k => {
    const d = DEFS[k];
    try {
      const r = await fetch(d.file); if (!r.ok) throw new Error('HTTP ' + r.status);
      const b64 = await r.text(), bin = atob(b64.trim()), u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const gltf = await loader.parseAsync(u8.buffer, '');
      if (k === 'loco') {   // textura da pintura Vale (fora do GLB)
        try {
          const tex = await new THREE.TextureLoader().loadAsync(window.__LIVERY_URL || 'models/livery.jpg');
          tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.anisotropy = 8;
          gltf.scene.traverse(o => { if (o.isMesh && o.material && o.material.name === 'Vale livery paint') { o.material.map = tex; o.material.needsUpdate = true; } });
        } catch (e) { console.warn('textura da pintura', e); }
      }
      const skip = k === 'shunter' ? (o => /Rail|ballast|sleepers/i.test(o.name)) : null;
      protos[k] = mergeByMaterial(gltf.scene, skip); status[k] = 'ok';
    } catch (e) { console.error('modelo', k, e); protos[k] = fallback(d, k === 'loco' ? 0x3d6b8a : k === 'shunter' ? 0xf2c200 : 0x8a3a2e); status[k] = 'erro: ' + (e.message || e); }
    done++; onProgress && onProgress(done / names.length, k);
  }));
  return { protos, status };
}

let paintIdx = 0, cargoIdx = 0;
export function instantiate(kind, protos, opt = {}) {
  const d = DEFS[kind], root = new THREE.Group(), body = protos[kind].clone(true);
  const paint = opt.paint ?? PAINTS[paintIdx++ % PAINTS.length];
  body.traverse(o => {
    if (!o.isMesh) return;
    if (kind === 'gondola' && /red outdoor paint/i.test(o.material.name)) { o.material = o.material.clone(); o.material.color.setHex(paint); }
    if (kind === 'loco' && /teal enamel/i.test(o.material.name) && opt.paint) { o.material = o.material.clone(); o.material.color.setHex(opt.paint); }
  });
  body.rotation.y = d.rotY; body.position.y = d.y; root.add(body);
  let cargo = null;
  if (kind === 'gondola') {
    const ci = (opt.cargo ?? cargoIdx++) % CARGOS.length;
    cargo = cargoMesh(CARGOS[ci], ci * 3.1 + paintIdx); cargo.visible = opt.loaded !== false; root.add(cargo);
  }
  root.userData = { kind, cargo, paint };
  return root;
}
