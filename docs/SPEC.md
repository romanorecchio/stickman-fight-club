# Stickman Fight Club — Full Game Spec (from Roman, the owner)

Real-time multiplayer 2D side-view physics fighting game in the browser. 2–8 players on separate computers: enter username, create private lobby, share 6-char room code (e.g. K7P4Q2) or join URL, fight. Fun, responsive controls, controllable full ragdolls, satisfying weapons, reliable sync. All original assets/code (no cloning branded games). Must be a real working game: no fake buttons, no simulated multiplayer, no invented test results. Keep it runnable/playable at every phase.

## Stack (preferred; deviate only with justification, explain big decisions)
Frontend: TypeScript, Vite, HTML5 Canvas, Phaser 3 (or comparable). Physics: Matter.js (or better), articulated ragdoll constraints, collision categories/masks, fixed timestep, no self-collision instability. Backend: Node + TS + Socket.IO, server-authoritative sim at 60 Hz, lower snapshot rate, in-memory rooms first, DB later for accounts/stats/cosmetics. Deploy: static frontend + WebSocket-capable backend, HTTPS/WSS, env-var config, deploy docs.
Netcode: clients send inputs only (with sequence numbers); server simulates physics, hits, damage, scoring, respawn; clients interpolate timestamped snapshots with tick ids, predict local movement and reconcile; bandwidth-efficient deltas, not full world every frame. Playable at 50/100/200 ms RTT + some packet loss.

## Characters
Ragdoll: head, torso, upper/lower arms, hands, upper/lower legs, feet; joints that never separate/stretch/explode. Physically-assisted control: balance assist, joint motors/torque pose control, physical stepping, balance recovery, impact-based knockback, momentum transfer, falling, stumbling, getting up, physical limb attacks, grab/throw. No sprite-faked ragdoll. Controllability beats realism; expose tuning params.
Movement: walk, run, sprint, jump, air control, crouch, fall, roll, stumble, get up. Forgiving.
Controls (rebindable, no conflicts): A/D move, W jump, S crouch, mouse aim/facing, LMB primary attack, RMB secondary/block, E grab/interact, Q throw/release, F pick up/swap weapon, R reload, Shift sprint, Space kick, G drop weapon, Tab scoreboard, Esc pause/settings.

## Combat
100 HP default (host adjustable). Damage depends on weapon, power, collision, impact speed, hit location, explosion distance, hazards; capped so physics impulses can't insta-kill. Configurable spawn protection.
Unarmed: punch, kick (real limb collision), grab (limited reach, stable constraint, struggle escape, no permanent lock), throw, shove, block, knock off platforms, slam into obstacles.
Melee: baseball bat, sword, hammer, knife, crowbar, spear, giant cartoon mallet, shield — each differs in reach, weight, damage, speed, knockback, cooldown, collision, specials. Droppable/pickup.
Firearms: pistol, revolver, shotgun, assault rifle, sniper, SMG — ammo, reload, recoil (physical but not uncontrollable), bullet collision, projectile or server hitscan, fire rates, accuracy, impact FX, balance.
Explosives: grenade, rocket launcher, landmine, sticky bomb, dynamite — radial damage, knockback, affects loose objects, chain-triggers (no infinite loops), destroys compatible environment, FX/audio.
Novelty (real mechanics): frying pan, giant boxing glove, gravity gun (grab object via stable constraint and launch), exploding rubber chicken, energy sword, fish, banana launcher, oversized wooden club.
Spawning: fixed points, random approved points, supply crates, host settings; weighted rarity, limits; host can disable categories.

## Modes
1. Free-for-All: round-based or timed; score/time/round limits; respawn (kills = points) or elimination (last alive wins; defined tie rules); weapons toggle.
2. Team Deathmatch: Red/Blue, max 8, team select, auto-balance option, host manual assign, team colors, friendly-fire toggle (no TK when off), team score, respawn config, team win.
3. 1v1 Duels: best of 3/5/7, no interference, between-round resets, optional weapons, countdown, winner announcement, others spectate, optional queue/rotation.
4. Infection: one starts infected; eliminated survivors convert and respawn safely; infected get speed, stronger melee, reduced firearms, distinct look; survivors win if ≥1 alive at timer; infected win if all converted; always ≥1 survivor and ≥1 infected at start.
5. King of the Hill: stationary or relocating zone; uncontested holding accrues points; contested stops points (unless host rule); point limit, duration, relocation interval, FFA or team; clear ownership/progress display.

## Maps (config-file driven, metadata lists supported modes)
1 Classic Arena (ground, platforms, minimal hazards, balanced spawns). 2 Rooftop Rumble (rooftops, narrow bridges, gaps, breakable railings, moving elevators, obstacles). 3 Lava Factory (moving platforms, lava pits, conveyors, falling machinery, hazard warnings). 4 Destruction Zone (breakable walls, crates, weak floors, explosive barrels, collapsible structures; predefined/segmented destruction, synced). 5 Sky Platforms (floating platforms, gaps, moving platforms, falling objects). 6 Boxing Club (enclosed ring, ropes/bounds, crowd background, melee focus).
All: valid spawns (never inside players/hazards), camera bounds, visibility, sync, correct collision, round reset, spectator view.

