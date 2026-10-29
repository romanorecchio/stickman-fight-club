# Stickman Fight Club

Real-time 2D stickman fighting. Phase 1 is a local training room: a physics ragdoll you can walk, jump, punch, kick, grab, throw, knock down, and get back up, plus a dummy that fights back.

The full design is in [docs/SPEC.md](docs/SPEC.md). How the code is split, and why, is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Run

```bash
npm install
npm run dev
```

Open the URL Vite prints (default [http://127.0.0.1:4317](http://127.0.0.1:4317)).

```bash
npm test          # headless physics and stability
npm run build     # typecheck, client bundle, server bundle, one-second headless smoke
```

## Controls

| Input | Action |
| --- | --- |
| A / D | Move |
| W | Jump |
| S | Crouch |
| Shift | Sprint |
| Mouse | Aim and facing |
| Left mouse | Punch |
| Right mouse | Block |
| Space | Kick |
| E | Grab |
| Q | Throw |
| Esc | Pause |
| F3 | Fixture debug |

On a touch screen, the on-screen buttons drive the same actions. Balance sliders (Upright, leg torque, jump, knockback, gravity, and the rest) apply immediately. Reset tuning restores the defaults.

## Layout

- `packages/shared` — inputs, snapshots, tuning
- `packages/sim` — headless Planck / Box2D simulation
- `packages/client` — Vite, canvas, input
- `packages/server` — Node host for the same sim (Socket.IO arrives in Phase 2)

## Phase 1 limits

This is local only. One human, one dummy, no weapons, no lobbies, no accounts. Joints are rigid Box2D revolute joints with motors and a balance assist, not a passive ragdoll you micromanage. The recommended next step is Phase 2: server-authoritative online matches on this same `Simulation`.
