# Uninterrupted Game Releases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Implementation requires user approval of this architecture first.

**Goal:** Publish new app versions without disconnecting active players or replacing their running match state.

**Architecture:** Keep each match on the exact client, server and world release it started with. Run new and old releases concurrently behind a stable gateway, directing new matches to the promoted release and retiring old processes only after their sessions finish.

**Tech Stack:** Existing Three.js/Vite client and Node/ws simulation; Nginx gateway; systemd release instances; small Node control service with a durable SQLite release/room directory.

**Spec:** This document is the proposed architecture and acceptance specification. Status: IMPLEMENTED AND DEPLOYED after explicit user approval.

## Constraints and observed failure paths

- `server/index.ts` currently serves assets and owns every room in one process on port 4173. SIGTERM clears Rooms and closes every socket.
- The active systemd unit executes TypeScript from the mutable checkout. Changing server source in place can change what a later restart loads.
- `server/rooms.ts` stores matches in memory, ties membership to WebSocket objects, and immediately deletes an empty room on disconnect.
- `src/network.ts` connects to one `/ws` endpoint and has no authenticated session-resume flow.
- Replacing `dist` removes old assets. The current mapScale guard catches a single mismatch but does not identify physics, protocol or collision revisions.
- Both configured public hostnames currently tunnel to port 4173. Normal releases must not restart the tunnel.
- Preserve ongoing sessions; never automatically reload a playing browser or move its live physics state to different map geometry.

## Initial proposal (revision 0)

1. Build a versioned release directory instead of overwriting dist.
2. Start a new game process on a different loopback port.
3. Put Nginx at the stable origin endpoint; route new connections to the new process.
4. Leave existing sockets on the old process until its room count reaches zero.
5. Switch the default back to the previous process if the new release fails.

Initial self-score: 5/10. This protects established sockets but leaves reconnects, assets, invitations and shutdown races unresolved.

## Review record

Scoring rubric: continuity (3), client/world consistency (2), deployment/rollback correctness (2), failure handling and security (2), operational simplicity (1). Scores are design self-assessments, not measured reliability.

## Final design

The sections below are revised through five sequential review passes. Final implementation steps and acceptance gates follow the reviews.

### Review 1 — Client/server/world consistency: 7/10 after revision

**Attack:** An old tab reconnects through the default endpoint after promotion; a new browser follows an old-room invitation; an old client requests an asset that the deployment deleted. Socket preservation alone fails all three cases.

**Revision:** Make release identity explicit and immutable.

- A release manifest contains `releaseId`, `protocolVersion`, `worldHash`, `simulationHash`, `assetManifestHash`, and build provenance. `releaseId` identifies the complete artifact, including server code, dependency lockfile and generated map data; a git commit alone is insufficient for this currently dirty checkout.
- `worldHash` includes collision, scale, navigation, boundaries, spawns and level-generator inputs. `simulationHash` covers shared movement/combat rules. The first implementation requires exact release matching; compatibility exceptions require explicit later tests.
- Snapshot the complete source/dependencies before building. Package compiled server output, client assets and required data under `/srv/doodlescreed/releases/<releaseId>/`; a running process never reads the mutable development checkout.
- Serve bundles under `/releases/<releaseId>/assets/...`. Make all dynamic imports, audio, fonts, WASM and other runtime URLs release-relative. Release assets are immutable. Root HTML and the current-release manifest are `no-store`.
- The root entrypoint selects the promoted release. Each match directory entry pins `roomId`, `roomCode`, `releaseId`, `workerId` and `workerEpoch`.
- Match allocation returns `{roomId, releaseId, clientUrl, wsUrl, joinTicket}`. The client loads the matching client URL before joining. `wsUrl` addresses the pinned worker, never a default-release alias.
- A friend invitation resolves its room before selecting a client build. A newer menu may open an older retained build to join that friend. Never reload an active match for an invitation without the player's explicit navigation.
- Keep the scale check as defense in depth, but the release handshake becomes the primary compatibility contract.

### Routing layout

