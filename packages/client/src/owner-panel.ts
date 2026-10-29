import type { OnlineSession } from './net.js';

interface EffectRow {
  id: string;
  name: string;
  tab: string;
}

let panel: HTMLElement | null = null;
let unlocked = false;

export function openPanel(session: OnlineSession, effects: EffectRow[]): void {
  if (panel) {
    panel.hidden = false;
    return;
  }
  panel = document.createElement('section');
  panel.id = 'owner-panel';
  panel.innerHTML = `
    <header><strong>Owner</strong><button type="button" data-close>Close</button></header>
    <form data-code>
      <label>Code <input name="code" type="password" autocomplete="off" /></label>
      <button type="submit">Unlock</button>
      <p data-msg></p>
    </form>
    <div data-tools hidden>
      <div data-tabs></div>
      <div data-list></div>
      <label>Seconds <input data-seconds type="number" min="1" max="15" value="4" /></label>
      <label>Intensity <input data-intensity type="number" min="10" max="100" value="70" /></label>
      <label>Targets <input data-targets value="all" /></label>
      <button type="button" data-reset>RESET ALL</button>
    </div>
  `;
  document.body.append(panel);
  const style = document.createElement('style');
  style.textContent = `
    #owner-panel { position: fixed; right: 16px; bottom: 16px; z-index: 6; width: min(360px, calc(100% - 24px)); background: #100608; color: #f3ecdf; border: 1px solid #ff5d3a; padding: 12px; display: grid; gap: 8px; font: 14px "DejaVu Sans", sans-serif; }
    #owner-panel[hidden], #owner-panel [hidden] { display: none; }
    #owner-panel header, #owner-panel form, #owner-panel [data-tools] { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    #owner-panel button, #owner-panel input { font: inherit; background: #1a0c10; color: inherit; border: 1px solid #ff5d3a; padding: 4px 8px; }
    #owner-panel [data-list] { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; max-height: 40vh; overflow: auto; }
  `;
  document.head.append(style);
  panel.querySelector('[data-close]')?.addEventListener('click', () => {
    if (panel) panel.hidden = true;
  });
  panel.querySelector('[data-code]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const code = new FormData(event.target as HTMLFormElement).get('code');
    session.emit('gate-code', { account: localStorage.getItem('sfc-account'), code });
  });
  session.listen('gate-code', (body) => {
    const msg = panel?.querySelector('[data-msg]');
    const result = body as { ok?: boolean; error?: string };
    if (result.ok) {
      unlocked = true;
      const tools = panel?.querySelector<HTMLElement>('[data-tools]');
      const form = panel?.querySelector<HTMLElement>('[data-code]');
      if (tools) tools.hidden = false;
      if (form) form.hidden = true;
    } else if (msg) msg.textContent = result.error ?? '';
  });
  const tabs = [...new Set(effects.map((effect) => effect.tab))];
  const tabBar = panel.querySelector('[data-tabs]');
  const list = panel.querySelector('[data-list]');
  let current = tabs[0] ?? '';
  const draw = () => {
    if (!list) return;
    list.replaceChildren();
    for (const effect of effects.filter((item) => item.tab === current)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = effect.name;
      button.addEventListener('click', () => {
        if (!unlocked) return;
        const send = (image?: string) => {
          const seconds = Number(panel?.querySelector<HTMLInputElement>('[data-seconds]')?.value ?? 4);
          const intensity = Number(panel?.querySelector<HTMLInputElement>('[data-intensity]')?.value ?? 70);
          const who = panel?.querySelector<HTMLInputElement>('[data-targets]')?.value ?? 'all';
          const targets = who.trim() === 'all' ? 'all' : who.split(',').map((id) => id.trim()).filter(Boolean);
          session.emit('chaos', {
            account: localStorage.getItem('sfc-account'),
            effect: effect.id,
            duration: seconds,
            intensity,
            targets,
            image,
          });
        };
        if (effect.id !== 'custom') {
          send();
          return;
        }
        const picker = document.createElement('input');
        picker.type = 'file';
        picker.accept = 'image/png,image/jpeg';
        picker.addEventListener('change', () => {
          const file = picker.files?.[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            if (typeof reader.result === 'string') send(reader.result);
          };
          reader.readAsDataURL(file);
        });
        picker.click();
      });
      list.append(button);
    }
  };
  for (const tab of tabs) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = tab;
    button.addEventListener('click', () => {
      current = tab;
      draw();
    });
    tabBar?.append(button);
  }
  draw();
  panel.querySelector('[data-reset]')?.addEventListener('click', () => {
    session.emit('chaos-reset', { account: localStorage.getItem('sfc-account') });
  });
}
