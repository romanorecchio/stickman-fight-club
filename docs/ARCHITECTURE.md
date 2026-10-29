# Architecture

Phase 1 is a single-player training room. The layout is the one Phase 2 multiplayer will run: one headless simulation, thin clients, shared message types.

## Packages

| Package | Role |
| --- | --- |
| `@sfc/shared` | Input frames, snapshots, balance parameters, collision categories, fixed timestep. Plain data. No physics engine. |
| `@sfc/sim` | The game. Arena, ragdolls, motors, combat, AI. Depends only on `planck` and `@sfc/shared`. No DOM. |
| `@sfc/client` | Vite app. Samples keyboard and mouse, steps the sim, draws an HTML5 canvas. |
| `@sfc/server` | Node entry that constructs the same `Simulation`. Phase 2 attaches Socket.IO here. It does not trust the client with positions or damage. |

`npm run dev` serves the client. `npm test` runs the sim in Node. `npm run build` typechecks, bundles the client, bundles the server, and smoke-runs one second of headless sim.

## Why Planck (Box2D) instead of Matter.js

The spec prefers Matter.js and allows a better choice when the reason is concrete. Matter constraints are soft springs: under ragdoll loads they stretch, and the usual fix is more iterations plus hope. This game requires joints that do not separate, stretch, or explode, plus angle limits and joint motors.

Planck.js is a Box2D port with rigid revolute joints, limits, and motors. It is plain JavaScript, so the identical step runs in the browser and in Node. That is the Phase 2 server sim. Rendering stays out of the physics library on purpose.

## Why Canvas instead of Phaser as the physics host

Phaser is a fine renderer, but its physics plugins own the world inside a browser scene. A server tick cannot use that. Stickmen are lines and circles, so the client draws them with Canvas 2D. The sim never imports the renderer. Phaser can still be added later for particles if a Canvas effect is not enough; it must not become the place the world is simulated.

## Simulation loop

`Simulation.step(1/60, input)` is the only way time moves.

1. Decay timers, update facing, step the state machine (idle, walk, sprint, crouch, air, stumble, fallen, get-up, KO).
2. Build a target pose. Walk and sprint are a phase-driven step. Punches, kicks, and grabs solve a two-link IK target in the aim direction. Balance applies upright torque, a capped horizontal force, and a weak hip-height assist. Joint motors chase the pose with limited torque and speed.
3. `world.step(1/60, 12 velocity iterations, 8 position iterations)`.
4. Resolve queued contacts into damage, block, and knockback. Impacts set stumble or ragdoll; they do not teleport the body.
5. Clamp non-finite or extreme velocities, measure joint separation, respawn out-of-bounds or KO'd fighters.

Each fighter is 14 dynamic bodies: head, torso, upper/lower arms, hands, upper/lower legs, feet. Thirteen revolute joints connect them. Front and back limbs share a shoulder or hip anchor and do not self-collide (`filterGroupIndex` negative per fighter). They do collide with the world and with the other fighter.

Collision bits live in `@sfc/shared`: `CATEGORY_WORLD` and `CATEGORY_FIGHTER`.

The client accumulates frame time and calls `step` with a fixed `1/60`. It renders an interpolation between the last two snapshots so a dropped frame does not look like a teleport. At most five steps run per frame.

## Controls and combat

Default binds match the spec: A/D, W, S, Shift, Space, LMB, RMB, E, Q, mouse aim. The client turns them into an `InputFrame` (movement, buttons, aim vector, sequence number). The sim does not know about key codes.

Hits come from real fixture contacts whose relative speed is high enough to ignore resting weight. A live punch or kick adds an impulse scaled by limb speed, then capped. Block cuts damage from the front. Grab creates one distance joint from the lead hand, breaks on a timer, struggle, or stretch, and throw deletes it and impulses the victim. Nothing about a grab is permanent.

Balance parameters are the `BalanceParams` object. The training room writes them live. Sliders cannot invert fall and stumble thresholds; `sanitizeBalance` clamps the bag.

## Phase 2 netcode (not built)

The server will own one `Simulation` per room at 60 Hz.

- Clients send `InputFrame`s with `seq`, not positions.
- The server validates rate, cooldowns, and teams, then steps.
- Snapshots go out at about 20 Hz with a tick id. Full `FighterSnapshot`s exist now; the wire format should send deltas (changed poses, events) plus a keyframe every half second.
- The owning client predicts by stepping a local copy, then reconciles when the authoritative snapshot for that `seq` arrives. Remote fighters interpolate between snapshots and never get to write the world.
- Rooms stay in memory. Reconnect tokens and host migration are server state, not client state.

`packages/server` exports `createAuthoritativeMatch()` as that seam. It currently steps and returns a snapshot. It does not open a socket and it does not pretend to.

## Later: Chaos Control

Not in this phase. When it lands, it is a server-side `OverrideStack` applied at the top of `step`: timed property overrides (gravity, motor scale, friction, hazard spawns) with an id, an expiry, and a cleanup so a round reset cannot leak one. `BalanceParams` is the bag those overrides will wrap. Only an authenticated owner channel may push them. Clients render the result; they do not author it.

## What Phase 1 deliberately leaves out

Menus, lobbies, accounts, weapons, the six-map list, match modes, and deployment. The arena is one room with a floor, three platforms, walls, and a crate, which is enough to walk, jump, fall, and slam into something.
