import type { PrivateFx } from '@sfc/shared';
import { isMuted, thud } from './audio.js';

let root: HTMLElement | null = null;
let current: string | null = null;
let onDismiss: (() => void) | null = null;

function ensure(): HTMLElement {
  if (root) return root;
  root = document.createElement('div');
  root.id = 'scare';
  root.hidden = true;
  document.body.append(root);
  window.addEventListener('keydown', (event) => {
    if (event.code !== 'Escape' || root?.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    hideScare();
    onDismiss?.();
  });
  return root;
}

export function hideScare(): void {
  current = null;
  if (root) root.hidden = true;
}

export function showScare(fx: PrivateFx, dismiss: () => void): void {
  const node = ensure();
  onDismiss = dismiss;
  const kind = fx.jumpscare;
  if (!kind) {
    hideScare();
    return;
  }
  if (current === kind) return;
  current = kind;
  node.hidden = false;
  node.replaceChildren();
  const card = document.createElement('div');
  card.className = 'scare-card';
  if (kind === 'crash') {
    card.innerHTML = '<p class="scare-kicker">STICKMAN FIGHT CLUB</p><h2>RING MALFUNCTION</h2><p>The ropes slipped. This is a game graphic. Esc closes it.</p>';
  } else if (kind === 'goofy') {
    card.innerHTML = '<p class="scare-face" aria-hidden="true">(⊙‿⊙)</p><h2>BOO</h2><p>Esc closes it.</p>';
  } else if (kind === 'custom' && fx.customImage) {
    const img = document.createElement('img');
    img.alt = '';
    img.src = fx.customImage;
    card.append(img);
  } else {
    card.innerHTML = '<p class="scare-face" aria-hidden="true">◉‿◉</p><h2>BEHIND YOU</h2><p>Esc closes it.</p>';
  }
  if (fx.reduceFlash) card.style.background = '#1a1014';
  node.append(card);
  if (!isMuted() && !fx.reduceMotion) thud(kind === 'goofy' ? 180 : 70, 0.18, 0.08);
}

const style = document.createElement('style');
style.textContent = `
#scare { position: fixed; inset: 0; z-index: 2; display: grid; place-items: center; background: rgba(12, 0, 0, 0.55); }
#scare[hidden] { display: none; }
.scare-card { width: min(440px, 80vw); padding: 28px; background: #14080c; color: #f3ecdf; border: 4px solid #e7b15a; text-align: center; font-family: "DejaVu Sans", sans-serif; }
.scare-card h2 { margin: 8px 0; letter-spacing: 0.08em; }
.scare-kicker { letter-spacing: 0.16em; color: #e7b15a; }
.scare-face { font-size: 4rem; margin: 0; }
.scare-card img { max-width: 100%; max-height: 50vh; }
#hud { z-index: 3; }
`;
document.head.append(style);
