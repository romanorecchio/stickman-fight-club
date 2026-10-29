import type { InputFrame, Vec2 } from '@sfc/shared';

const holds = {
  left: false,
  right: false,
  jump: false,
  crouch: false,
  sprint: false,
  punch: false,
  kick: false,
  block: false,
  grab: false,
  throw: false,
};

const keys = new Set<string>();
let pointerX = 0;
let pointerY = 0;
let pointerReady = false;

export function installInput(canvas: HTMLCanvasElement): void {
  window.addEventListener('keydown', (event) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
    keys.add(event.code);
  });
  window.addEventListener('keyup', (event) => {
    keys.delete(event.code);
  });
  window.addEventListener('blur', () => keys.clear());
  canvas.addEventListener('contextmenu', (event) => event.preventDefault());
  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId);
    if (event.button === 0) holds.punch = true;
    if (event.button === 2) holds.block = true;
    point(canvas, event);
  });
  canvas.addEventListener('pointerup', (event) => {
    if (event.button === 0) holds.punch = false;
    if (event.button === 2) holds.block = false;
  });
  canvas.addEventListener('pointermove', (event) => point(canvas, event));
  window.addEventListener('pointerup', (event) => {
    if (event.button === 0) holds.punch = false;
    if (event.button === 2) holds.block = false;
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>('#touch button')) {
    const name = button.dataset.hold as keyof typeof holds | undefined;
    if (!name) continue;
    const down = (event: Event) => {
      event.preventDefault();
      holds[name] = true;
    };
    const up = () => {
      holds[name] = false;
    };
    button.addEventListener('pointerdown', down);
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    button.addEventListener('pointerleave', up);
  }
}

function point(canvas: HTMLCanvasElement, event: PointerEvent): void {
  const rect = canvas.getBoundingClientRect();
  pointerX = event.clientX - rect.left;
  pointerY = event.clientY - rect.top;
  pointerReady = true;
}

export function pointer(): { x: number; y: number; ready: boolean } {
  return { x: pointerX, y: pointerY, ready: pointerReady };
}

export function consumePress(code: string): boolean {
  if (!keys.has(code)) return false;
  keys.delete(code);
  return true;
}

export function buildInput(seq: number, aim: Vec2): InputFrame {
  const left = keys.has('KeyA') || keys.has('ArrowLeft') || holds.left;
  const right = keys.has('KeyD') || keys.has('ArrowRight') || holds.right;
  let moveX = 0;
  if (left) moveX -= 1;
  if (right) moveX += 1;
  return {
    seq,
    moveX,
    jump: keys.has('KeyW') || keys.has('ArrowUp') || holds.jump,
    crouch: keys.has('KeyS') || keys.has('ArrowDown') || holds.crouch,
    sprint: keys.has('ShiftLeft') || keys.has('ShiftRight') || holds.sprint,
    punch: holds.punch,
    kick: keys.has('Space') || holds.kick,
    block: holds.block,
    grab: keys.has('KeyE') || holds.grab,
    throw: keys.has('KeyQ') || holds.throw,
    reload: consumePress('KeyR'),
    pickup: consumePress('KeyF'),
    drop: consumePress('KeyG'),
    aimX: aim.x,
    aimY: aim.y,
  };
}
