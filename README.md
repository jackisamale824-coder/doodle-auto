# Sully6 Arcade

[sully6.com](https://sully6.com/) is the game directory. Its tiles launch [Doodle Auto](https://gta.sully6.com/), [Drive Mad](https://drive-mad.sully6.com/) and [Side Pocket](https://pool.sully6.com/). Preview the directory at `/arcade/index.html` on the local dev server.

Pushing to `main` runs **Deploy sully6.com**. The production `doodle-auto` Worker serves the directory and the native game clients from its static assets. Doodle Auto and Side Pocket share the existing multiplayer container. Each game hostname is a DNS-only CNAME to `sully6-games.pages.dev` and a custom domain on that Pages project. Its small forwarding function in `deploy/game-host/_worker.js` sends requests to the apex Worker's `/play/<game>/` route, including WebSocket upgrades. New game releases only require the normal push.

To add a game, include its client in the build, map its slug in `src/cloudflare.ts`, register its Pages custom domain and CNAME, and add its tile and release check in `public/arcade/index.html` and `scripts/verify-arcade.mjs`. If the forwarding function itself changes, publish it from the repository root with the Pages project's account selected:

```sh
cf pages deployments create sully6-games --branch main --manifest '{}' --worker-js '@deploy/game-host/_worker.js'
```

## Doodle Auto

The [Doodle Auto system map](https://sully6.com/system-map.html) traces a match through the browser, multiplayer server and player database, and shows how releases reach sully6.com.

An original first-person ink-and-paper parkour shooter. Run, vault, wall-run and swing through procedurally generated cities with navigable interiors and rooftops.

## Google sign-in

Create a Web application OAuth client in Google Auth Platform. Include `https://gta.sully6.com` and `https://sully6.com` in its authorized JavaScript origins. For local testing, also add `http://localhost:4173`. Set the public client ID in the GitHub repository Actions variable `GOOGLE_CLIENT_ID` before deploying, or in the server environment for local development. [Google web client setup](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid)

Returning password players can open their stats and select **Link Google account** to keep their profile and Elo. Signing in with a new Google identity from the login screen creates a player with a generated racer name.

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

Choose a primary, secondary and equipment before entering a game. Use **1**, **2** and **3** or the mouse wheel to switch slots. Press **B** at spawn to reopen the grid before firing or leaving the spawn area. Select by clicking, or press a category number followed by the item number. Press **B** to equip and close. During play, hold **T**, move the mouse toward a weapon and release to equip it. **X** switches to the previous weapon. **Q** also quick-switches on maps without grappling. Each grenade can be thrown once per life. After a death, choose **Respawn** to keep your kit or **Change loadout** to equip another one.

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
| 1 / 2 / 3 or mouse wheel | Primary / secondary / equipment                                              |
| R                        | Reload (unlimited reserve ammunition)                                 |
| Tab                      | Scoreboard / run statistics                                           |
| Escape                   | Pause and release mouse                                               |
| M                        | Toggle the floating map                                               |
| Shift + M                | Toggle sound                                                          |

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
- Public HTTPS (Cloudflare; no VPN required): https://doodlerust.stvl.dev
- Additional Tailscale URL (Funnel enabled; public DNS propagation pending at initial verification): https://ubuntu-system-product-name.tail267120.ts.net:10000/
- Tailscale direct IP: http://100.110.125.117:4173

```sh
systemctl --user status doodlescreed.service
systemctl --user restart doodlescreed.service
journalctl --user -u doodlescreed.service -n 50
```

The unit source is `deploy/doodlescreed.service`; the installed unit is `~/.config/systemd/user/doodlescreed.service`. To develop while production occupies port 4173, use `PORT=5173 npm run dev`, then `GAME_URL=http://127.0.0.1:5173 npm run test:browser`.

A separate production smoke check works without development hooks: `GAME_URL=http://localhost:4173 node scripts/production-check.mjs`.

Tailscale Funnel is enabled for the HTTPS URL, including multiplayer WebSockets, but external DNS resolution was not confirmed in the latest check. Use the verified Cloudflare hostname for public access. Inspect with `tailscale funnel status`. The existing private routes on 443 and 8443 are preserved.

A Cloudflare Quick Tunnel fallback is running at https://promise-newman-worthy-professor.trycloudflare.com via the enabled user service `doodlescreed-public.service`. Its random hostname can change if that tunnel restarts; use https://doodlerust.stvl.dev as the stable public link. Find the current fallback with `journalctl --user -u doodlescreed-public.service --no-pager`.

**Play defaults to a public city:** up to 16 humans and eight shared server-controlled NPCs. New players join the existing public lobby; a second lobby opens when it fills. Public cities run continuously. Solo modes remain explicit options. For a private match, choose **PRIVATE ROOM → CREATE A ROOM → COPY INVITE LINK** (eight humans).

Public multiplayer uses a single WebSocket connection per player, 30 Hz compact snapshots, immediate local movement/fire feedback, and bounded remote extrapolation. Slow clients drop stale snapshots rather than queueing latency. NPC navigation and hit tests use a shared static spatial index. A 16-client local load check measured approximately 35 KB/s per client and a 4.04 ms server tick p95; these are host measurements, not worldwide latency guarantees.

The server owns NPC simulation, damage, health, ammunition, reload deadlines and scores. It validates movement distance against a time-based budget and checks swept collision. Connections enforce same-host browser origins, 2 KB frames, message/admission limits, heartbeat cleanup and output backpressure. This is a casual public game with client-predicted movement; validation does not provide comprehensive anti-cheat or prevent aimbots. There are no accounts or persistent rankings.

Verification: `npx tsx scripts/lobby-load.ts`, `GAME_URL=https://doodlerust.stvl.dev node scripts/public-lobby-browser.mjs`, and `GAME_URL=https://doodlerust.stvl.dev node scripts/connection-check.mjs`. Results and screenshots are under `output/playwright/`.

Vaults now use an explicit 0.18-second transition; mantles cap at 0.2 seconds. The weapon braces during traversal, then returns to its regular pose. Momentum and collision checks remain active.

### Dedicated public Cloudflare hostname

**https://doodlerust.stvl.dev** is the persistent public hostname for this game. No VPN is required. The named `doodlescreed` tunnel proxies this hostname and the legacy `doodlescreed.cutslop.com` alias to port 4173, including `/ws`. Its enabled user service is `doodlescreed-tunnel.service`, with configuration in `deploy/cloudflared.yml`. Credentials stay outside the repository in `~/.cloudflared/`.

```sh
systemctl --user status doodlescreed-tunnel.service
journalctl --user -u doodlescreed-tunnel.service -n 30
GAME_URL=https://doodlerust.stvl.dev node scripts/production-check.mjs
GAME_URL=https://doodlerust.stvl.dev node scripts/public-combat-check.mjs
```

### City pipeline

The city now follows a bounded street → block → parcel → neighborhood building kit → dressing/navigation pipeline, with a protected training plaza. Four neighborhoods have different building types, height ranges and setbacks. The HUD includes a street/rooftop-route map. Every generated building remains enterable with a physical stair route to its roof. Regional seed changes and authored building overrides are available through `generateCity` options; see [the city pipeline guide](docs/city-pipeline.md).

The metropolis expansion has **256 enterable buildings across 64 blocks**, in a **584 × 584 m** playable area (over 10× the earlier area). Buildings occupy about 51% of the map, approximately double the earlier density. Two frontage rows per block form narrow rear alleys; distant massing and spatially grouped nearby details maintain the extended skyline.

Air actions share one charge per landing: press **Space** again in the air for a speed-scaled double jump, or **F** for a directional boost. WASD chooses the boost direction; without directional input it goes forward. Spending either disables both until landing. The HUD shows charge status. Wall jumps, vaults and grapple launches retain their existing controls.

### Enemy waves

Solo district runs and public multiplayer cities now use shared wave settings: 4 enemies in wave 1, 7 in wave 2, 10 in wave 3, adding 3 per wave up to 40. Clear all remaining enemies to start a six-second break; later waves feed reinforcements in faster, with at most 16 NPCs alive simultaneously. Reaction time, movement speed, attack rate and damage increase within caps. Shooters flank and retreat when wounded; later solo waves lead projectile shots. Free roam stays combat-free and private PvP rooms retain their existing mode. The HUD shows wave number, enemies remaining and the next-wave countdown.

NPC presence is bounded to a 100 m player radius. Solo NPCs outside it are removed and requeued; multiplayer NPCs remain active while near any living player, with distant NPC models hidden per client. Replacement spawns use clear navigation positions 20–60 m from a player, at least 20 m from every player, separated from other NPCs, and behind cover across the full body silhouette for every player within rendering range. If no hidden position is valid, spawning retries after 0.5 seconds. Requeuing does not award kills or change a wave's remaining-enemy total.

### Four Tides

Choose **Four Tides · The Islands** or open `/?level=islands`. Start at Compass Cay and cross the wooden bridges to Frostpine Ridge, Lantern Quay, Ember Caldera, and Shipwreck Cove. Free roam, district runs, public matches, duels, and private rooms support the islands. Falling into the sea returns you to the cay.

### Switchback County

The main menu opens in **Switchback County**. Select **Solo** to start immediately, or **Public** to join a shared county. A new runner starts with a rifle, shotgun, pistol, sniper and knife. A saved custom loadout carries over. Notoriety rises when you damage the town or its residents, and civilians react more aggressively above 30%, 50% and 75%. Approach a parked car
and press E to drive. Use W/S to accelerate or reverse, A/D to steer and Space to brake.
The fleet includes saloons, coupes, family minivans, taxis and compact delivery vans. Look for a taxi rank near town hall or a delivery van at the market. Press V to switch between the chase camera and the driver’s seat. In the cockpit, use the mouse to look around. Press E again to open the driver’s door and return to foot combat. Westhaven and Eastbank share a highway with open
highlands on either side. Each public county holds up to 30 human players. Rust remains available from the main menu.

Follow the valley road from Westhaven’s freight yards to Eastbank’s terraced neighborhoods. Street hierarchy, land use and frontage constraints guide the seeded block layout. Look at a building door and press **E** to open or close it. Homes, shops, factories and civic buildings have furnished rooms and access to their upper floors. Gunfire can break doors, windows, walls, fittings, floors and roofs. Removing a support can drop its attached fittings. When the remaining supports can no longer balance a storey, the connected section tips under gravity and collides with the street and nearby buildings. Fallen pieces still block movement and can be broken again. Changes last for the match and are visible to players who join later.

To benchmark a structural collapse at a fixed 1280 × 720 resolution, run `COUNTY_HARDWARE_GL=1 COUNTY_TEST_ORIGIN=http://127.0.0.1:4173 node scripts/county-collapse-check.mjs` against the local development server.

To exercise capacity on an empty local development server, run
`COUNTY_TEST_WS=ws://127.0.0.1:4173/ws node scripts/county-load.mjs`.

The towns mix sawtooth workshops, row houses, cinemas, clock halls and stepped office towers. Wave enemies can circle, back away and fire in short bursts. Free roam has no enemies.

To check the chase camera over a driving route, run
`COUNTY_TEST_ORIGIN=http://127.0.0.1:4173 node scripts/county-driving-check.mjs` against the dev server. On Linux with desktop OpenGL available, set `COUNTY_HARDWARE_GL=1` for hardware frame timings.
