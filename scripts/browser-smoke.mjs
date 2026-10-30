// Real-browser smoke test: create a lobby on one page, join it by code from a second page, start a match.
// Usage: node scripts/browser-smoke.mjs [baseUrl] [screenshotDir]
//   No baseUrl: builds must exist; starts the local server on a free port with the built client.
//   CHROME_PATH overrides the browser (default: /usr/bin/google-chrome, else Playwright's bundled Chromium).
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let base = process.argv[2];
const shots = process.argv[3];
let server = null;

function fail(message) {
  throw new Error(message);
}

async function startLocal() {
  const port = 4500 + Math.floor(Math.random() * 400);
  server = spawn(process.execPath, ['packages/server/dist/index.js'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), STATIC_DIR: 'packages/client/dist' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      if (res.ok) return `http://127.0.0.1:${port}/`;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  fail('local server did not start');
}

function watch(page, label, errors) {
  page.on('pageerror', (e) => errors.push(`${label} pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`${label} console.error: ${m.text()}`);
  });
}

async function main() {
  if (!base) base = await startLocal();
  const executablePath = process.env.CHROME_PATH || (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  const errors = [];
  try {
    const host = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    const guest = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    watch(host, 'host', errors);
    watch(guest, 'guest', errors);

    const res = await host.goto(base, { waitUntil: 'load' });
    const cache = res?.headers()['cache-control'] ?? '';
    if (!/no-cache|no-store|max-age=0/.test(cache)) fail(`index.html Cache-Control should revalidate, got "${cache}"`);
    const prefilled = await host.inputValue('#name');
    if (!prefilled.trim()) fail('Name field was not prefilled');
    console.log(`host prefilled name: ${prefilled}`);

    // Blank name must still work: a random one is filled in.
    await host.fill('#name', '');
    await host.click('#create-btn');
    await host.waitForFunction(() => /^[A-Z0-9]{6}$/.test(document.querySelector('#room-code')?.textContent ?? ''), null, { timeout: 30000 });
    const code = (await host.textContent('#room-code')) ?? '';
    const hostName = await host.inputValue('#name');
    if (!hostName.trim()) fail('blank name was not auto-filled');
    console.log(`host created room ${code} as ${hostName}`);

    // Bad code shows a visible error instead of failing silently.
    await guest.goto(base, { waitUntil: 'load' });
    await guest.fill('#code', 'ZZZZZZ');
    await guest.click('#join-btn');
    await guest.waitForFunction(() => {
      const el = document.querySelector('#gate-error');
      return el && !el.hidden && /not found/i.test(el.textContent ?? '');
    }, null, { timeout: 30000 });
    console.log(`bad code error: ${await guest.textContent('#gate-error')}`);

    await guest.fill('#name', 'SmokeGuest');
    await guest.fill('#code', code.toLowerCase());
    await guest.click('#join-btn');
    await guest.waitForFunction((c) => document.querySelector('#room-code')?.textContent === c, code, { timeout: 30000 });
    for (const [label, page] of [['host', host], ['guest', guest]]) {
      await page.waitForFunction(() => document.querySelectorAll('#lobby-list li').length === 2, null, { timeout: 15000 });
      const visible = await page.$eval('#lobby-card', (el) => !el.hidden);
      if (!visible) fail(`${label} lobby card hidden`);
      console.log(`${label} lobby: ${(await page.$$eval('#lobby-list li', (els) => els.map((e) => e.textContent))).join(' | ')}`);
    }

    await host.click('#start-match');
    await host.waitForFunction(() => {
      const net = window.__SFC__?.getNet();
      return Boolean(net?.latest?.match && net.latest.match.phase !== 'lobby');
    }, null, { timeout: 15000 });
    await guest.waitForFunction(() => Boolean(window.__SFC__?.getNet()?.latest?.match), null, { timeout: 15000 });
    console.log(`match started: phase=${await host.evaluate(() => window.__SFC__.getNet().latest.match.phase)}`);
    await host.waitForTimeout(1500);

    if (shots) {
      mkdirSync(shots, { recursive: true });
      await host.screenshot({ path: path.join(shots, 'host.png') });
      await guest.screenshot({ path: path.join(shots, 'guest.png') });
      console.log(`screenshots: ${path.join(shots, 'host.png')} ${path.join(shots, 'guest.png')}`);
    }
    const real = errors.filter((e) => !/favicon/i.test(e));
    if (real.length) fail(`browser errors:\n${real.join('\n')}`);
    console.log('browser smoke ok');
  } finally {
    await browser.close();
    server?.kill();
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  server?.kill();
  process.exit(1);
});
