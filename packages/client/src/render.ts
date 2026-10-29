import {
  clamp,
  lerp,
  lerpAngle,
  type FighterSnapshot,
  type PointName,
  type Snapshot,
  type Vec2,
} from '@sfc/shared';

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
  cam.x += (targetX - cam.x) * k;
  cam.y += (targetY - cam.y) * k;
  const halfW = view.width / 2 / cam.zoom;
  const halfH = view.height / 2 / cam.zoom;
  const bounds = snap.bounds;
  if (bounds.maxX - bounds.minX > halfW * 2) cam.x = clamp(cam.x, bounds.minX + halfW, bounds.maxX - halfW);
  if (bounds.maxY - bounds.minY > halfH * 2) cam.y = clamp(cam.y, bounds.minY + halfH * 0.35, bounds.maxY - halfH);
  if (shakeEnabled && player.flash > 0.04) cam.shake = Math.min(1, cam.shake + player.flash * 0.85);
  cam.shake *= Math.exp(-6 * dt);
  cam.ox = (Math.random() - 0.5) * cam.shake * 14;
  cam.oy = (Math.random() - 0.5) * cam.shake * 10;
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
  return {
    ...b,
    fighters: b.fighters.map((fighter, index) => lerpFighter(a.fighters[index] ?? fighter, fighter, t)),
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
  drawBackdrop(ctx, cam, view, now);
  for (const solid of snap.solids) drawSolid(ctx, cam, view, solid);
  for (const fighter of snap.fighters) drawShadow(ctx, cam, view, fighter);
  for (const fighter of snap.fighters) drawFighter(ctx, cam, view, fighter, false);
  for (const fighter of snap.fighters) drawFighter(ctx, cam, view, fighter, true);
  for (const effect of snap.effects) drawEffect(ctx, cam, view, effect);
  if (debug) drawDebug(ctx, cam, view, snap);
}