## Lobbies
Create → server generates unique code; copy code/URL; join by code. Host settings (server-validated): mode, map/rotation, max players ≤8, round duration, rounds, starting HP, weapon availability/spawn frequency, friendly fire, physics intensity, gravity presets, respawn rules, score limit, hazard frequency, teams, spectator perms. Gameplay changes apply next round. Lobby UI: code, players, colors, ready status, host badge, mode, map, settings, teams, Start (enabled when valid). Clean disconnect handling; host migration; reconnect grace period via secure token; no impersonation by username. Late join: spectate until next round / join now / disabled.

## Customization
Body color, outline color, head accessories, hats, glasses, faces, simple outfits, victory animations; classic stickman look; readable contrast. Display names length-limited, sanitized, rendered as text. Cosmetic inventory; cosmetic only, no pay-to-win.

## Progression & stats
Guest sessions OK first; later secure accounts. Never trust client XP/kills/unlocks/currency. Track matches, wins, losses, kills, deaths, K/D, damage dealt/received, weapons used, favorite weapon, playtime, best streak, KotH points, infection wins, duel wins — from authoritative events only. XP from matches, round wins, kills, assists, objectives (anti idle-farm). Unlocks: hats, colors, accessories, victory poses, weapon skins, nameplates; configurable data-driven. Profile page, leaderboards.

## Replays
Kill replay at end of elimination rounds: attacker, victim, weapons, physics, slow-mo, cinematic camera, skip — from buffered authoritative transforms/events (no re-sim). Later: full match save/view, pause, slow-mo, speed, seek, spectator cam; retention/storage limits.

## UI
Dark arcade theme, bright accents, clean type, animated buttons, smooth transitions. Main menu "STICKMAN FIGHT CLUB": Quick Play (real matchmaking or clearly marked unavailable), Create Lobby, Join Lobby, Customize Character, Player Stats, Settings; username + character preview. HUD: health, weapon, ammo, kills, timer, scoreboard, remaining players, mode objectives; unobtrusive. Feedback: hit FX, damage numbers, knockback, adjustable screen shake, weapon SFX, explosions, victory notices, kill feed, round announcements, countdown. Master/SFX/music sliders; disable shake/heavy FX.
Camera: smooth follow, airborne-aware, keeps player visible on knockback, bounded, zoom to map; spectator cycling; replay framing; no jumps from remote players.

## Security / fair play
Server validates inputs, input rates, fire intervals, reloads, ammo, damage, health, inventory, pickup range, cooldowns, teams, settings, scores. Rate limiting, duplicate-event protection, abuse protection, secure sessions, origin restrictions, reconnect safeguards; inactive players can't break rooms; no untrusted HTML.

## Performance
60 FPS client, 60 Hz sim, 8 players, no constraint/object/memory leaks over repeated rounds. Dev overlay: FPS, ping, tick rate, body count, snapshot rate, packet traffic, connections. Graphics quality settings (cosmetic only).

## UX flow
Open site → username → customize → create/join lobby → share/enter code → choose mode/map → ready → start → fight with KB+mouse → see winner → play again without rejoining. Helpful errors for bad codes/failed connections. No installs.

## Phases (build in order, each demonstrably playable)
1 Single-player prototype: project setup, renderer, physics, ragdoll stickman, movement, jump, punch, kick, grab, knockback, simple arena, camera, test dummy. Done when player can move, fight dummy, fall, recover without instability.
2 Online multiplayer: dedicated server, WebSockets, rooms, identity, authoritative physics, sync, input handling, interpolation, reconnection, server combat. Done when two separate computers fight over internet.
3 Core loop: FFA, TDM, Duels, health, death, respawn, scoreboard, timers, victory, round transitions; repeat matches without server restart.
4 Weapons & environments: all weapon classes, pickups, restrictions, six maps, moving platforms, hazards, destructibles; synced.
5 Infection, KotH, advanced host settings, rotation, team mgmt, spectating, menus.
6 Accounts/profiles, saved stats, XP, levels, cosmetics, unlocks, customization, leaderboards; survives restarts.
7 Replays, FX, sounds, animation polish, settings, perf, bug fixes.
8 Deployment: prod build, backend config, env, migrations, WSS, health checks, logging, monitoring, docs; public HTTPS URL with players on separate networks.

## Testing
Physics (standing/recovery, jumping, weapons don't break joints, grabs release, no NaN/infinite accel, no stuck states, out-of-bounds recovery, destruction stable). Multiplayer (2 and 8 players, room codes, room isolation, consistent damage, death/respawn sync, pickup sync, simultaneous attacks, disconnects, reconnects, spectating). All modes at min/max players incl. ties and resets. Chrome/Firefox/Edge/Safari; focus loss/regain. Perf: 8 players, simultaneous explosions, many objects, destruction, repeated rounds, latency sim 50/100/200 ms + packet loss, temporary disconnect. Document limitations. Never claim a feature works unless verified.

## Later phase (after multiplayer is solid): owner-only "Chaos Control" troll panel
Roman will send a separate detailed spec. Design the architecture (effect manager with centralized property overrides, expiry, cleanup; server-side owner auth) so it can be added later.
