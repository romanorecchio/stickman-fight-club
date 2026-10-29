import { pathToFileURL } from 'node:url';
import { emptyInput, FIXED_DT, type InputFrame, type Snapshot } from '@sfc/shared';
import { Simulation, type SimOptions } from '@sfc/sim';
import { startServer } from './server.js';

export function createAuthoritativeMatch(options: SimOptions = {}) {
  const sim = new Simulation({ ai: false, ...options });
  return {
    sim,
    pushInput(input: InputFrame): Snapshot {
      sim.step(FIXED_DT, input);
      return sim.getSnapshot();
    },
  };
}

export { startServer } from './server.js';
export { MatchDirectory } from './rooms.js';

function smoke(): void {
  const match = createAuthoritativeMatch({ seed: 1 });
  for (let i = 0; i < 60; i++) match.pushInput(emptyInput(i));
  const stability = match.sim.getStability();
  if (stability.nanEvents > 0 || !Number.isFinite(stability.maxJointSeparation)) {
    console.error('headless sim failed', stability);
    process.exit(1);
  }
  console.log(
    `headless sim ok tick=${stability.tick} bodies=${stability.bodyCount} sep=${stability.maxJointSeparation.toFixed(4)}`,
  );
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  if (process.env.SFC_SMOKE === '1') smoke();
  else {
    startServer()
      .then((server) => {
        const dir = process.env.STATIC_DIR ? ` static=${process.env.STATIC_DIR}` : '';
        console.log(`stickman server listening on :${server.port}${dir}`);
      })
      .catch((error: unknown) => {
        console.error(error);
        process.exit(1);
      });
  }
}