```text
Browser -> existing Cloudflare Tunnel -> stable Nginx gateway :4173
  /                         -> current-release entrypoint
  /releases/<releaseId>/...  -> immutable client assets
  /api/matches/*             -> control service on loopback
  /ws/<workerId>             -> pinned game process on loopback

  worker A: release A, existing rooms
  worker B: release B, new rooms
```

Nginx forwards WebSocket upgrades and preserves Host/Origin for the existing same-origin policy. Do not use a shared cookie as the routing key: different browser tabs may be playing different releases. No public endpoint may choose arbitrary origin ports or filesystem paths.

### Review 2 — Disconnects, resume and identity: 8/10 after revision

**Attack:** Cloudflare or Wi-Fi drops a socket while the release is draining. The current close handler deletes the player and potentially the room, so there is nothing to resume. Replaying an old join ticket could also create duplicate players.

**Revision:** Separate a player session from its current transport.

- Assign a stable `sessionId` and cryptographically random resume secret at admission; retain the secret in per-tab sessionStorage, never URLs, logs or room codes. Store a hash of the secret at the worker. One session may have only one active socket generation.
- On unexpected disconnect retain the same player, HP, ammunition, kills, deaths, position, cooldowns and room for 90 seconds. Keep the room's NPCs, wave state and simulation alive. Explicit Leave relinquishes the session immediately.
- Disable input from a disconnected player; leave the avatar vulnerable with no fresh invulnerability on resume. Reconnecting must not become a free teleport, ammo refill or death escape. If the player died while disconnected, resume the existing death/respawn state.
- Retry the same worker with jittered exponential backoff, starting at 250 ms and capped at 5 s, within the reservation window. Suspend local gameplay input and show a small reconnect indicator while detached.
- On successful resume rotate the resume secret, fence the previous socket generation, and send a full authoritative snapshot plus fresh sequence baseline. Do not replay buffered movement, shots or damage from the disconnected interval. Blend remote actor presentation; reconcile the local player to authoritative state.
- Admission tickets expire after 30 seconds, are bound to room, release, worker epoch and a one-time nonce, and are sent in the first WebSocket message. A worker rejects expired/replayed/wrong-release tickets. Keep Origin validation, bounded pending connections, message limits and a 5-second unauthenticated socket deadline.
- A brief idempotent retry window for the same resume attempt returns the same result if the token-rotation acknowledgement was lost. A later attempt supersedes the old socket and cannot duplicate membership.
- No automatic fallback to a new worker if the original worker is gone. Report the ended session and let the player start a new match; pretending to resume would silently erase match progress.

Network interruptions are outside the deploy continuity guarantee. Cloudflare explicitly documents that its own network rollouts can terminate WebSockets; resume handles that case while the pinned worker remains alive: https://developers.cloudflare.com/network/websockets/ .

### Review 3 — Admission/drain races and endless public rooms: 8.5/10 after revision

**Attack:** A deploy sees zero connected players just before a reserved join arrives and kills the process. Public-wave rooms may never end, so a fixed drain timer eventually kicks players or unlimited old releases exhaust RAM.

**Revision:** Use explicit lifecycle states and authoritative reservations.

- Release states: `STAGED -> READY -> CURRENT -> DRAINING -> RETIRED`; failed candidates remain unpromoted. Worker identity includes a unique epoch so a restarted process cannot inherit stale room routes.
- Promotion changes the default for NEW matches only. Existing sockets, resume attempts, and explicit joins to existing rooms stay pinned. Random matchmaking no longer feeds draining public rooms; direct friend joins may still enter them while capacity permits.
- Before issuing a join ticket, the worker creates a 30-second seat reservation. Reservation counts participate in capacity and shutdown checks. Room IDs are UUIDs; human codes are allocated uniquely through the directory, avoiding collisions across release processes.
- Retirement first marks the worker `closing` through its local control API, which atomically refuses new reservations. It may proceed only when there are zero active humans, zero unexpired resume reservations, zero pending admissions, and zero live human-owned rooms, then confirms quiescence. NPC-only simulation does not retain a worker forever.
- The worker, not an asynchronously reported room counter, makes the final quiescence decision. A reservation racing retirement either succeeds and prevents retirement, or fails cleanly before a ticket is issued.
- There is no automatic maximum age for an occupied release. Public/free-roam rooms may remain pinned indefinitely. An optional menu notice offers the new version; it never reloads players during gameplay or starts a mandatory migration countdown.
- Start with at most three simultaneously running release generations, including the candidate. Measure RSS, CPU, event-loop delay and tick timing under load; promotion requires capacity for the existing players plus the candidate. At the cap, queue the deploy and report the rooms keeping an old generation alive. Never stop occupied workers to make room.
- Retain assets for all live releases and all pending/resumable sessions, plus a minimum seven-day grace after retirement and at least the two latest validated releases for rollback. Garbage collection runs only after transactional pin checks. A very old inactive tab with an expired release returns to the current menu before allocating a new match.

