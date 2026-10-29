# Stickman Fight Club — Chaos Control (from Roman)

## Access & security## Access (open to everyone, by Roman's choice)
- No lock. Any player presses **O twice quickly** (two O keydowns within ~400 ms; ignored while typing in a text field) to toggle the panel. Esc closes it.
- There is no owner sign-in, secret code, or Ctrl+Shift+F9 flow any more. Anyone with the link can open the panel and use every effect. This was a deliberate owner decision (Oct 2026).
- The server accepts chaos commands from any player connected to a lobby, and only against players in that same lobby. Each lobby has its own effect manager.
- Kept server-side: input validation (unknown effects, bad targets, and malformed bodies are refused, never thrown), a rate limit of 8 casts per player per 10 s, and the private audit log (`chaos_audit`, actor = player id).
- Socket events: `chaos-open` → `chaos-catalog`; `chaos` / `chaos-reset` → `chaos-result` (`{ ok, effect }` or `{ error }`).
- `OWNER_USERNAME` / `OWNER_PASSWORD_HASH` still let Roman sign in to his normal profile; they grant nothing extra. `OWNER_CHAOS_CODE_HASH` is unused.

ed styling, six tabs: Players, Jumpscares, Physics, Visuals/Fake Events, Weapons, Chaos Roulette. Big RESET ALL button. Target a single player, several, or all.

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
