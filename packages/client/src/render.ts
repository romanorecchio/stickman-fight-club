import {
  clamp,
  lerp,
  lerpAngle,
  weaponById,
  type FighterSnapshot,
  type PointName,
  type Snapshot,
  type Vec2,
} from '@sfc/shared';
import { juice, lookFor, type Look } from './juice.js';

export interface Camera {
  x: number;
  y: number;
  zoom: number;
  shake: number;
  ox: number;
  oy: number;
}

export interface View {
  width: number;
  height: number;
}

const PALETTE = [
  { bone: '#f4efe4', ink: '#1a1210', joint: '#7ad7ff' },
  { bone: '#f3c3a4', ink: '#24110e', joint: '#ff5a36' },
  { bone: '#d9f5c9', ink: '#14210f', joint: '#8dff7a' },
  { bone: '#f7e7a1', ink: '#241e0c', joint: '#ffe14a' },
  { bone: '#e4d4ff', ink: '#1a1424', joint: '#c49bff' },
  { bone: '#ffd0e0', ink: '#241018', joint: '#ff7aa8' },
  { bone: '#d4f1ff', ink: '#102028', joint: '#5ad0ff' },
  { bone: '#ffe0cc', ink: '#24160e', joint: '#ff9a4a' },
] as const;

export function createCamera(): Camera {
  return { x: -1.6, y: 1.7, zoom: 86, shake: 0, ox: 0, oy: 0 };
}

export function updateCamera(
  cam: Camera,
  snap: Snapshot,
  dt: number,
  view: View,
  shakeEnabled: boolean,
  focusId = 'player',
): void {
  const player =
    snap.fighters.find((fighter) => fighter.id === focusId) ??
    snap.fighters.find((fighter) => fighter.id === 'player') ??
    snap.fighters[0];
  if (!player) return;
  const hip = player.points.hip;
  const targetX = hip.x + clamp(player.vx * 0.18, -1.3, 1.3) + player.facing * 0.15;
  const targetY = hip.y + 0.7 + clamp(player.vy * 0.04, -0.4, 0.6);
  const k = 1 - Math.exp(-4.2 * dt);
  const wantZoom = clamp(Math.min(view.height / 7, view.width / 12), 64, 150);
  cam.zoom += (wantZoom - cam.zoom) * (1 - Math.exp(-3 * dt));
  cam.x += (targetX - cam.x) * k;
  cam.y += (targetY - cam.y) * k;
  const halfW = view.width / 2 / cam.zoom;
  const halfH = view.height / 2 / cam.zoom;
  const bounds = snap.bounds;
  if (bounds.maxX - bounds.minX > halfW * 2) cam.x = clamp(cam.x, bounds.minX + halfW, bounds.maxX - halfW);
  if (bounds.maxY - bounds.minY > halfH * 2) cam.y = clamp(cam.y, bounds.minY + halfH * 0.35, bounds.maxY - halfH);
  if (shakeEnabled && player.flash > 0.04) cam.shake = Math.min(1, cam.shake + player.flash * 0.85);
  cam.shake *= Math.exp(-6 * dt);
  const total = shakeEnabled ? Math.min(1.6, cam.shake + juice.shake) : 0;
  cam.ox = (Math.random() - 0.5) * total * 22;
  cam.oy = (Math.random() - 0.5) * total * 16;
}

export function screenPoint(cam: Camera, view: View, world: Vec2): Vec2 {
  return {
    x: (world.x - cam.x) * cam.zoom + view.width / 2 + cam.ox,
    y: (cam.y - world.y) * cam.zoom + view.height / 2 + cam.oy,
  };
}

export function worldPoint(cam: Camera, view: View, screenX: number, screenY: number): Vec2 {
  return {
    x: (screenX - view.width / 2) / cam.zoom + cam.x,
    y: cam.y - (screenY - view.height / 2) / cam.zoom,
  };
}

export function interpolate(a: Snapshot, b: Snapshot, t: number): Snapshot {
  // Match fighters by id (roster order can change when someone joins or leaves).
  const prev = new Map(a.fighters.map((fighter) => [fighter.id, fighter]));
  return {
    ...b,
    fighters: b.fighters.map((fighter) => lerpFighter(prev.get(fighter.id) ?? fighter, fighter, t)),
  };
}