### Review 4 — Atomic promotion, rollback and infrastructure: 9/10 after revision

**Attack:** A process answers /health but cannot load the map; two deploys promote simultaneously; a gateway reload interrupts sockets; a control-service restart forgets rooms; rollback mistakenly kills players already playing the new version.

**Revision:** Make deployment a serialized, gated transaction with rollback that only changes admission.

1. Acquire one deployment lock. Snapshot inputs and generate a content-addressed release; never build into the active directory.
2. Run TypeScript and focused/full regression checks as appropriate. Start a candidate systemd instance from its immutable directory, bound only to loopback.
3. Register its unique worker epoch and route. Run `nginx -t`, then gracefully reload configuration to add the route. Never restart Nginx or cloudflared during an ordinary app release. Preserve old routes and avoid a forced worker shutdown timeout for active WebSockets.
4. Probe readiness: expected manifest hashes, loaded world/collision, running simulation tick and WebSocket admission. Run two real browser clients through the public hostname against the candidate, explicitly bypassing default matchmaking.
5. In one SQLite transaction, compare the expected previous release, promote the candidate and mark the previous default draining. The root entrypoint and match allocator consult that same committed state. Pending reservations already issued for the previous release remain valid.
6. Record a deployment event with old/new IDs and evidence. If a deploy command loses its response, retry with the same deployment ID and read the committed outcome rather than promoting again.
7. Monitor worker crashes, tick overruns, WebSocket closures, resume success, admission failures and current players by release. A failed health threshold halts further rollout. Rollback changes NEW admissions back to the previous healthy release; existing matches on either version continue untouched.
8. Ask each drained worker for its atomic retirement acknowledgement, remove its future route, gracefully stop only that empty instance, and later garbage-collect eligible artifacts.

The control service persists release state, deployment journal and room ownership in SQLite. It does not own or persist tick-by-tick gameplay. Workers maintain connections independently, periodically register their epoch/rooms, and re-register after a control-service restart. During a control-plane outage, existing sockets and direct resume paths continue; new allocations fail closed with a retryable menu error. On restart reconcile DB records against live worker epochs before admitting players. A vanished worker's rooms are marked lost, never reassigned as though their state survived.

A thin gateway is preferred over putting every gameplay packet through custom deployment code. Nginx documents graceful reconfiguration and WebSocket proxy support; explicitly test established sockets across route updates in this environment:
- https://nginx.org/en/docs/control.html
- https://nginx.org/en/docs/http/websocket.html

Stable control APIs are loopback-only with deployment credentials; public clients receive narrow admission/resume capabilities. Preserve rate limiting at the gateway and worker so many release processes do not multiply the public connection allowance. Signing-key rotation must keep verification keys available for the full lifetime of outstanding capabilities.

### Bootstrap limitation

The current monolithic process already owns port 4173 and has no drain/resume mechanism. Its live sockets and in-memory rooms cannot be transferred into this architecture retroactively. Prepare everything on alternate ports, then perform the one-time port handoff during an agreed empty-server window with admission paused at the edge and zero active sessions verified. Keep the tunnel target at 4173; install the gateway there after the legacy process is empty. If the server never empties, defer this handoff instead of claiming a seamless migration or terminating players. The uninterrupted-release guarantee starts after this bootstrap.

