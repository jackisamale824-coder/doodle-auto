# Multiplayer combat sync proposal

## Where the missing weapon comes from

Slot 5 and the hand meshes ship in the browser bundle. The worker accepts a connection only for its own release. Joining or resuming an older room deliberately selects that room’s bundle. Refreshing a pinned URL loads the same build. In a room on a compatible build, the equipped weapon and active swing arrive in actor snapshots. A missed swing snapshot can hide one animation but cannot remove a slot from the local inventory.

The updated client checks the current release in the lobby and pause screen. Players can explicitly leave for the latest release. Punch impacts now carry server time, move, anatomical region and hit direction. The server sends an immediate impact and repeats the latest reaction on that actor’s snapshots for its 550 ms recovery. Rendering uses the original contact time, including when an actor first enters view. Health stays authoritative on the server.

## Proposed admission and replication changes

1. **Give every room a combat catalog.** Publish a small manifest with stable weapon IDs such as `fists`, the combat schema version and a hash over move definitions. Include the room’s required catalog and asset build in admission, welcome and resume. Compare them before enabling Play. Direct a mismatch to the compatible build, preserve the invitation and map, and show the room version alongside the current version. Drive HUD slots, key bindings, remote models and accepted inputs from this catalog. Keep exact-build pinning until compatible pairs have passed simulation and asset tests.
2. **Make snapshots self-identifying.** Include a server tick and roster revision. Send a baseline keyed by stable actor IDs on join and resume. Apply compact updates only against the matching revision. Request a fresh baseline when it is missing. Include health, equipped weapon ID, equip tick, active swing ID, move and start tick. A late observer can reconstruct the correct pose immediately.
3. **Acknowledge combat input.** Send an increasing input sequence with equip and attack commands. Predict the attacker’s hand animation immediately. Have the worker deduplicate sequences and return the accepted weapon, move and contact tick or a rejection. Reconcile the cosmetic prediction over a few frames. Resolve the target, cover and damage once on the worker.
4. **Give contacts a bounded history.** Identify each impact with its room epoch, tick and sequence. Keep a short per-room replay buffer. A reconnecting client supplies its last event ID, consumes newer events once and skips expired visual effects. Beyond that buffer, request a baseline. Two attackers hitting the same victim in the same tick must produce distinct IDs. Start with the existing WebSocket transport and measure p95 input acknowledgement, snapshot age, resync counts and bytes per player in 30-player County rooms.

## Rollout checks

Exercise an old bookmarked client, a stable-entry join, a retained invite, and reconnects before and after contact. In two browsers, drop a cosmetic event, swap roster order at equal population, duplicate an attack command, and join midway through a hook. Verify equal health, weapon ID and swing phase after the next baseline. Preserve occupied rooms through promotion. Roll out the catalog check first, then baseline revisions, then input acknowledgement and event replay.
