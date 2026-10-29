import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader'],
});

async function waitHealth(port) {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      if (res.ok) return;
    } catch {
      // server still booting
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server ${port} did not boot`);
}

const report = [];
for (const ms of [50, 100, 200]) {
  const port = 4400 + ms;
  const child = spawn('node', ['packages/server/dist/index.js'], {
    env: {
      ...process.env,
      PORT: String(port),
      STATIC_DIR: 'packages/client/dist',
      CORS_ORIGIN: `http://127.0.0.1:${port}`,
      SFC_DELAY_MS: String(ms),
    },
    stdio: 'ignore',
  });
  await waitHealth(port);
  const context = await browser.newContext({ viewport: { width: 1000, height: 640 } });
  const host = await context.newPage();
  const guest = await context.newPage();
  await host.goto(`http://127.0.0.1:${port}/`);
  await guest.goto(`http://127.0.0.1:${port}/`);
  await host.fill('#name', 'LagHost');
  await host.click('#create-btn');
  await host.waitForFunction(() => window.__SFC__.getMode() === 'online');
  const code = await host.locator('#room-code').innerText();
  await guest.fill('#name', 'LagGuest');
  await guest.fill('#code', code);
  await guest.click('#join-btn');
  await guest.waitForFunction(() => window.__SFC__.getMode() === 'online');
  await host.waitForTimeout(1500);
  const measured = await host.evaluate(() => window.__SFC__.getNet());
  const guestNet = await guest.evaluate(() => window.__SFC__.getNet());
  const sameTick = measured.latest && guestNet.latest && measured.latest.tick === guestNet.latest.tick
    ? measured.latest.fighters.every((fighter) => {
        const other = guestNet.latest.fighters.find((item) => item.id === fighter.id);
        return other && other.hp === fighter.hp;
      })
    : false;
  if (measured.rtt < ms * 0.6) throw new Error(`delay ${ms} only measured rtt ${measured.rtt}`);
  if ((measured.latest?.fighters.length ?? 0) < 2) throw new Error(`delay ${ms} missing fighters`);
  report.push({ ms, rtt: measured.rtt, tick: measured.latest.tick, guestTick: guestNet.latest?.tick, sameTick });
  await context.close();
  child.kill('SIGTERM');
  await new Promise((resolve) => child.on('exit', resolve));
}

console.log(JSON.stringify(report, null, 2));
await browser.close();