### Review 5 — End-to-end failure rehearsal and scope: 9.2/10 after revision

**Attack:** A static-only deploy still restarts the simulation; an empty frontend lobby appears after promotion despite active old rooms; a retired file is deleted during a reload; the host reboots and the product promises impossible continuity.

**Revision:** Separate publication from simulation promotion, preserve room discovery, and define executable acceptance gates.

- The release manifest always records the complete artifact, but a release with unchanged `protocolVersion`, `worldHash` and `simulationHash` may reuse the existing simulation deployment after an explicit compatibility test. Default to exact matching. Implement exact release pinning first; optimizing cosmetic-only releases is a later task and must not weaken the initial guarantee.
- The lobby directory aggregates live rooms across retained releases, deduplicated by UUID. Existing-room joins choose that room's client. The default Play action chooses current-release matchmaking; it does not silently put a new build into an old simulation.
- The UI shows technical release details only in diagnostics. Players see their existing match continue, an optional update notice in the menu, or a brief reconnect status when their network drops.
- Host failure and simulation-process crashes are outside this first version's continuity guarantee. Persisting or replicating authoritative match state would be a separate availability project. Do not describe a SQLite room directory as match recovery.
- The remaining 0.8 design-score deduction is for a single-host failure domain, potentially indefinite draining, extra retained-process cost, and implementation-dependent reconnect/proxy behavior requiring real tests. Five reviews improve this proposal; they do not constitute a runtime reliability result.

## Implementation sequence after approval

Each task includes a failing acceptance test first, implementation second, and a passing test gate before proceeding. Changes remain isolated from the live service until the final bootstrap gate. Do not commit or deploy merely because this document mentions a task; follow the user's execution instructions.

| Task | Files / responsibility | Interface and completion gate |
|---|---|---|
| 1. Immutable release packaging | Create `scripts/build-release.mjs`, `src/release-info.ts`; modify `vite.config.ts`, `server/index.ts`, runtime asset URLs | Produce a manifest and `/srv/doodlescreed/releases/<id>` artifact from a frozen source snapshot. `GET /releases/<id>/manifest.json` describes it. Launch two releases and prove both load all assets after a third build; mutations of the checkout cannot change a running artifact. |
| 2. Resumable player sessions | Create `server/sessions.ts`; modify `server/rooms.ts`, `src/network.ts`, `src/main.ts` | Implement `admit(ticket)`, `resume(sessionId, secret, attemptId)` and `disconnect(sessionId, reason)` against worker-local sessions. Test preserved player state, death while disconnected, 90-second expiry, explicit leave, duplicate sockets, nonce replay and lost resume acknowledgement. |
| 3. Durable release/room directory | Create `server/control/index.ts`, `server/control/directory.ts`, `server/control/schema.sql`, `server/admission.ts` | `POST /api/matches` allocates/reserves; `GET /api/matches/<code>` resolves an invitation; `GET /api/lobbies` aggregates workers. Authenticated local registration/heartbeat endpoints bind room ownership to worker epoch. Test unique codes, idempotent allocation, version mismatch, control restart and dead-worker reconciliation. |
| 4. Stable gateway and version routing | Create `deploy/nginx-doodlescreed.conf`, `deploy/doodlescreed-worker@.service`, `deploy/doodlescreed-control.service` | `/ws/<workerId>` routes only to registered loopback workers; `/releases/<id>/` serves immutable files. Preserve old socket routes through graceful reload. Test two tabs on different releases, Origin checks, connection limits, unknown worker IDs and invalid asset paths. |
| 5. Promotion and retirement | Create `scripts/deploy-release.mjs`, `server/control/releases.ts`; extend worker local control API | `prepare`, `promote(expectedCurrent, deploymentId)`, `rollback`, `reserveSeat` and `beginRetirement` implement the state machine. Test admission/retirement races, concurrent deploy commands, failed readiness, rollback with players on both releases and capacity-induced queuing. |
| 6. Client routing and menu behavior | Modify `src/network.ts`, `src/main.ts`, `index.html`; add release-aware invitation/bootstrap code | Select matching client before admission; retain pinned worker and session identity on reconnect. Never reload while playing. Test new visitor, stale menu, old-room invitation, active-match invitation, retired release and root-manifest fetch failure. |
| 7. Operational rehearsal and bootstrap | Create `scripts/rolling-release-check.mjs`, `tests/release-lifecycle.test.ts`, `tests/session-resume.test.ts`, `docs/deployments.md`; update existing live checks for tickets | Run the complete matrix below on alternate ports and then through a canary public route. Document deploy/promote/status/rollback/retire commands. Bootstrap only after the legacy server is empty, then repeat the matrix on the production route. |

