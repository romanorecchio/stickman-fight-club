import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const base = process.env.SFC_URL ?? 'http://127.0.0.1:4318';
const out = '/tmp/sfc-multi';
await mkdir(out, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
});

const errors = [];
function watch(page, name) {
  page.on('pageerror', (error) => errors.push(`${name}: ${error}`));
}

async function openClient(name) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 700 } });
  const page = await context.newPage();
  watch(page, name);
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.fill('#name', name);
  return page;
}

async function latency(page, ms) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: ms,
    downloadThroughput: -1,
    uploadThroughput: -1,
  });
}

const host = await openClient('Ada');
await host.click('#create-btn');
await host.waitForFunction(() => window.__SFC__.getMode() === 'online' && window.__SFC__.getNet().lobby);
const code = await host.locator('#room-code').innerText();
if (!/^[A-Z0-9]{6}$/.test(code)) throw new Error(`bad code ${code}`);

const guest = await openClient('Bea');
await guest.fill('#code', code);
await guest.click('#join-btn');
await guest.waitForFunction(() => window.__SFC__.getMode() === 'online');

await host.screenshot({ path: path.join(out, 'host-joined.png') });
await guest.screenshot({ path: path.join(out, 'guest-joined.png') });

const bad = await openClient('Nope');
await bad.fill('#code', 'ZZZZZZ');
await bad.click('#join-btn');
await bad.waitForSelector('#gate-error:not([hidden])');
const badText = await bad.locator('#gate-error').innerText();
if (!/no lobby/i.test(badText)) throw new Error(`unexpected bad-code text: ${badText}`);

const places = await host.evaluate(() => {
  const snap = window.__SFC__.getNet().latest;
  const me = window.__SFC__.getNet().localId;
  return {
    me,
    xs: Object.fromEntries((snap?.fighters ?? []).map((fighter) => [fighter.id, fighter.points.hip.x])),
  };
});
const guestId = await guest.evaluate(() => window.__SFC__.getNet().localId);
const hostDir = (places.xs[guestId] ?? 0) >= (places.xs[places.me] ?? 0) ? 'd' : 'a';
const guestDir = hostDir === 'd' ? 'a' : 'd';

async function fight(page, key) {
  await page.bringToFront();
  await page.locator('#view').click({ position: { x: 700, y: 280 } });
  await page.keyboard.down('Shift');
  await page.keyboard.down(key);
  await page.mouse.down();
  await page.keyboard.down(' ');
}

await fight(host, hostDir);
await fight(guest, guestDir);
await host.waitForTimeout(3200);
for (const page of [host, guest]) {
  await page.keyboard.up('d');
  await page.keyboard.up('a');
  await page.keyboard.up('Shift');
  await page.keyboard.up(' ');
  await page.mouse.up();
}
await host.waitForTimeout(500);

const agreed = await Promise.all([host, guest].map((page) => page.evaluate(() => {
  const net = window.__SFC__.getNet();
  const snap = net.latest;
  return {
    tick: snap?.tick ?? -1,
    fighters: (snap?.fighters ?? []).map((fighter) => ({
      id: fighter.id,
      name: fighter.name,
      hp: Math.round(fighter.hp),
      state: fighter.state,
      x: Number(fighter.points.hip.x.toFixed(2)),
      y: Number(fighter.points.hip.y.toFixed(2)),
    })),
  };
})));
await host.screenshot({ path: path.join(out, 'host-fight.png') });
await guest.screenshot({ path: path.join(out, 'guest-fight.png') });

const hostById = new Map(agreed[0].fighters.map((fighter) => [fighter.id, fighter.hp]));
for (const fighter of agreed[1].fighters) {
  if (hostById.get(fighter.id) !== fighter.hp) {
    throw new Error(`hp mismatch ${JSON.stringify(agreed)}`);
  }
}
if (agreed[0].fighters.length < 2) throw new Error(`missing fighters ${JSON.stringify(agreed)}`);
if (![...hostById.values()].some((hp) => hp < 100)) {
  throw new Error(`no damage landed ${JSON.stringify(agreed)}`);
}

const pages = [host, guest];
for (let i = 0; i < 6; i += 1) {
  const page = await openClient(`P${i}`);
  await page.fill('#code', code);
  await page.click('#join-btn');
  await page.waitForFunction(() => window.__SFC__.getMode() === 'online');
  pages.push(page);
}
const count = await host.evaluate(() => window.__SFC__.getNet().lobby.players.length);
if (count !== 8) throw new Error(`expected 8 players, saw ${count}`);
const ninth = await openClient('Extra');
await ninth.fill('#code', code);
await ninth.click('#join-btn');
await ninth.waitForSelector('#gate-error:not([hidden])');
const fullText = await ninth.locator('#gate-error').innerText();
if (!/full/i.test(fullText)) throw new Error(`expected full room, saw ${fullText}`);

const other = await openClient('Cleo');
await other.click('#create-btn');
await other.waitForFunction(() => window.__SFC__.getMode() === 'online');
const otherCode = await other.locator('#room-code').innerText();
if (otherCode === code) throw new Error('rooms collided');
const otherIds = await other.evaluate(() => window.__SFC__.getNet().latest?.fighters.map((fighter) => fighter.name) ?? []);
if (otherIds.includes('Ada')) throw new Error(`room leak ${otherIds}`);

const token = await guest.evaluate(() => sessionStorage.getItem('sfc-token'));
await guest.close();
await host.waitForTimeout(400);
const guest2 = await (await browser.newContext({ viewport: { width: 1100, height: 700 } })).newPage();
watch(guest2, 'bea-2');
await guest2.goto(base, { waitUntil: 'networkidle' });
await guest2.evaluate((value) => sessionStorage.setItem('sfc-token', value), token);
await guest2.reload({ waitUntil: 'networkidle' });
await guest2.waitForFunction(() => window.__SFC__.getMode() === 'online', null, { timeout: 8000 });
const rejoined = await guest2.evaluate(() => window.__SFC__.getNet().localId);
const stillThere = await host.evaluate((id) => window.__SFC__.getNet().lobby.players.some((player) => player.id === id && player.connected), rejoined);
if (!stillThere) throw new Error('reconnect did not restore the fighter');

const latencyReport = [];
for (const ms of [50, 100, 200]) {
  const a = await openClient(`LagA${ms}`);
  const b = await openClient(`LagB${ms}`);
  await latency(a, ms);
  await latency(b, ms);
  await a.click('#create-btn');
  await a.waitForFunction(() => window.__SFC__.getMode() === 'online');
  const lagCode = await a.locator('#room-code').innerText();
  await b.fill('#code', lagCode);
  await b.click('#join-btn');
  await b.waitForFunction(() => window.__SFC__.getMode() === 'online');
  await a.keyboard.down('d');
  await b.keyboard.down('a');
  await a.waitForTimeout(1200);
  const state = await a.evaluate(() => {
    const net = window.__SFC__.getNet();
    return { rtt: net.rtt, fighters: net.latest?.fighters.length ?? 0, tick: net.latest?.tick ?? 0 };
  });
  const stateB = await b.evaluate(() => window.__SFC__.getNet().latest?.tick ?? 0);
  if (state.fighters < 2 || state.tick < 10 || stateB < 10) throw new Error(`latency ${ms} failed ${JSON.stringify(state)} ${stateB}`);
  latencyReport.push({ ms, rtt: state.rtt, tick: state.tick });
  await a.keyboard.up('d');
  await b.keyboard.up('a');
}

console.log(JSON.stringify({ code, agreed, count, otherCode, rejoined, latencyReport, errors }, null, 2));
if (errors.length) process.exit(1);
await browser.close();
