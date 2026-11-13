import * as THREE from 'three';
import { Poly } from './track.js';
import { DEFS } from './models.js';

export const GAP = 0.9;
let CID = 1;

export function crop(poly, s0, s1) {
  s0 = Math.max(0, s0); s1 = Math.min(poly.len, s1);
  const pts = [poly.at(s0)];
  for (let i = 0; i < poly.pts.length; i++) if (poly.cum[i] > s0 + 1e-6 && poly.cum[i] < s1 - 1e-6) pts.push(poly.pts[i]);
  pts.push(poly.at(s1)); return pts.map(p => ({ x: p.x, z: p.z }));
}

export class Vehicle {
  constructor(kind, obj, label) { this.kind = kind; this.obj = obj; this.def = DEFS[kind]; this.half = this.def.half; this.rev = 0; this.label = label; }
}

export class Consist {
  constructor(vehicles, trail, name) {
    this.id = CID++; this.vehicles = vehicles; this.name = name || ('C' + this.id);
    this.poly = new Poly(trail); this.sFront = this.poly.len; this.moving = false; this.legs = []; this.speed = 0; this.wait = 0; this.t = 0; this.aF = 0; this.lastSpeed = 0;
    this.resetDyn();
  }
  resetDyn() { for (const v of this.vehicles) { v.dev = 0; v.dv = 0; v.roll = v.rollV = v.pitch = v.pitchV = 0; } this.hold = false; this.maxF = 0; }
  pinned() { const p = this.vehicles.findIndex(v => v.kind === 'shunter' || v.kind === 'loco'); return p < 0 ? 0 : p; }
  mass(v) { return v.kind === 'loco' ? 120e3 : v.kind === 'shunter' ? 40e3 : (v.obj.userData.cargo && v.obj.userData.cargo.visible ? 85e3 : 24e3); }
  totalMass() { return this.vehicles.reduce((a, v) => a + this.mass(v), 0); }
  impact(vr) { const p = this.pinned(); this.vehicles.forEach((v, i) => { if (i < p) v.dv = -vr; else if (i > p) v.dv = vr; }); }
  offsets() {
    const off = []; let a = 0;
    this.vehicles.forEach((v, i) => { if (i) a += this.vehicles[i - 1].half + GAP + v.half; else a = v.half; off.push(a); });
    return off;
  }
  length() { const o = this.offsets(); return o.length ? o[o.length - 1] + this.vehicles[this.vehicles.length - 1].half : 0; }
  front() { return this.poly.at(this.sFront); }
  rear() { return this.poly.at(this.sFront - this.length()); }
  dirEast() { return Math.cos(this.front().ang) >= 0; }
  place() {
    const off = this.offsets(), amp = Math.min(1, Math.abs(this.speed) / 8);
    this.vehicles.forEach((v, i) => {
      const s = this.sFront - off[i] + (v.dev || 0), pf = this.poly.at(s + v.def.piv), pr = this.poly.at(s - v.def.piv);
      const hd = Math.atan2(pf.z - pr.z, pf.x - pr.x), sg = v.rev ? -1 : 1;
      v.obj.position.set((pf.x + pr.x) / 2, 0.008 * amp * Math.sin(this.t * 17 + i * 2.1), (pf.z + pr.z) / 2);
      v.obj.rotation.order = 'YXZ';
      v.obj.rotation.set((v.roll || 0) * sg, -hd + (v.rev ? Math.PI : 0), (v.pitch || 0) * sg);
    });
  }
  // inverte a orientação lógica (frente <-> traseira) sem mover os veículos
  flip() {
    const L = this.length(), sRear = this.sFront - L;
    const pts = crop(this.poly, sRear, this.sFront).reverse();
    this.vehicles.reverse(); this.vehicles.forEach(v => v.rev ^= 1);
    this.poly = new Poly(pts); this.sFront = this.poly.len; this.resetDyn();
  }
  startLeg(pts) {
    const keep = crop(this.poly, this.sFront - this.length() - 2, this.sFront);
    const all = keep.concat(pts.slice(1).map(p => ({ x: p.x, z: p.z })));
    this.poly = new Poly(all);
    this.sFront = new Poly(keep).len; this.target = this.poly.len; this.moving = true; this.speed = 0;
  }
  // legs: [{pts, sets}] ; onSets(leg) chamado ao iniciar cada perna; onDone ao terminar
  go(legs, onSets, onDone, trimFirst) {
    this.legs = legs.slice(); this.onSets = onSets; this.onDone = onDone; this.userStop = false; this._next(!!trimFirst);
  }
  powered() { return this.vehicles.some(v => v.kind === 'loco' || v.kind === 'shunter'); }
  // frenagem normal: para a composição em movimento o mais cedo possível
  stopNow() {
    if (!this.moving) return;
    this.legs = []; this.userStop = true;
    this.target = Math.min(this.target, this.sFront + this.speed * this.speed / 2 + 0.3);
  }
  // true se a locomotiva (veículo motor) aponta o nariz para a frente lógica da composição
  noseFront() { const p = this.vehicles.find(v => v.kind === 'loco') || this.vehicles.find(v => v.kind === 'shunter'); return !p || !p.rev; }
  _next(trim) {
    const leg = this.legs.shift();
    if (!leg) { this.finish(); return; }
    if (this.onSets) this.onSets(leg);
    let pts = leg.pts;
    if (trim) { const P = new Poly(pts); pts = crop(P, Math.min(this.length(), P.len - 0.5), P.len); }
    this.startLeg(pts);
  }
  finish() {
    this.moving = false; this.speed = 0;
    this.poly = new Poly(crop(this.poly, this.sFront - this.length() - 1, this.sFront)); this.sFront = this.poly.len;
    const d = this.onDone; this.onDone = null; if (d) d();
  }
  update(dt, vmax, accel = 1.2) {
    if (dt <= 0) return;
    this.t += dt; let aF = 0;
    if (this.wait > 0) this.wait -= dt;
    else if (this.moving) {
      const prev = this.speed, rem = this.target - this.sFront;
      if (this.hold) this.speed = Math.max(0, this.speed - 3.5 * dt);
      else this.speed = Math.min(this.speed + accel * dt, vmax, Math.sqrt(2 * accel * Math.max(0, rem)) + 0.4);
      this.sFront = Math.min(this.target, this.sFront + this.speed * dt);
      aF = (this.speed - prev) / dt;
      if (this.target - this.sFront < 0.02) {
        this.lastSpeed = Math.max(this.speed, 0.4); this.speed = 0;
        if (this.legs.length) { this.flip(); this.wait = 1.0; this._next(true); } else this.finish();
      }
    } else this.speed = 0;
    this.aF = aF; this.physics(dt, aF);
  }
  // dinâmica longitudinal (folgas e molas dos engates) e suspensão (rolagem/arfagem)
  physics(dt, aF) {
    const V = this.vehicles, n = V.length; if (!n) return;
    const steps = Math.max(1, Math.ceil(dt / 0.01)), h = dt / steps, p = this.pinned();
    const K = 2.0e7, C = 6.0e5, SL = 0.09, F = new Array(Math.max(0, n - 1)).fill(0); let maxF = 0;
    for (let st = 0; st < steps; st++) {
      for (let i = 0; i < n - 1; i++) {
        const s = V[i].dev - V[i + 1].dev, vr = V[i].dv - V[i + 1].dv; let f = 0;
        if (s > SL) { f = K * (s - SL) + C * vr; if (f < 0) f = 0; } else if (s < -SL) { f = K * (s + SL) + C * vr; if (f > 0) f = 0; }
        F[i] = f; if (Math.abs(f) > maxF) maxF = Math.abs(f);
      }
      for (let i = 0; i < n; i++) {
        const v = V[i]; if (i === p) { v.dev = 0; v.dv = 0; continue; }
        const net = (i > 0 ? F[i - 1] : 0) - (i < n - 1 ? F[i] : 0);
        v.dv += (net / this.mass(v) - aF - 0.8 * v.dv) * h; v.dev += v.dv * h;
        if (v.dev > 1.2) { v.dev = 1.2; v.dv = 0; } else if (v.dev < -1.2) { v.dev = -1.2; v.dv = 0; }
      }
    }
    this.maxF = maxF;
    const off = this.offsets(), sp = this.speed, W = 7, Z = 0.2;
    const wrap = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
    const pT = Math.max(-0.02, Math.min(0.02, 0.006 * aF));
    V.forEach((v, i) => {
      const s = this.sFront - off[i] + v.dev, k = wrap(this.poly.at(s + 3).ang - this.poly.at(s - 3).ang) / 6;
      let tgt = -Math.max(-0.05, Math.min(0.05, 0.03 * sp * sp * k)) + 0.0015 * Math.sin(this.t * 11 + i * 1.7) * Math.min(1, sp / 8);
      v.rollV += (-W * W * (v.roll - tgt) - 2 * Z * W * v.rollV) * dt; v.roll += v.rollV * dt;
      v.pitchV += (-36 * (v.pitch - pT) - 2 * 0.25 * 6 * v.pitchV) * dt; v.pitch += v.pitchV * dt;
    });
  }
  // divide depois do veículo de índice k; devolve [frente, trás]
  split(k) {
    const off = this.offsets(), L = this.length(), sF = this.sFront;
    const A = this.vehicles.slice(0, k + 1), B = this.vehicles.slice(k + 1);
    const lenA = off[k] + this.vehicles[k].half;
    const sB = sF - (off[k + 1] - this.vehicles[k + 1].half), lenB = L - (off[k + 1] - this.vehicles[k + 1].half);
    const ca = new Consist(A, crop(this.poly, sF - lenA, sF), this.name), cb = new Consist(B, crop(this.poly, sB - lenB, sB));
    return [ca, cb];
  }
}

