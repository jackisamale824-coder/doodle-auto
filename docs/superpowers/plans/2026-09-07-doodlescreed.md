# doodlesCreed Implementation Plan

> **For agentic workers:** Use executing-plans to implement this plan task-by-task.

**Goal:** Deliver and locally serve a playable original first-person procedural-city parkour shooter, with verified multiplayer and screenshots.

**Architecture:** Shared deterministic world geometry feeds Three.js rendering, Rapier collisions and server visibility checks. The client separates movement, city rendering, NPC combat, UI and networking. A Node server serves Vite in development or the built client in production and owns multiplayer room state and health.

**Tech Stack:** TypeScript, Three.js, Rapier, Vite, Node, ws, Playwright.

**Spec:** docs/superpowers/specs/2026-09-07-doodlescreed-design.md

## Global constraints

- Name: doodlesCreed. Desktop first-person gameplay; responsive menus.
- Original code and generated assets; reference is inspiration.
- Each seed produces identical geometry for all players.
- Interiors and rooftops need physical, connected access.
- Do not claim public deployment or internet multiplayer verification from local testing.

### 1. Deterministic city and collision foundations

Files: src/world.ts, src/physics.ts, tests/world.test.ts, tests/movement.test.ts.
Interfaces: generateCity(seed: string, district: number): City; Physics(city); Controller(physics).

- [x] Write generator tests for identical seeds, different districts, non-overlapping lots, entrances and roof access.
- [x] Run `npm test` to observe missing behavior.
- [x] Implement seed PRNG, block placement, explicit building walls/openings, internal stairs, rooftop props and route beacons.
- [x] Add Rapier capsule sweeps and a fixed-step movement controller with input actions.
- [x] Run world and movement tests, fixing collision and traversal failures.

### 2. Rendered solo game

Files: src/render.ts, src/actors.ts, src/combat.ts, src/audio.ts, src/main.ts, src/style.css, index.html.
Interfaces: Game owns scene and lifecycle; Controller exposes position/velocity/action; Combat owns weapons and enemies.

- [x] Add failing browser acceptance checks for menu/start, movement, firing, settings and district progression.
- [x] Render generated architecture using an original paper/ink shader and edge strokes, doodle enemies and first-person weapon models.
- [x] Implement NPC navigation with graph paths through entrances and rooftops, line-of-sight combat, pickups and contracts.
- [x] Implement polished menu/HUD, help/settings, audio, persistence and pause/restart.
- [x] Run `npm run build` and use screenshots/gameplay checks to iterate.

### 3. Multiplayer

Files: server/index.ts, server/rooms.ts, src/network.ts, tests/network.test.ts.
Interfaces: create/join/welcome/state/fire/respawn/leave JSON messages; identical room seed.

- [x] Write real WebSocket tests for create/join, seed consistency, invalid input, shot validation, health/score and disconnect cleanup.
- [x] Implement room server, bounded input validation, server-owned damage and static-world shot occlusion.
- [x] Add client room controls, interpolation, scoreboard and connection failure UI.
- [x] Run tests and verify two separate browser clients see each other moving.

### 4. Vision and delivery

Files: output/playwright/*, README.md, docs/verification.md.

- [x] Capture reference screenshots via Playwright and compare paper palette, linework and scene readability.
- [x] Capture menu/street/interior/rooftop/combat screenshots, inspect them, and fix visible discrepancies.
- [x] Exercise movement and combat through input plus reproducible physical scenarios; record the exact scope of testing.
- [x] Run tests and production build, serve locally on a free port, document startup and deployment requirements.