function drawBackdrop(ctx: CanvasRenderingContext2D, cam: Camera, view: View, now: number): void {
  const sky = ctx.createLinearGradient(0, 0, 0, view.height);
  sky.addColorStop(0, '#2a1a22');
  sky.addColorStop(0.45, '#1a1218');
  sky.addColorStop(1, '#100d10');
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

function drawFighter(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  view: View,
  fighter: FighterSnapshot,
  front: boolean,
): void {
  const look = PALETTE[fighter.color % PALETTE.length] ?? PALETTE[0];
  const pt = (name: PointName) => screenPoint(cam, view, fighter.points[name]);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = fighter.protecting ? 0.55 + 0.45 * Math.sin(performance.now() / 80) : front ? 1 : 0.72;
  const width = (front ? 0.075 : 0.06) * cam.zoom;
  const bone = fighter.flash > 0.02 ? '#fff4ea' : look.bone;
  if (!front) {
    stroke(ctx, [pt('shoulder'), pt('elbowB'), pt('wristB')], width + 5, look.ink);
    stroke(ctx, [pt('shoulder'), pt('elbowB'), pt('wristB')], width, bone);
    stroke(ctx, [pt('hip'), pt('kneeB'), pt('ankleB')], width + 5, look.ink);
    stroke(ctx, [pt('hip'), pt('kneeB'), pt('ankleB')], width, bone);
    stroke(ctx, [pt('heelB'), pt('toeB')], width + 3, look.ink);
    stroke(ctx, [pt('heelB'), pt('toeB')], width * 0.8, bone);
    dot(ctx, pt('handB'), 0.055 * cam.zoom, bone, look.ink);
  } else {
    stroke(ctx, [pt('hip'), pt('neck')], width + 7, look.ink);
    stroke(ctx, [pt('hip'), pt('neck')], width + 2, bone);
    const head = pt('head');
    const headR = 0.155 * cam.zoom;
    ctx.beginPath();
    ctx.fillStyle = look.ink;
    ctx.arc(head.x, head.y, headR + 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.fillStyle = bone;
    ctx.arc(head.x, head.y, headR, 0, Math.PI * 2);
    ctx.fill();
    drawFace(ctx, fighter, head, headR);
    stroke(ctx, [pt('shoulder'), pt('elbowF'), pt('wristF')], width + 6, look.ink);
    stroke(ctx, [pt('shoulder'), pt('elbowF'), pt('wristF')], width + 1, bone);
    stroke(ctx, [pt('hip'), pt('kneeF'), pt('ankleF')], width + 6, look.ink);
    stroke(ctx, [pt('hip'), pt('kneeF'), pt('ankleF')], width + 1, bone);
    stroke(ctx, [pt('heelF'), pt('toeF')], width + 4, look.ink);
    stroke(ctx, [pt('heelF'), pt('toeF')], width, bone);
    dot(ctx, pt('handF'), 0.062 * cam.zoom, bone, look.ink);
    for (const name of ['shoulder', 'elbowF', 'wristF', 'hip', 'kneeF', 'ankleF'] as const) {
      dot(ctx, pt(name), 0.038 * cam.zoom, look.joint, look.ink);
    }
    if (fighter.blocking) {
      ctx.strokeStyle = 'rgba(122, 215, 255, 0.35)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(head.x + fighter.facing * 10, head.y, headR + 10, -1.2, 1.2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawFace(ctx: CanvasRenderingContext2D, fighter: FighterSnapshot, head: Vec2, radius: number): void {
  const c = Math.cos(fighter.headAngle);
  const s = Math.sin(fighter.headAngle);
  const local = (x: number, y: number): Vec2 => ({
    x: head.x + (c * x - s * y) * radius,
    y: head.y - (s * x + c * y) * radius,
  });
  const eye = local(fighter.facing * 0.28, 0.12);
  ctx.fillStyle = '#1a1210';
  if (fighter.state === 'ko' || fighter.state === 'fallen') {
    ctx.strokeStyle = '#1a1210';
    ctx.lineWidth = 2;
    markX(ctx, eye, radius * 0.16);
  } else {
    ctx.beginPath();
    ctx.arc(eye.x, eye.y, Math.max(2, radius * 0.12), 0, Math.PI * 2);
    ctx.fill();
    const pupil = local(fighter.facing * 0.36, 0.12);
    ctx.fillStyle = '#f4efe4';
    ctx.beginPath();
    ctx.arc(pupil.x, pupil.y, Math.max(1, radius * 0.045), 0, Math.PI * 2);
    ctx.fill();
  }
}

function markX(ctx: CanvasRenderingContext2D, p: Vec2, r: number): void {
  ctx.beginPath();
  ctx.moveTo(p.x - r, p.y - r);
  ctx.lineTo(p.x + r, p.y + r);
  ctx.moveTo(p.x + r, p.y - r);
  ctx.lineTo(p.x - r, p.y + r);
  ctx.stroke();
}

function drawEffect(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  view: View,
  effect: Snapshot['effects'][number],
): void {
  const p = screenPoint(cam, view, effect);
  const alpha = clamp(effect.life / effect.max, 0, 1);
  ctx.save();
  ctx.globalAlpha = alpha;
  if (effect.kind === 'text') {
    ctx.fillStyle = effect.text === 'BLOCK' ? '#7ad7ff' : '#f3ecdf';
    ctx.font = '700 16px DejaVu Sans, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(effect.text, p.x, p.y);
  } else {
    ctx.strokeStyle = effect.kind === 'block' ? '#7ad7ff' : effect.kind === 'throw' ? '#e7b15a' : '#fff';
    ctx.lineWidth = 2;
    const r = (0.12 + (1 - alpha) * 0.28) * cam.zoom;
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
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

function dot(ctx: CanvasRenderingContext2D, p: Vec2, radius: number, fill: string, ink: string): void {
  ctx.beginPath();
  ctx.fillStyle = ink;
  ctx.arc(p.x, p.y, radius + 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.fillStyle = fill;
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function lerpFighter(a: FighterSnapshot, b: FighterSnapshot, t: number): FighterSnapshot {
  const points = { ...b.points };
  for (const name of Object.keys(b.points) as PointName[]) {
    const pa = a.points[name] ?? b.points[name];
    const pb = b.points[name];
    points[name] = { x: lerp(pa.x, pb.x, t), y: lerp(pa.y, pb.y, t) };
  }
  return {
    ...b,
    headAngle: lerpAngle(a.headAngle, b.headAngle, t),
    parts: b.parts.map((part, index) => {
      const prev = a.parts[index] ?? part;
      return {
        ...part,
        x: lerp(prev.x, part.x, t),
        y: lerp(prev.y, part.y, t),
        angle: lerpAngle(prev.angle, part.angle, t),
      };
    }),
    points,
  };
}
