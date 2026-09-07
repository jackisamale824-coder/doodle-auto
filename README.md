# doodlesCreed

An original first-person ink-and-paper parkour shooter. Run, vault, wall-run and swing through procedurally generated cities with navigable interiors and rooftops.

## Run

Requires Node.js 20.19+ and npm.

```sh
npm install
npm run dev
```

Open **http://localhost:4173**. The same process serves the game and its WebSocket multiplayer server. Set `PORT` or `HOST` to change the listener.

For the production build:

```sh
npm run build
npm start
```

## Play

- **District run:** erase six NPC rivals, collect three gold rooftop marks, then return to the starting plaza. Completing a district generates the next seeded city with tougher, faster rivals.
- **Free roam:** practice parkour without enemies.
- **Online:** create a room and share the five-character code. Up to eight players join the same seed. First to 15 eliminations wins. Players can join an ongoing game.

Every building has an open front entrance and internal stair flights to its roof. Apartment blocks also have external platforms and climbable fire-escape geometry. Window openings are actual openings: you can shoot and grapple through them. Routes include streets, alleys, interiors, stairs, parapets, and rooftop equipment.

| Input                    | Action                                                                |
| ------------------------ | --------------------------------------------------------------------- |
| WASD / arrows            | Move                                                                  |
| Mouse                    | Look                                                                  |
| Shift                    | Sprint                                                                |
| Space                    | Jump; vault low obstacles; mantle taller ledges; jump away from walls |
| C / Ctrl                 | Crouch; slide while moving quickly                                    |
| Q / E                    | Tap to attach or detach a grapple; hold to reel                       |
| Space while hooked       | Release with upward launch and retained horizontal momentum           |
| Left / right mouse       | Fire / aim                                                            |
| 1 / 2 / 3 or mouse wheel | Rifle / shotgun / pistol                                              |
| R                        | Reload (unlimited reserve ammunition)                                 |
| Tab                      | Scoreboard / run statistics                                           |
| Escape                   | Pause and release mouse                                               |
| M                        | Toggle sound                                                          |

Wall running starts when moving forward alongside a wall in the air. The dotted aim ring indicates a valid hook target within 65 meters. Gold markers identify rooftop objectives. Collecting marks replenishes health; green pickups also heal. Health slowly regenerates after avoiding damage.

Settings include sensitivity, field of view, volume, inverted look, reduced camera motion, and rendering resolution. Settings, player name, city seed and best score persist locally. Fonts are bundled, and no CDN requests are required during play.

## Networking and hosting

The server owns room membership, player health, damage, kills and deaths. It rate-limits fire and messages, validates numeric state and movement bounds, and checks weapon rays against the same city geometry. Avatars interpolate snapshots at 20 Hz. Solo NPCs simulate locally; multiplayer is player-versus-player.

For Internet hosting, deploy the Node application behind HTTPS with WebSocket upgrade forwarding for `/ws`. A static-only Vercel upload is not sufficient for the multiplayer server. A container definition is included. The app needs no database or secret keys.

Rooms live in memory and disappear when empty or when the process restarts. This is casual multiplayer: movement is client-predicted with sanity checks, not a fully authoritative competitive simulation with rollback/lag compensation. Browser testing on this host does not establish Internet latency or cross-network connection quality. Internet hosting is not configured by the local setup.

## Validation

```sh
npm test             # Procedural world, physical traversal, collision and real WebSocket tests
npm run build        # Strict TypeScript check and production bundle
npx playwright install chromium
npm run dev          # Run in a separate terminal before the browser check
node scripts/browser-check.mjs
```

The browser check uses actual keyboard and mouse events for movement, vaulting, grappling, firing, reloading, dialogs, and multiplayer. Reproducible position/aim fixtures set up isolated parkour situations. The staircase check walks the physical controller along the generated route. Death and district completion use explicit state fixtures to exercise those UI transitions. It records screenshots, a video, and JSON results in `output/playwright/`.

The renderer is WebGL. Desktop keyboard and mouse are required for gameplay; menus adapt to smaller displays. Headless software rendering is useful for correctness checks but does not represent GPU gameplay performance.

## Code map

- `src/world.ts`: deterministic street/lot generation, solid geometry, navigation graph and ray geometry.
- `src/physics.ts`: Rapier character collision, acceleration, vaulting, mantling, wall movement and grapples.
- `src/render.ts`, `src/actors.ts`: original ink shaders, instanced architecture, procedural doodle characters and weapons.
- `src/combat.ts`: arcade weapons, NPC navigation and projectiles, pickups, health and score.
- `src/main.ts`, `src/style.css`: game lifecycle, input, HUD, dialogs and settings.
- `src/network.ts`, `server/rooms.ts`: room protocol, avatar state and server combat.
- `server/index.ts`: development/production HTTP server and WebSocket endpoint.

## Reference

Inspired by [Doodle District](https://doodleshooter.vercel.app/). Its publicly served [player module](https://doodleshooter.vercel.app/src/player.js), [renderer](https://doodleshooter.vercel.app/src/render.js), and [bootstrap](https://doodleshooter.vercel.app/src/main.js) were inspected to understand its movement, paper-and-ink treatment, and PeerJS multiplayer architecture. No public source repository was confirmed. This project uses original code, shaders, geometry, interface and assets; it does not vendor the reference game.

## This host

The production game is running as the enabled user service `doodlescreed.service` on port **4173**.

- Local: http://localhost:4173
- LAN: http://192.168.1.251:4173
- Tailscale: http://100.110.125.117:4173

```sh
systemctl --user status doodlescreed.service
systemctl --user restart doodlescreed.service
journalctl --user -u doodlescreed.service -n 50
```

The unit source is `deploy/doodlescreed.service`; the installed unit is `~/.config/systemd/user/doodlescreed.service`. To develop while production occupies port 4173, use `PORT=5173 npm run dev`, then `GAME_URL=http://127.0.0.1:5173 npm run test:browser`.

A separate production smoke check works without development hooks: `GAME_URL=http://localhost:4173 node scripts/production-check.mjs`.
