import { FIXED_DT, type FighterSnapshot, type InputFrame } from '@sfc/shared';
import { Simulation } from '@sfc/sim';

/** Local-only replay of unacked inputs. Damage stays on the server. */
export class Predictor {
  private readonly sim: Simulation;
  private pending: InputFrame[] = [];
  private primed = false;

  constructor(
    private readonly id: string,
    name: string,
    color: number,
  ) {
    this.sim = new Simulation({ roster: 'empty', ai: false, seed: 1 });
    this.sim.addFighter(id, name, color);
  }

  push(input: InputFrame): void {
    this.pending.push(input);
    if (this.pending.length > 180) this.pending.splice(0, this.pending.length - 180);
    if (this.primed) this.sim.stepAll(FIXED_DT, new Map([[this.id, input]]));
  }

  reconcile(snap: FighterSnapshot, ackSeq: number): void {
    const current = this.pose();
    const serverTorso = snap.parts.find((part) => part.part === 'torso');
    const error = current && serverTorso ? Math.hypot(current.points.hip.x - serverTorso.x, current.points.hip.y - serverTorso.y) : 99;
    const changed = !current || current.hp !== snap.hp || current.state !== snap.state || error > 0.18;
    this.pending = this.pending.filter((input) => input.seq > ackSeq);
    if (!this.primed || changed) {
      this.sim.applyFighterState(this.id, snap);
      for (const input of this.pending) this.sim.stepAll(FIXED_DT, new Map([[this.id, input]]));
      this.primed = true;
    }
  }

  pose(): FighterSnapshot | null {
    return this.sim.getSnapshot(this.id).fighters.find((fighter) => fighter.id === this.id) ?? null;
  }
}
