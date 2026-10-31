// Client-only "game feel": hit-stop, screen shake, particles, squash & stretch, googly-eye
// and hat springs, and the sound cues that go with them. Nothing here touches the sim.
import type { FighterSnapshot, Snapshot } from '@sfc/shared';
import { boing, bonk, flop, grunt, koSound, playEffect, pop, slap, thump, whoosh } from './audio.js';

export interface Particle {
  kind: 'star' | 'dust' | 'spark' | 'sweat';
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  spin: number;
  life: number;
  max: number;
  size: number;
  color: string;
}

export interface Look {
  /** Googly pupils: offset in head radii, lagging behind head motion. */
  eyeX: number;
  eyeY: number;
  eyeVx: number;
  eyeVy: number;
  /** Hat wobble angle relative to the head, and a little hop. */
  hat: number;
  hatV: number;
  hatHop: number;
  hatHopV: number;
  /** Squash: >0 squashed (wide), <0 stretched (tall). */
  squash: number;
  squashV: number;
  lastHead: { x: number; y: number } | null;
  lastHeadV: { x: number; y: number };
  lastHeadAngle: number;
  state: string;
  grounded: boolean;
  vy: number;
  attack: string | null;
  grabbing: boolean;
  seen: number;
}

export const juice = {
  particles: [] as Particle[],
  looks: new Map<string, Look>(),
  shake: 0,
  freezeUntil: 0,
  heard: new Set<number>(),
  lastNow: 0,
};

export function lookFor(id: string): Look {
  let look = juice.looks.get(id);
  if (!look) {
    look = {
      eyeX: 0,
      eyeY: 0,
      eyeVx: 0,
      eyeVy: 0,
      hat: 0,
      hatV: 0,
      hatHop: 0,
      hatHopV: 0,
      squash: 0,
      squashV: 0,
      lastHead: null,
      lastHeadV: { x: 0, y: 0 },
      lastHeadAngle: 0,
      state: 'idle',
      grounded: true,
      vy: 0,
      attack: null,
      grabbing: false,
      seen: 0,
    };
    juice.looks.set(id, look);
  }
  return look;
}

const STAR_COLORS = ['#ffe14a', '#fff6c4', '#ff9a4a', '#7ad7ff'];

function burst(x: number, y: number, mag: number): void {
  const n = Math.round(5 + mag * 5);
  for (let i = 0; i < n; i += 1) {
    const a = Math.random() * Math.PI * 2;
    const speed = 2 + Math.random() * 4 * (0.6 + mag * 0.5);
    juice.particles.push({
      kind: i % 3 === 0 ? 'spark' : 'star',
      x,
      y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed + 2,
      rot: Math.random() * 6,
      spin: (Math.random() - 0.5) * 18,
      life: 0.5 + Math.random() * 0.35,
      max: 0.85,
      size: 0.06 + Math.random() * 0.06 * (0.7 + mag * 0.4),
      color: STAR_COLORS[i % STAR_COLORS.length] ?? '#ffe14a',
    });
  }
}

function dust(x: number, y: number, mag: number): void {
  for (let i = 0; i < 6 + mag * 4; i += 1) {
    const dir = i % 2 === 0 ? 1 : -1;
    juice.particles.push({
      kind: 'dust',
      x: x + dir * Math.random() * 0.2,
      y: y + 0.03,
      vx: dir * (0.8 + Math.random() * 2) * (0.6 + mag * 0.4),
      vy: 0.3 + Math.random() * 0.8,
      rot: 0,
      spin: 0,
      life: 0.45 + Math.random() * 0.3,
      max: 0.75,
      size: 0.08 + Math.random() * 0.08,
      color: '#c9b9a6',
    });
  }
}

function sweat(x: number, y: number): void {
  for (let i = 0; i < 3; i += 1) {
    juice.particles.push({
      kind: 'sweat',
      x,
      y,
      vx: (Math.random() - 0.5) * 3,
      vy: 2 + Math.random() * 2,
      rot: 0,
      spin: 0,
      life: 0.5,
      max: 0.5,
      size: 0.05,
      color: '#9fe3ff',
    });
  }
}

export function kick(shake: number, freezeMs: number, now: number): void {
  juice.shake = Math.min(1.4, juice.shake + shake);
  if (freezeMs > 0) juice.freezeUntil = Math.max(juice.freezeUntil, now + freezeMs);
}

export function frozen(now: number): boolean {
  return now < juice.freezeUntil;
}