export function drawFrame(
  ctx: CanvasRenderingContext2D,
  snap: Snapshot,
  cam: Camera,
  view: View,
  debug: boolean,
  now: number,
): void {
  ctx.clearRect(0, 0, view.width, view.height);
  drawBackdrop(ctx, cam, view, now, snap.theme);
  for (const hazard of snap.hazards ?? []) drawHazard(ctx, cam, view, hazard);
  if (snap.match?.hill) drawHill(ctx, cam, view, snap.match.hill);
  for (const solid of snap.solids) drawSolid(ctx, cam, view, solid);
  for (const pickup of snap.pickups ?? []) drawPickup(ctx, cam, view, pickup);
  for (const shot of snap.projectiles ?? []) drawShot(ctx, cam, view, shot);
  for (const fighter of snap.fighters) drawShadow(ctx, cam, view, fighter);
  for (const fighter of snap.fighters) drawFighter(ctx, cam, view, fighter, now);
  drawParticles(ctx, cam, view);
  for (const effect of snap.effects) drawEffect(ctx, cam, view, effect);
  if (debug) drawDebug(ctx, cam, view, snap);
}

function drawBackdrop(ctx: CanvasRenderingContext2D, cam: Camera, view: View, now: number, theme = 'night'): void {
  const sky = ctx.createLinearGradient(0, 0, 0, view.height);
  const tops: Record<string, [string, string, string]> = {
    night: ['#2a1a22', '#1a1218', '#100d10'],
    roof: ['#243044', '#1a2230', '#10141c'],
    lava: ['#3a1812', '#24110e', '#120a08'],
    yard: ['#2c2618', '#1a1814', '#10100e'],
    sky: ['#1c3048', '#142433', '#0e141c'],
    ring: ['#2a1820', '#1a1216', '#100c0e'],
  };
  const colors = tops[theme] ?? tops.night!;
  sky.addColorStop(0, colors[0]);
  sky.addColorStop(0.45, colors[1]);
  sky.addColorStop(1, colors[2]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, view.width, view.height);

  ctx.save();
  ctx.globalAlpha = 0.35;
  for (let i = 0; i < 7; i++) {
    const wx = -10 + i * 3.4 + Math.sin(now * 0.00015 + i) * 0.2;
    const top = screenPoint(cam, view, { x: wx, y: 7.2 });
    const bot = screenPoint(cam, view, { x: wx + 0.8, y: 0.2 });
    ctx.fillStyle = i % 2 === 0 ? '#3a242c' : '#24161c';
    ctx.fillRect(top.x, top.y, bot.x - top.x, bot.y - top.y);
  }
  ctx.restore();

  for (const lampX of [-6, -1.5, 3.2, 7.4]) {
    const lamp = screenPoint(cam, view, { x: lampX, y: 6.4 });
    const glow = ctx.createRadialGradient(lamp.x, lamp.y + 40, 8, lamp.x, lamp.y + 120, 180);
    glow.addColorStop(0, 'rgba(231, 177, 90, 0.18)');
    glow.addColorStop(1, 'rgba(231, 177, 90, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(lamp.x, lamp.y + 90, 180, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawHazard(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  view: View,
  hazard: Snapshot['hazards'][number],
): void {
  const center = screenPoint(cam, view, { x: hazard.x, y: hazard.y });
  const w = hazard.hx * 2 * cam.zoom;
  const h = hazard.hy * 2 * cam.zoom;
  ctx.save();
  ctx.globalAlpha = hazard.kind === 'lava' ? 0.85 : 0.28;
  ctx.fillStyle = hazard.kind === 'lava' ? '#ff5a1f' : hazard.kind === 'conveyor' ? '#67d0c4' : '#1a0c10';
  ctx.fillRect(center.x - w / 2, center.y - h / 2, w, h);
  ctx.restore();
}

function drawHill(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  view: View,
  hill: { x: number; y: number; ownerId: string | null },
): void {
  const center = screenPoint(cam, view, { x: hill.x, y: 0.05 });
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = hill.ownerId ? '#7dffa1' : '#ffe08a';
  ctx.beginPath();
  ctx.ellipse(center.x, center.y, 1.3 * cam.zoom, 0.28 * cam.zoom, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPickup(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  view: View,
  pickup: Snapshot['pickups'][number],
): void {
  const p = screenPoint(cam, view, pickup);
  const def = weaponById(pickup.weapon);
  ctx.save();
  ctx.fillStyle = '#e7b15a';
  ctx.fillRect(p.x - 7, p.y - 7, 14, 14);
  ctx.fillStyle = '#1a1210';
  ctx.font = '700 10px DejaVu Sans, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(def?.name ?? pickup.weapon, p.x, p.y - 12);
  ctx.restore();
}

function drawShot(ctx: CanvasRenderingContext2D, cam: Camera, view: View, shot: Snapshot['projectiles'][number]): void {
  const p = screenPoint(cam, view, shot);
  ctx.save();
  ctx.fillStyle = shot.weapon === 'banana' ? '#f2d24b' : shot.weapon === 'chicken' ? '#f4efe4' : '#ffb15a';
  ctx.beginPath();
  ctx.arc(p.x, p.y, shot.weapon === 'rocket' ? 5 : 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawSolid(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  view: View,
  solid: Snapshot['solids'][number],
): void {
  const center = screenPoint(cam, view, { x: solid.x, y: solid.y });
  const w = solid.hx * 2 * cam.zoom;
  const h = solid.hy * 2 * cam.zoom;
  const x = center.x - w / 2;
  const y = center.y - h / 2;
  if (solid.kind === 'ground') {
    ctx.fillStyle = '#2a211c';
    ctx.fillRect(x, y, w, h + view.height);
    ctx.fillStyle = '#4a342c';
    ctx.fillRect(x, y, w, 8);
    const mat = screenPoint(cam, view, { x: 0.2, y: 0.02 });
    ctx.strokeStyle = 'rgba(180, 60, 48, 0.85)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(mat.x, mat.y, 2.4 * cam.zoom, 0.28 * cam.zoom, 0, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }
  if (solid.kind === 'wall') {
    ctx.fillStyle = '#1a1418';
    ctx.fillRect(x, y, w, h);
    return;
  }
  if (solid.kind === 'rope') {
    ctx.strokeStyle = '#d7c4a4';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y + h / 2);
    ctx.lineTo(x + w, y + h / 2);
    ctx.stroke();
    return;
  }
  if (solid.kind === 'barrel') {
    ctx.fillStyle = '#c4552a';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = '#f0d2a0';
    ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
    return;
  }
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  if (solid.kind === 'crate') {
    grad.addColorStop(0, '#6b4632');
    grad.addColorStop(1, '#3c261c');
  } else {
    grad.addColorStop(0, '#3e4654');
    grad.addColorStop(1, '#262b34');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = solid.kind === 'crate' ? '#e7b15a' : '#8fd4ff';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
}

function drawShadow(ctx: CanvasRenderingContext2D, cam: Camera, view: View, fighter: FighterSnapshot): void {
  const hip = fighter.points.hip;
  const lift = clamp(hip.y / 4, 0, 1);
  const shadow = screenPoint(cam, view, { x: hip.x, y: 0.02 });
  ctx.save();
  ctx.globalAlpha = 0.35 * (1 - lift * 0.7);
  ctx.fillStyle = '#000';
  ctx.beginPath();
  ctx.ellipse(shadow.x, shadow.y, (0.42 + lift * 0.2) * cam.zoom, 0.08 * cam.zoom, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawFighter(ctx: CanvasRenderingContext2D, cam: Camera, view: View, fighter: FighterSnapshot, now: number): void {
  const look = PALETTE[fighter.color % PALETTE.length] ?? PALETTE[0];
  const juicy = lookFor(fighter.id);
  const pt = (name: PointName) => screenPoint(cam, view, fighter.points[name]);
  const z = cam.zoom;
  ctx.save();
  if (fighter.scale !== 1) {
    const hip = pt('hip');
    ctx.translate(hip.x, hip.y);
    ctx.scale(fighter.scale, fighter.scale);
    ctx.translate(-hip.x, -hip.y);
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = fighter.protecting ? 0.55 + 0.45 * Math.sin(now / 80) : 1;
  const hurt = fighter.flash > 0.02;
  const bone = hurt ? '#ffffff' : fighter.infected ? '#c6f27a' : look.bone;
  const shade = hurt ? '#f2f2f2' : shadeOf(fighter.infected ? '#c6f27a' : look.bone);
  const ink = look.ink;
  const limb = 0.125 * z;
  const outline = Math.max(3, 0.035 * z);

  const tube = (names: PointName[], width: number, fill: string) => {
    const pts = names.map(pt);
    stroke(ctx, pts, width + outline * 2, ink);
    stroke(ctx, pts, width, fill);
  };
  const ball = (p: Vec2, r: number, fill: string) => dot(ctx, p, r, fill, ink, outline);

  // Far side first, in a darker shade, so the body reads in depth.
  tube(['shoulder', 'elbowB', 'wristB'], limb, shade);
  ball(pt('handB'), 0.095 * z, shade);
  tube(['hip', 'kneeB', 'ankleB'], limb * 1.1, shade);
  tube(['heelB', 'toeB'], limb * 0.95, shade);

  // Bean-shaped torso, squashed and stretched along its own axis.
  const neck = pt('neck');
  const hip = pt('hip');
  const squash = juicy.squash;
  const mid = { x: (neck.x + hip.x) / 2, y: (neck.y + hip.y) / 2 };
  const len = 1 - squash * 0.35;
  const top = { x: mid.x + (neck.x - mid.x) * len, y: mid.y + (neck.y - mid.y) * len };
  const bottom = { x: mid.x + (hip.x - mid.x) * len, y: mid.y + (hip.y - mid.y) * len };
  stroke(ctx, [bottom, top], 0.36 * z * (1 + squash * 0.3) + outline * 2, ink);
  stroke(ctx, [bottom, top], 0.36 * z * (1 + squash * 0.3), bone);
  // Little shorts in the player's accent colour.
  stroke(ctx, [bottom, lerpPt(bottom, top, 0.3)], 0.36 * z * (1 + squash * 0.3), look.joint);

  tube(['hip', 'kneeF', 'ankleF'], limb * 1.1, bone);
  tube(['heelF', 'toeF'], limb * 0.95, bone);

  // Big wobbly head.
  const head = pt('head');
  const headR = 0.25 * z * (fighter.giantHead ? 1.85 : 1);
  const angle = -fighter.headAngle;
  ctx.save();
  ctx.translate(head.x, head.y);
  ctx.rotate(angle);
  const sx = 1 + squash * 0.25;
  const sy = 1 - squash * 0.25;
  ctx.scale(sx, sy);
  ctx.beginPath();
  ctx.fillStyle = ink;
  ctx.arc(0, 0, headR + outline, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.fillStyle = bone;
  ctx.arc(0, 0, headR, 0, Math.PI * 2);
  ctx.fill();
  if (hurt) {
    ctx.fillStyle = 'rgba(255, 90, 80, 0.35)';
    ctx.beginPath();
    ctx.arc(0, 0, headR, 0, Math.PI * 2);
    ctx.fill();
  }
  drawFace(ctx, fighter, juicy, headR, now);
  drawHat(ctx, fighter, juicy, headR);
  ctx.restore();

  tube(['shoulder', 'elbowF', 'wristF'], limb, bone);
  if (fighter.weapon) {
    const def = weaponById(fighter.weapon);
    const hand = pt('handF');
    const reach = (def?.reach || 0.8) * z * (def?.kind === 'hitscan' || def?.kind === 'projectile' ? 0.55 : 0.85);
    const end = { x: hand.x + fighter.facing * reach, y: hand.y - reach * 0.18 };
    stroke(ctx, [hand, end], Math.max(5, 0.07 * z) + outline * 2, ink);
    stroke(ctx, [hand, end], Math.max(5, 0.07 * z), def?.cls === 'firearm' ? '#d5dde8' : def?.cls === 'explosive' ? '#e07a45' : '#e7b15a');
  }
  ball(pt('handF'), 0.1 * z, bone);

  if (fighter.blocking) {
    ctx.strokeStyle = 'rgba(122, 215, 255, 0.45)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(head.x + fighter.facing * 12, head.y, headR + 12, -1.2, 1.2);
    ctx.stroke();
  }
  // Dizzy birdies/stars circling the head.
  const dizzy = fighter.dizzy ?? 0;
  if (dizzy > 0 || fighter.state === 'ko') {
    const n = 3;
    for (let i = 0; i < n; i += 1) {
      const a = now / 260 + (i * Math.PI * 2) / n;
      const px = head.x + Math.cos(a) * headR * 1.25;
      const py = head.y - headR * 1.25 + Math.sin(a) * headR * 0.35;
      drawStar(ctx, px, py, headR * 0.28, a * 2, i === 1 ? '#7ad7ff' : '#ffe14a', ink);
    }
  }
  ctx.restore();
}

function drawHat(ctx: CanvasRenderingContext2D, fighter: FighterSnapshot, juicy: Look, radius: number): void {
  if (fighter.hat === 'none' || fighter.hat === 'glasses') {
    if (fighter.hat === 'glasses') {
      ctx.strokeStyle = '#1a1210';
      ctx.lineWidth = Math.max(2, radius * 0.08);
      const f = fighter.facing;
      ctx.strokeRect(f * radius * 0.02 - radius * 0.1, -radius * 0.2, radius * 0.42, radius * 0.3);
      ctx.strokeRect(f * radius * 0.5 - radius * 0.2, -radius * 0.2, radius * 0.42, radius * 0.3);
    }
    return;
  }
  ctx.save();
  // Hats sit loose: they rock and hop on their own spring.
  ctx.translate(0, -radius * 0.55 - juicy.hatHop * radius);
  ctx.rotate(juicy.hat);
  ctx.strokeStyle = '#1a1210';
  ctx.lineWidth = Math.max(2, radius * 0.08);
  ctx.fillStyle = '#e7b15a';
  if (fighter.hat === 'cap' || fighter.hat === 'beanie') {
    ctx.fillStyle = fighter.hat === 'cap' ? '#ff5a36' : '#5ad0ff';
    ctx.beginPath();
    ctx.arc(0, radius * 0.2, radius * 0.92, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    if (fighter.hat === 'cap') {
      ctx.beginPath();
      ctx.rect(fighter.facing > 0 ? 0 : -radius * 1.4, radius * 0.08, radius * 1.4, radius * 0.2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.fillStyle = '#f4efe4';
      ctx.arc(0, -radius * 0.78, radius * 0.22, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  } else if (fighter.hat === 'crown') {
    ctx.beginPath();
    ctx.moveTo(-radius * 0.8, radius * 0.25);
    ctx.lineTo(-radius * 0.85, -radius * 0.55);
    ctx.lineTo(-radius * 0.4, -radius * 0.1);
    ctx.lineTo(0, -radius * 0.7);
    ctx.lineTo(radius * 0.4, -radius * 0.1);
    ctx.lineTo(radius * 0.85, -radius * 0.55);
    ctx.lineTo(radius * 0.8, radius * 0.25);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (fighter.hat === 'halo') {
    ctx.strokeStyle = '#ffe14a';
    ctx.lineWidth = Math.max(3, radius * 0.14);
    ctx.beginPath();
    ctx.ellipse(0, -radius * 0.55, radius * 0.7, radius * 0.2, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/** Face in head-local space (origin at head center, y down, facing along +x * facing). */
function drawFace(ctx: CanvasRenderingContext2D, fighter: FighterSnapshot, juicy: Look, r: number, now: number): void {
  const f = fighter.facing;
  const ink = '#1a1210';
  const eyeR = r * 0.3;
  const eyes = [
    { x: f * r * 0.12, y: -r * 0.12 },
    { x: f * r * 0.62, y: -r * 0.16 },
  ];
  const stun = fighter.stun ?? 0;
  const dizzy = fighter.dizzy ?? 0;
  const ko = fighter.state === 'ko';
  const down = fighter.state === 'fallen' || (fighter.state === 'getup' && dizzy > 0);
  const ouch = fighter.flash > 0.05 || stun > 0.15 || fighter.state === 'stumble';
  const angry = fighter.attack !== null || fighter.face === 'mad';
  ctx.lineWidth = Math.max(2, r * 0.09);
  ctx.strokeStyle = ink;

  if (ko) {
    for (const e of eyes) markX(ctx, e, eyeR * 0.7);
  } else if (down) {
    // Spiral eyes.
    for (const e of eyes) {
      ctx.beginPath();
      for (let i = 0; i < 26; i += 1) {
        const a = i * 0.55 + now / 90;
        const rr = (i / 26) * eyeR;
        const x = e.x + Math.cos(a) * rr;
        const y = e.y + Math.sin(a) * rr;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  } else if (ouch) {
    // Squeezed shut: > <
    for (const [i, e] of eyes.entries()) {
      const d = (i === 0 ? 1 : -1) * f;
      ctx.beginPath();
      ctx.moveTo(e.x - d * eyeR * 0.6, e.y - eyeR * 0.6);
      ctx.lineTo(e.x + d * eyeR * 0.5, e.y);
      ctx.lineTo(e.x - d * eyeR * 0.6, e.y + eyeR * 0.6);
      ctx.stroke();
    }
  } else if (fighter.face === 'shades') {
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.ellipse(eyes[0]!.x, eyes[0]!.y, eyeR * 1.1, eyeR * 0.75, 0, 0, Math.PI * 2);
    ctx.ellipse(eyes[1]!.x, eyes[1]!.y, eyeR * 1.1, eyeR * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();
    stroke(ctx, [eyes[0]!, eyes[1]!], Math.max(2, r * 0.08), ink);
  } else {
    // Googly eyes: big whites, pupils sloshing on a spring.
    for (const [i, e] of eyes.entries()) {
      const size = eyeR * (i === 0 ? 0.95 : 1.08);
      ctx.beginPath();
      ctx.fillStyle = '#ffffff';
      ctx.arc(e.x, e.y, size, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      const px = e.x + (juicy.eyeX + f * 0.18) * size;
      const py = e.y - juicy.eyeY * size;
      ctx.beginPath();
      ctx.fillStyle = ink;
      ctx.arc(px, py, size * 0.45, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (angry && !ko && !down) {
    ctx.beginPath();
    ctx.moveTo(eyes[0]!.x - f * eyeR, eyes[0]!.y - eyeR * 1.45);
    ctx.lineTo(eyes[0]!.x + f * eyeR * 0.8, eyes[0]!.y - eyeR * 0.95);
    ctx.moveTo(eyes[1]!.x + f * eyeR, eyes[1]!.y - eyeR * 1.5);
    ctx.lineTo(eyes[1]!.x - f * eyeR * 0.8, eyes[1]!.y - eyeR * 0.95);
    ctx.stroke();
  }

  // Mouth.
  const mx = f * r * 0.42;
  const my = r * 0.45;
  ctx.fillStyle = ink;
  if (ko) {
    // Tongue out.
    ctx.beginPath();
    ctx.ellipse(mx, my, r * 0.22, r * 0.1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ff7aa8';
    ctx.beginPath();
    ctx.ellipse(mx + f * r * 0.08, my + r * 0.14, r * 0.1, r * 0.14, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (ouch || down) {
    ctx.beginPath();
    ctx.ellipse(mx, my, r * 0.16, r * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (angry) {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.rect(mx - r * 0.25, my - r * 0.08, r * 0.5, r * 0.18);
    ctx.fill();
    ctx.stroke();
  } else {
    // A loose, slightly lopsided grin.
    ctx.beginPath();
    ctx.arc(mx, my - r * 0.12, r * 0.26, 0.35 + (f < 0 ? 0.25 : 0), Math.PI - 0.35 + (f > 0 ? -0.25 : 0));
    ctx.stroke();
  }
  // Blush when walking around tipsy.
  ctx.fillStyle = 'rgba(255, 110, 120, 0.35)';
  ctx.beginPath();
  ctx.ellipse(f * r * 0.62, r * 0.22, r * 0.16, r * 0.09, 0, 0, Math.PI * 2);
  ctx.fill();
}

function markX(ctx: CanvasRenderingContext2D, p: Vec2, r: number): void {
  ctx.beginPath();
  ctx.moveTo(p.x - r, p.y - r);
  ctx.lineTo(p.x + r, p.y + r);
  ctx.moveTo(p.x + r, p.y - r);
  ctx.lineTo(p.x - r, p.y + r);
  ctx.stroke();
}

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number, fill: string, ink: string): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const a = rot + (i * Math.PI) / 5 - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.45;
    const px = x + Math.cos(a) * rr;
    const py = y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = Math.max(1.5, r * 0.18);
  ctx.strokeStyle = ink;
  ctx.stroke();
}

function drawParticles(ctx: CanvasRenderingContext2D, cam: Camera, view: View): void {
  ctx.save();
  for (const p of juice.particles) {
    const at = screenPoint(cam, view, p);
    const alpha = clamp(p.life / p.max, 0, 1);
    ctx.globalAlpha = p.kind === 'dust' ? alpha * 0.55 : Math.min(1, alpha * 1.6);
    const r = p.size * cam.zoom;
    if (p.kind === 'star') drawStar(ctx, at.x, at.y, r, p.rot, p.color, '#1a1210');
    else if (p.kind === 'spark') {
      ctx.strokeStyle = p.color;
      ctx.lineWidth = Math.max(2, r * 0.4);
      ctx.beginPath();
      ctx.moveTo(at.x, at.y);
      ctx.lineTo(at.x - p.vx * 0.03 * cam.zoom, at.y + p.vy * 0.03 * cam.zoom);
      ctx.stroke();
    } else {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(at.x, at.y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

function shadeOf(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * 0.72);
  const g = Math.round(((n >> 8) & 255) * 0.72);
  const b = Math.round((n & 255) * 0.72);
  return `rgb(${r}, ${g}, ${b})`;
}

function lerpPt(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

const WORD_COLORS = ['#ffe14a', '#ff5a36', '#7ad7ff', '#8dff7a', '#ff7aa8'];

function drawEffect(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  view: View,
  effect: Snapshot['effects'][number],
): void {
  const p = screenPoint(cam, view, effect);
  const alpha = clamp(effect.life / effect.max, 0, 1);
  const age = 1 - alpha;
  ctx.save();
  if (effect.kind === 'text') {
    const word = /[A-Z]/.test(effect.text);
    if (!word) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#f3ecdf';
      ctx.font = '700 16px DejaVu Sans, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(effect.text, p.x, p.y);
      ctx.restore();
      return;
    }
    // Comic-book pop: overshoots in, wobbles, then fades.
    const pop = age < 0.18 ? easeOutBack(age / 0.18) : 1 + Math.sin(age * 30) * 0.03 * (1 - age);
    const size = clamp(18 + effect.mag * 0.9, 18, 40) * (cam.zoom / 100);
    const tilt = ((effect.id * 37) % 9 - 4) * 0.06;
    ctx.translate(p.x, p.y);
    ctx.rotate(tilt);
    ctx.scale(pop, pop);
    ctx.globalAlpha = Math.min(1, alpha * 2.2) * (age > 0.6 ? 0.8 : 1);
    const blocked = effect.text === 'BLOCK';
    if (!blocked) {
      ctx.save();
      ctx.rotate(-tilt * 2 + age);
      drawBurst(ctx, size * 1.15, effect.id);
      ctx.restore();
    }
    ctx.font = `900 ${size}px "Arial Black", Impact, "DejaVu Sans", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = size * 0.22;
    ctx.strokeStyle = '#1a1210';
    ctx.strokeText(effect.text, 0, 0);
    ctx.fillStyle = blocked ? '#7ad7ff' : WORD_COLORS[effect.id % WORD_COLORS.length] ?? '#ffe14a';
    ctx.fillText(effect.text, 0, 0);
  } else if (effect.kind === 'hit' || effect.kind === 'boom') {
    // Impact flash: white starburst that pops and shrinks.
    ctx.globalAlpha = alpha;
    ctx.translate(p.x, p.y);
    const r = (effect.kind === 'boom' ? 0.6 + effect.mag * 0.35 : 0.22 + effect.mag * 0.12) * cam.zoom * (0.6 + age * 0.8);
    ctx.fillStyle = effect.kind === 'boom' ? '#ffb15a' : '#ffffff';
    spikes(ctx, r, r * 0.45, 9, effect.id);
    ctx.fill();
  } else {
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = effect.kind === 'block' ? '#7ad7ff' : '#e7b15a';
    ctx.lineWidth = 3;
    const r = (0.15 + age * 0.35) * cam.zoom;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBurst(ctx: CanvasRenderingContext2D, size: number, seed: number): void {
  ctx.fillStyle = '#1a1210';
  spikes(ctx, size * 1.55, size * 0.95, 12, seed);
  ctx.fill();
  ctx.fillStyle = '#fff6c4';
  spikes(ctx, size * 1.4, size * 0.85, 12, seed);
  ctx.fill();
}

function spikes(ctx: CanvasRenderingContext2D, outer: number, inner: number, n: number, seed: number): void {
  ctx.beginPath();
  for (let i = 0; i < n * 2; i += 1) {
    const a = (i * Math.PI) / n;
    const wob = 1 + (((seed * 13 + i * 7) % 5) - 2) * 0.06;
    const r = (i % 2 === 0 ? outer * wob : inner) * (i % 2 === 0 ? 1 : 1);
    const x = Math.cos(a) * r * 1.25;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function easeOutBack(t: number): number {
  const c1 = 2.2;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
}

function drawDebug(ctx: CanvasRenderingContext2D, cam: Camera, view: View, snap: Snapshot): void {
  ctx.save();
  ctx.globalAlpha = 0.45;
  for (const fighter of snap.fighters) {
    ctx.strokeStyle = fighter.id === 'player' ? '#7ad7ff' : '#ff5a36';
    for (const part of fighter.parts) {
      if (part.shape === 'circle') {
        const p = screenPoint(cam, view, part);
        ctx.beginPath();
        ctx.arc(p.x, p.y, part.hx * cam.zoom, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const c = Math.cos(part.angle);
        const s = Math.sin(part.angle);
        const corners = [
          [-part.hx, -part.hy],
          [part.hx, -part.hy],
          [part.hx, part.hy],
          [-part.hx, part.hy],
        ].map(([lx, ly]) => screenPoint(cam, view, { x: part.x + c * lx - s * ly, y: part.y + s * lx + c * ly }));
        ctx.beginPath();
        const first = corners[0];
        if (!first) continue;
        ctx.moveTo(first.x, first.y);
        for (const corner of corners.slice(1)) ctx.lineTo(corner.x, corner.y);
        ctx.closePath();
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}

function stroke(ctx: CanvasRenderingContext2D, points: Vec2[], width: number, color: string): void {
  const first = points[0];
  if (!first) return;
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.moveTo(first.x, first.y);
  for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.stroke();
}

function dot(ctx: CanvasRenderingContext2D, p: Vec2, radius: number, fill: string, ink: string, outline = 2): void {
  ctx.beginPath();
  ctx.fillStyle = ink;
  ctx.arc(p.x, p.y, radius + outline, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.fillStyle = fill;
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function lerpFighter(a: FighterSnapshot, b: FighterSnapshot, t: number): FighterSnapshot {
  const ta = a.parts.find((part) => part.part === 'torso');
  const tb = b.parts.find((part) => part.part === 'torso');
  // Respawns and teleports should cut, not smear across the arena.
  if (!ta || !tb || Math.hypot(ta.x - tb.x, ta.y - tb.y) > 2.5) return b;
  const byName = new Map(a.parts.map((part) => [part.part, part]));
  const parts = b.parts.map((part) => {
    const prev = byName.get(part.part) ?? part;
    return {
      ...part,
      x: lerp(prev.x, part.x, t),
      y: lerp(prev.y, part.y, t),
      angle: lerpAngle(prev.angle, part.angle, t),
    };
  });
  return {
    ...b,
    vx: lerp(a.vx, b.vx, t),
    vy: lerp(a.vy, b.vy, t),
    headAngle: lerpAngle(a.headAngle, b.headAngle, t),
    parts,
    points: pointsFromParts(parts, b.points),
  };
}

/**
 * Rebuild joint points from interpolated bone transforms. Lerping each point on its own
 * shrinks spinning limbs mid-interpolation; rotating rigid bones keeps every bone its length.
 */
function pointsFromParts(parts: FighterSnapshot['parts'], fallback: FighterSnapshot['points']): FighterSnapshot['points'] {
  const map = new Map(parts.map((part) => [part.part, part]));
  const at = (name: FighterSnapshot['parts'][number]['part'], lx: number, ly: number, fb: Vec2): Vec2 => {
    const part = map.get(name);
    if (!part) return fb;
    const c = Math.cos(part.angle);
    const s = Math.sin(part.angle);
    return { x: part.x + c * lx - s * ly, y: part.y + s * lx + c * ly };
  };
  const hy = (name: FighterSnapshot['parts'][number]['part']) => map.get(name)?.hy ?? 0;
  const hx = (name: FighterSnapshot['parts'][number]['part']) => map.get(name)?.hx ?? 0;
  return {
    head: at('head', 0, 0, fallback.head),
    neck: at('torso', 0, hy('torso'), fallback.neck),
    shoulder: at('torso', 0, hy('torso') * 0.5, fallback.shoulder),
    hip: at('torso', 0, -hy('torso'), fallback.hip),
    elbowF: at('upperArmF', 0, -hy('upperArmF'), fallback.elbowF),
    wristF: at('lowerArmF', 0, -hy('lowerArmF'), fallback.wristF),
    handF: at('handF', 0, 0, fallback.handF),
    elbowB: at('upperArmB', 0, -hy('upperArmB'), fallback.elbowB),
    wristB: at('lowerArmB', 0, -hy('lowerArmB'), fallback.wristB),
    handB: at('handB', 0, 0, fallback.handB),
    kneeF: at('upperLegF', 0, -hy('upperLegF'), fallback.kneeF),
    ankleF: at('lowerLegF', 0, -hy('lowerLegF'), fallback.ankleF),
    heelF: at('footF', -hx('footF') * 0.92, 0, fallback.heelF),
    toeF: at('footF', hx('footF') * 0.92, 0, fallback.toeF),
    kneeB: at('upperLegB', 0, -hy('upperLegB'), fallback.kneeB),
    ankleB: at('lowerLegB', 0, -hy('lowerLegB'), fallback.ankleB),
    heelB: at('footB', -hx('footB') * 0.92, 0, fallback.heelB),
    toeB: at('footB', hx('footB') * 0.92, 0, fallback.toeB),
  };
}
