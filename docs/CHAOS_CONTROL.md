# Stickman Fight Club — Secret Owner Chaos Control System (from Roman)

## Access & security (build FIRST)
- Open with Ctrl+Shift+F9, AND require an authenticated owner account, AND a secret code validated on the backend.
- Nothing hardcoded in the frontend. Credentials in env vars or stored hashed (e.g. OWNER_USERNAME, OWNER_PASSWORD_HASH, OWNER_CHAOS_CODE_HASH).
- Every privileged WebSocket command is verified server-side (owner session check per command).
- Rate-limit / lock out failed attempts. Owner sessions expire.
- Private server-side audit log of every privileged action.
- Never reveal to other players who the owner is or that the panel exists (no client bundle strings that expose it beyond the generic key listener; panel UI can be lazy-loaded after auth).

## Panel
Black and red styling, six tabs: Players, Jumpscares, Physics, Visuals/Fake Events, Weapons, Chaos Roulette. Big RESET ALL button. Target a single player, several, or all.

## 30 effects
Jumpscares: Nightmare Face, Goofy Screamer, Fake Crash Jumpscare, Custom Jumpscare (owner upload, validated type/size, sanitized).
Visuals / fake events: Fake Victory, Fake Disconnect, Fake Legendary Weapon, Fake Game Update, Fake Killcam, Fake Champion.
Physics: YEET, Spaghetti Bones, Zero Gravity, Heavyweight, Human Pinball, Tiny Stickman, Giant Head, Reverse Gravity, Slippery Feet, Invisible Trampoline.
Controls / screen: Reverse Controls, Upside-Down Screen, Mirror World, Random Teleport, Invisible Man.
Weapons: Chicken Gun, Weapon Roulette, Backfire, Pool Noodle.
CHAOS ROULETTE: random safe effect(s).

## Effect rules
- Duration 1–15 s (default 4 s). Intensity 10–100% mapped to safe limits.
- Effect manager handles stacking, conflicts (e.g. zero vs reverse gravity), and guaranteed cleanup on expiry, death, round end, disconnect, and RESET ALL.

## Jumpscare safety
- Respect in-game volume; normalize audio levels.
- Players can opt out of jumpscares; mute; reduced-motion and reduced-flash settings honored.
- No rapid flashing. Escape dismisses instantly.
- Must NOT imitate real OS, browser, or security alerts (Fake Crash must look obviously game-styled).
- No fullscreen or autoplay-policy bypass. Overlay covers only the game canvas, never the whole page/OS.

## Extras
- Optional lobby "Chaos Mode" indicator the host can enable.
- Works with 2–8 players.

## Build order
Security → jumpscares → physics effects → visuals/fake events → controls & weapons → roulette → testing.