/** Look at a fresh snapshot: spawn particles, freeze frames, play sounds for new events. */
export function observe(snap: Snapshot, now: number, focusId: string, sound = true): void {
  for (const effect of snap.effects) {
    if (juice.heard.has(effect.id)) continue;
    juice.heard.add(effect.id);
    if (effect.kind === 'hit') {
      burst(effect.x, effect.y, effect.mag);
      kick(0.25 + effect.mag * 0.3, 45 + Math.min(70, effect.mag * 45), now);
      if (sound) playEffect('hit', effect.mag);
    } else if (effect.kind === 'text') {
      const word = effect.text;
      if (/BONK/.test(word)) {
        if (sound) bonk(1.1);
        kick(0.35, 60, now);
      } else if (/K\.O/.test(word)) {
        kick(1, 160, now);
        burst(effect.x, effect.y, 2.4);
      } else if (/SPLAT|THUD/.test(word) && sound) flop(1.2);
    } else {
      if (effect.kind === 'boom') {
        burst(effect.x, effect.y, 2);
        kick(0.9, 90, now);
      }
      if (sound) playEffect(effect.kind, effect.mag);
    }
  }
  if (juice.heard.size > 200) {
    const keep = new Set(snap.effects.map((effect) => effect.id));
    for (const id of juice.heard) if (!keep.has(id)) juice.heard.delete(id);
  }

  for (const f of snap.fighters) {
    const look = lookFor(f.id);
    look.seen = now;
    const near = f.id === focusId ? 1 : 0.7;
    if (look.state !== f.state) {
      if (f.state === 'ko') {
        if (sound) koSound();
        kick(0.6, 0, now);
      } else if (f.state === 'fallen' && look.state !== 'ko') {
        if (sound) grunt(0.9, 0.2);
        look.squashV += 6;
      } else if (f.state === 'getup' && sound && Math.random() < 0.7) grunt(1.3, 0.12);
      else if (f.state === 'stumble' && sound) grunt(1.1, 0.12);
    }
    if (look.grounded && !f.grounded && f.vy > 3 && f.state !== 'fallen' && f.state !== 'ko') {
      if (sound) boing();
      look.squashV -= 9;
    }
    if (!look.grounded && f.grounded && look.vy < -4) {
      const hard = Math.min(2, -look.vy / 7);
      dust(f.points.hip.x, Math.min(f.points.ankleF.y, f.points.ankleB.y) - 0.05, hard);
      look.squashV += 4 + hard * 5;
      if (hard > 0.9 && sound) flop(hard * 0.6 * near);
    }
    if (f.attack && f.attack !== look.attack && sound) whoosh(f.attack === 'kick' ? 1.3 : 0.8);
    if (f.grabbing && !look.grabbing && sound) pop();
    if ((f.stun ?? 0) > 0.2 && look.state !== 'stumble' && f.state === 'stumble') sweat(f.points.head.x, f.points.head.y + 0.2);
    look.state = f.state;
    look.grounded = f.grounded;
    look.vy = f.vy;
    look.attack = f.attack;
    look.grabbing = f.grabbing;
  }
  void slap;
  void thump;
}

/** Advance springs and particles by real time. */
export function tick(snap: Snapshot, dt: number): void {
  dt = Math.min(dt, 0.05);
  juice.shake *= Math.exp(-7 * dt);
  for (const p of juice.particles) {
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.spin * dt;
    if (p.kind === 'dust') {
      p.vx *= Math.exp(-3 * dt);
      p.vy *= Math.exp(-2 * dt);
      p.size += dt * 0.25;
    } else {
      p.vy -= 14 * dt;
      p.vx *= Math.exp(-1.2 * dt);
    }
  }
  if (juice.particles.length > 0) juice.particles = juice.particles.filter((p) => p.life > 0);
  if (juice.particles.length > 260) juice.particles.splice(0, juice.particles.length - 260);
  for (const f of snap.fighters) springs(f, lookFor(f.id), dt);
}

function springs(f: FighterSnapshot, look: Look, dt: number): void {
  const head = f.points.head;
  let ax = 0;
  let ay = 0;
  if (look.lastHead && dt > 0) {
    const vx = (head.x - look.lastHead.x) / dt;
    const vy = (head.y - look.lastHead.y) / dt;
    if (Math.abs(vx) < 60 && Math.abs(vy) < 60) {
      ax = (vx - look.lastHeadV.x) / dt;
      ay = (vy - look.lastHeadV.y) / dt;
      look.lastHeadV = { x: vx, y: vy };
    }
  }
  look.lastHead = { x: head.x, y: head.y };
  ax = Math.max(-400, Math.min(400, ax));
  ay = Math.max(-400, Math.min(400, ay));
  // Pupils: a loose, under-damped spring pulled by gravity and flung by head acceleration.
  const k = 160;
  const c = 7;
  look.eyeVx += (-k * look.eyeX - c * look.eyeVx - ax * 0.012) * dt;
  look.eyeVy += (-k * (look.eyeY + 0.06) - c * look.eyeVy - (ay + 30) * 0.012) * dt;
  look.eyeX += look.eyeVx * dt;
  look.eyeY += look.eyeVy * dt;
  const r = Math.hypot(look.eyeX, look.eyeY);
  if (r > 0.55) {
    look.eyeX *= 0.55 / r;
    look.eyeY *= 0.55 / r;
    look.eyeVx *= -0.4;
    look.eyeVy *= -0.4;
  }
  // Hat: lags the head's rotation and gets tossed by vertical jolts.
  const dAngle = normalize(f.headAngle - look.lastHeadAngle);
  look.lastHeadAngle = f.headAngle;
  look.hatV += (-90 * look.hat - 5 * look.hatV) * dt - (dt > 0 ? dAngle / dt : 0) * 0.04 - ax * 0.0035 * dt;
  look.hat = Math.max(-1.1, Math.min(1.1, look.hat + look.hatV * dt));
  look.hatHopV += (-140 * look.hatHop - 6 * look.hatHopV + Math.max(0, ay) * 0.004) * dt;
  look.hatHop = Math.max(-0.1, Math.min(0.9, look.hatHop + look.hatHopV * dt));
  if (f.flash > 0.1 && look.hatHop < 0.05) look.hatHopV += 6;
  // Squash and stretch: stretch along fast vertical motion, springy rebound after impacts.
  look.squashV += (-220 * look.squash - 9 * look.squashV) * dt;
  look.squash += look.squashV * dt;
  const stretch = Math.max(-0.22, Math.min(0.22, -Math.abs(f.vy) * 0.012));
  look.squash = Math.max(-0.35, Math.min(0.4, look.squash + (stretch - look.squash) * Math.min(1, dt * 2)));
}

function normalize(a: number): number {
  let x = (a + Math.PI) % (Math.PI * 2);
  if (x < 0) x += Math.PI * 2;
  return x - Math.PI;
}