// Acopla a composição 'a' (parada com a frente a GAP da ponta de 'b') a 'b', em qualquer trecho de via (reta ou curva)
export function mergeContact(a, b) {
  const fa = a.front(), bf = b.front(), br = b.rear();
  const nearFront = Math.hypot(bf.x - fa.x, bf.z - fa.z) < Math.hypot(br.x - fa.x, br.z - fa.z);
  const Lb = b.length();
  let ptsB = crop(b.poly, b.sFront - Lb, b.sFront);              // traseira -> frente de b
  let vb = b.vehicles.slice();
  if (nearFront) { ptsB = ptsB.reverse(); vb.reverse(); vb.forEach(v => v.rev ^= 1); } // frente de b encosta em a: percorre de frente para trás
  const trail = crop(a.poly, a.sFront - a.length() - 1, a.sFront).concat(ptsB);
  const vs = vb.concat(a.vehicles);                               // da frente para trás: [b (longe -> perto)] + [a]
  return new Consist(vs, trail);
}

// junta duas composições paradas na mesma linha reta (leste na frente)
export function merge(a, b) {
  if (!a.dirEast()) a.flip(); if (!b.dirEast()) b.flip();
  const [E, W] = a.front().x >= b.front().x ? [a, b] : [b, a];
  const vs = E.vehicles.concat(W.vehicles);
  const z = E.front().z, xf = E.front().x;
  const tmp = new Consist(vs, [{ x: xf - 1, z }, { x: xf, z }]);
  const L = tmp.length();
  const c = new Consist(vs, [{ x: xf - L, z }, { x: xf, z }], E.name);
  return c;
}

// distância gap entre composições (leste na frente)
export function span(c) { const f = c.front(), r = c.rear(); return { x1: Math.min(f.x, r.x), x2: Math.max(f.x, r.x), z: f.z }; }

export function makeConsist(vehicles, rearX, z, name) {
  const tmp = new Consist(vehicles, [{ x: 0, z }, { x: 1, z }]);
  const L = tmp.length();
  return new Consist(vehicles, [{ x: rearX, z }, { x: rearX + L, z }], name);
}
