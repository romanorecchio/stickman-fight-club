export function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function normalizeAngle(a: number): number {
  let x = (a + Math.PI) % (Math.PI * 2);
  if (x < 0) x += Math.PI * 2;
  return x - Math.PI;
}

export function dampAngle(current: number, target: number, rate: number, dt: number): number {
  const k = 1 - Math.exp(-rate * dt);
  return normalizeAngle(current + normalizeAngle(target - current) * k);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpAngle(a: number, b: number, t: number): number {
  return normalizeAngle(a + normalizeAngle(b - a) * t);
}
