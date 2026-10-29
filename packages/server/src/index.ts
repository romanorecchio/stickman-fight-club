import { pathToFileURL } from 'node:url';
import { emptyInput, FIXED_DT, type InputFrame, type Snapshot } from '@sfc/shared';
import { Simulation, type SimOptions } from '@sfc/sim';

/**
 * Phase 2 will hang Socket.IO off this match: clients push InputFrames,
 * the server steps the shared Simulation at 60 Hz, and snapshots go out
 * at a lower rate. Phase 1 only proves the sim runs headless in Node.
 */
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
if (entry && import.meta.url === pathToFileURL(entry).href) smoke();
