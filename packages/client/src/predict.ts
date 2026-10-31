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

  /** Visual offset left over from the last correction; it decays so snaps glide instead of pop. */
  private nudge = { x: 0, y: 0, at: 0 };

  reconcile(snap: FighterSnapshot, ackSeq: number, serverTime?: number): void {
    const current = this.pose();
    const serverTorso = snap.parts.find((part) => part.part === 'torso');
    const error = current && serverTorso ? Math.hypot(current.points.hip.x - serverTorso.x, current.points.hip.y - serverTorso.y) : 99;
    const changed = !current || current.hp !== snap.hp || current.state !== snap.state || error > 0.18;
    this.pending = this.pending.filter((input) => input.seq > ackSeq);
    if (!this.primed || changed) {
      // Keep the drunk sway in phase with the server: it's driven by sim time.
      if (serverTime !== undefined) this.sim.time = serverTime;
      this.sim.applyFighterState(this.id, snap);
      for (const input of this.pending) this.sim.stepAll(FIXED_DT, new Map([[this.id, input]]));
      const after = this.pose();
      if (current && after && this.primed && current.state === after.state) {
        const left = this.offset();
        const dx = current.points.hip.x + left.x - after.points.hip.x;
        const dy = current.points.hip.y + left.y - after.points.hip.y;
        if (Math.hypot(dx, dy) < 1.5) this.nudge = { x: dx, y: dy, at: performance.now() };
      }
      this.primed = true;
    }
  }

  pose(): FighterSnapshot | null {
    return this.sim.getSnapshot(this.id).fighters.find((fighter) => fighter.id === this.id) ?? null;
  }

  offset(): { x: number; y: number } {
    const k = Math.exp(-(performance.now() - this.nudge.at) / 90);
    return { x: this.nudge.x * k, y: this.nudge.y * k };
  }

  /** Predicted pose with the decaying correction applied, for drawing. */
  display(): FighterSnapshot | null {
    const pose = this.pose();
    if (!pose) return null;
    const o = this.offset();
    if (Math.abs(o.x) + Math.abs(o.y) < 0.002) return pose;
    const points = { ...pose.points };
    for (const key of Object.keys(points) as (keyof typeof points)[]) points[key] = { x: points[key].x + o.x, y: points[key].y + o.y };
    return { ...pose, points, parts: pose.parts.map((part) => ({ ...part, x: part.x + o.x, y: part.y + o.y })) };
  }
}
