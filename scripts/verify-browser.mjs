import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const out = '/tmp/sfc-verify';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});

await page.goto('http://127.0.0.1:4317/', { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__SFC__ && window.__SFC__.getProbe('player').y > 0);
await page.waitForTimeout(600);
await page.screenshot({ path: path.join(out, '01-idle.png') });

const start = await page.evaluate(() => window.__SFC__.getProbe('player'));
await page.keyboard.down('d');
await page.waitForTimeout(900);
const walked = await page.evaluate(() => window.__SFC__.getProbe('player'));
await page.keyboard.up('d');
await page.screenshot({ path: path.join(out, '02-walk.png') });

await page.keyboard.down('w');
let peakY = walked.y;
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(40);
  const y = await page.evaluate(() => window.__SFC__.getProbe('player').y);
  peakY = Math.max(peakY, y);
}
await page.keyboard.up('w');
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(out, '03-jump.png') });

await page.mouse.move(1040, 340);
await page.keyboard.down('d');
const approachDeadline = Date.now() + 3500;
let gap = 99;
while (Date.now() < approachDeadline) {
  gap = await page.evaluate(() => {
    const player = window.__SFC__.getProbe('player');
    const dummy = window.__SFC__.getProbe('dummy');
    return dummy.x - player.x;
  });
  if (gap < 0.95) break;
  await page.waitForTimeout(50);
}
await page.keyboard.up('d');
await page.mouse.down();
let minHp = 100;
let peakSpeed = 0;
let knockedDummy = false;
for (let i = 0; i < 20; i++) {
  await page.waitForTimeout(80);
  const dummy = await page.evaluate(() => window.__SFC__.getProbe('dummy'));
  minHp = Math.min(minHp, dummy.hp);
  peakSpeed = Math.max(peakSpeed, Math.hypot(dummy.vx, dummy.vy));
  if (dummy.state === 'fallen' || dummy.state === 'getup' || Math.abs(dummy.angle) > 0.9) knockedDummy = true;
}
await page.screenshot({ path: path.join(out, '04-punch.png') });
await page.mouse.up();

await page.evaluate(() => window.__SFC__.debugImpulse('player', 5, 3, 10));
let playerFell = false;
for (let i = 0; i < 15; i++) {
  await page.waitForTimeout(40);
  const player = await page.evaluate(() => window.__SFC__.getProbe('player'));
  if (player.state === 'fallen' || player.state === 'getup' || Math.abs(player.angle) > 0.9) playerFell = true;
}
await page.screenshot({ path: path.join(out, '05-down.png') });
let recovered = false;
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(100);
  const player = await page.evaluate(() => window.__SFC__.getProbe('player'));
  if (playerFell && Math.abs(player.angle) < 0.5 && player.hipY > 0.62 && !['fallen', 'ko', 'getup'].includes(player.state)) {
    recovered = true;
    break;
  }
}
await page.screenshot({ path: path.join(out, '06-recovered.png') });

await page.waitForTimeout(2000);
const stability = await page.evaluate(() => window.__SFC__.getStability());
const endPlayer = await page.evaluate(() => window.__SFC__.getProbe('player'));
await page.screenshot({ path: path.join(out, '07-end.png') });

const report = {
  errors,
  moved: walked.x - start.x,
  jumpRise: peakY - walked.y,
  gap,
  minHp,
  peakSpeed,
  knockedDummy,
  playerFell,
  recovered,
  stability,
  endPlayer,
};
console.log(JSON.stringify(report, null, 2));
const ok =
  errors.length === 0 &&
  report.moved > 0.6 &&
  report.jumpRise > 0.35 &&
  (report.minHp < 96 || report.knockedDummy || report.peakSpeed > 1.2) &&
  report.playerFell &&
  report.recovered &&
  stability.nanEvents === 0 &&
  stability.rescueEvents === 0 &&
  Number.isFinite(endPlayer.x);
if (!ok) process.exit(1);
await browser.close();