## Required release acceptance matrix

| Scenario | Required result |
|---|---|
| Two clients fight in A while B is built, started and promoted | Their WebSockets stay open, room/player IDs and HP/ammo/scores persist, simulation clock stays monotonic; zero forced reloads, respawns or map switches. |
| New client presses Play after B promotion | Loads B assets and joins B's world. No A/B geometry or movement mixing. |
| B-menu client joins an A invitation | Loads retained A client before joining A; existing A players remain undisturbed. |
| A client loses its socket for 10 seconds during drain | Resumes the same session and current authoritative state on A within the 90-second grace; no duplicate avatar or replayed shots. |
| Resume acknowledgement is lost and request retried | Idempotent recovery with one active transport and no session duplication. |
| B fails readiness or promotion command is retried | A remains default; no partial promotion, duplicate worker or dropped room. |
| Roll back B after clients have joined it | New matches use A; B clients continue on B until they leave. |
| Last A client disconnects while another admission is reserved | A is retained until active/reserved/resumable counts all reach zero atomically. |
| Restart control service; gracefully reload gateway | Existing matches survive; worker routes reconcile without creating fresh copies of old rooms. |
| Old release has one never-ending occupied public room | The room survives; at the generation/resource cap the next deploy queues with a clear status. |
| Attempt asset cleanup while a release is pinned | Cleanup refuses; an active old client can still reload/download every required asset. |
| Old worker crashes / host is lost | Do not pretend the match resumed. Surface session loss; this is explicitly outside deploy continuity. |

Run the A/B continuity test at current room capacity (16 humans plus shared NPCs) and while the candidate is under load. Proposed performance gate: no deployment-induced disconnects or state resets, worker tick work p99 under the 33.3 ms simulation budget, and snapshot-gap p99 no more than 100 ms above the same-load baseline. Measure these rather than declaring them achieved from unit tests.

## Implemented recommendation

Implement exact release-pinned matches, immutable assets, parallel worker generations, authenticated session resume and automatic drain-to-empty. Keep the gateway and tunnel stable. Do not attempt live migration of a running Rust match between different map/physics versions. This design meets the normal-deployment requirement while keeping its failure limits explicit.


## Completion evidence

Implemented all seven stages and integrated the reviewed files into `/home/ubuntu/dev/doodlesCreed`. The host has no passwordless root access, so immutable artifacts use `/home/ubuntu/.local/share/doodlescreed/releases` and the Ubuntu Nginx binary runs as a user service. This changes the proposed directory location, not the routing architecture. Exact release matching is enforced; cosmetic-only compatibility optimization remains intentionally outside the first implementation.

107 automated tests pass. Local and public Cloudflare rehearsals passed 16-player A/B continuity, two-browser pinning, old-room invitations, 10-second session resume, ticket replay rejection, reservation-only retirement protection and rollback. Public snapshot gap p99 was 45.50 ms before rollout and 64.11 ms during rollout; worker tick p99 was 2.87 / 3.54 ms. These passed the specified gates. Evidence: `output/release-checks/public-rehearsal.json`.

An additional public control-service upgrade kept the gateway PID and player WebSocket unchanged while 86 snapshots arrived. The legacy handoff only proceeded after room count and established connections were zero; the tunnel was not restarted. Source changes remain uncommitted, preserving the user's existing branch workflow.
