# Rust arena

Choose Rust in the map picker or open `/?mode=rust` to play the oil yard. The supplied `RUST.glb` provides its geometry. Four Tides replaces City Archive in the picker. `/?level=islands`, old `?level=city` links and `city:` seeds open the islands. A pre-Rust snapshot is retained in `output/backups/procedural-city-preserved.tgz`.

## Geometry and style

The supplied file was about 440 MiB. The game reuses the 96,266 triangles in the 148 meshes of `src/generated/rust-collision.json` for rendering and Rapier collision. Rust projects UVs in world metres and selects materials using the original mesh names. It loads ten WebP color and normal maps (474 KB total) when entering the yard. High graphics quality enables cached sunlight shadows.

The surface maps are adapted from Poly Haven’s [Sandy Gravel](https://polyhaven.com/a/sandy_gravel), [Precast Concrete Wall](https://polyhaven.com/a/precast_concrete_wall), [Corrugated Iron](https://polyhaven.com/a/corrugated_iron), [Rusty Painted Metal](https://polyhaven.com/a/rusty_painted_metal), and [Rusty Metal 02](https://polyhaven.com/a/rusty_metal_02). [CC0 license](https://polyhaven.com/license)

The earlier texture-optimized GLB was moved out of the public directory into `output/backups/rust-textured-optimized.glb`; it is not deployed. Geometry is normalized from centimetres to metres, with ground height and the map center adjusted consistently. The source mannequin is omitted.

## Rebuild

Run `python3 scripts/prepare-rust.py /path/to/RUST.glb`, then `node --import tsx scripts/rust-navigation.ts`. The scripts extract indexed world-space geometry and bake a connected, capsule-validated ground graph. Three existing model ladders have explicit climb/exit volumes in `src/rust.ts`.

Server shots and movement use triangle BVHs through the shared world-ray path. Client movement uses matching Rapier triangle meshes. Procedural city boxes continue using their existing collision path.

## Verification

`tests/rust.test.ts` covers preservation of the procedural map, deterministic arena geometry, ladder exits with server movement validation, clear grounded spawns, matching native/server triangle rays, connected NPC navigation, and NPC spawning on mesh geometry. `scripts/rust-gameplay.mjs` exercises actual keyboard ladder input, shooting, and a grapple attachment in Chromium. Screenshots under `output/playwright/rust-*-final.png` show the final texture-free build.

The initial layout study used the [Activision Rust guide](https://blog.activision.com/ca/fr/call-of-duty/2020-02/Modern-Warfare-Tactical-Map-Intel-Rust). The supplied model superseded the hand-built approximation, which remains in `src/rust-blockout.ts`.

Final live verification: 66 automated tests passed. The public Cloudflare origin served the matching production asset with gzip encoding (595,686 bytes for the main game bundle including map geometry). Two public clients shared Rust and four NPCs; two browser clients also created/joined an invite room, shared the scoreboard, moved, and fired without runtime or WebGL errors. The public health endpoint reports `level: rust`.

## Enlarged arena and desert perimeter

Rust uses a uniform 1.1 environment scale. Vertices, mesh bounds, spawns, navigation nodes, zones, beacons and ladder volumes all use the same transform; player size remains unchanged. The world envelope extends to ±120 metres; the playable arena is enclosed by invisible barriers at the model perimeter. A shared procedural terrain mesh covers 600 × 600 metres, sitting beneath the original yard and gently rising into dunes outside it. The visible ground continues beyond the playable edge into fog.

Rust materials add a small directional grey-blue wash, world-space procedural grain and patina. Ground uses a warmer paper tint. There are still no image-texture downloads. A Rust-only depth-outline adjustment rejects smooth ground slopes to avoid a false thick ink horizon. The minimap expands its view as the player leaves the central yard.

Tests validate the 1.1 scale, ladder/server collision agreement and grounded landings beyond the former map boundary. `scripts/rust-perimeter.mjs` runs outward across the extended ground and captures the yard shading, desert and wider overview. The full regression suite passed 70 tests for this update.


## Invisible arena perimeter

`src/rust-boundary.ts` traces the model's outer concrete walls and fence lines, including the northwest recess and western step, then closes the southern perimeter. Ten overlapping collision boxes extend from -100 to 200 metres in height. The same boxes block Rapier character movement and server swept-movement validation; they are omitted from rendering and cannot be used as grapple targets or wall-run surfaces. The extended desert remains scenery outside the intended arena.

The focused Rust suite checks all ten segments at ground level, 12 metres and 70 metres, including 70 m/s escape attempts and server rejection. The browser perimeter check also drives an airborne player toward the eastern boundary, verifies a stop inside the wall, and checks the exterior scenery using a test-only teleport.

Live perimeter verification: 75 automated tests passed, TypeScript and focused formatting checks passed. Cloudflare served the matching production bundle `index-BHl3vZ4v.js`; two public clients shared Rust with four NPCs. Production browser checks passed pointer lock, sprinting, firing and two-client invite/scoreboard synchronization without runtime or WebGL errors.

## Rust movement without grappling

Rust disables the controller's grapple capability and hides the hook HUD, menu controls, help entries and grapple hints. The server discards anchor state in Rust rooms. Procedural city controllers retain grappling. Focused controller coverage verifies disabled input cannot attach and re-enabled grappling remains functional.

Rust jump height now uses a 0.85 multiplier, applied as the square root to vertical takeoff impulses for standing, momentum, double, wall and ladder jumps. Archive tuning is unchanged. Simulated standing apex is 1.49 m (previously 1.76 m); sprint apex is 3.01 m (previously 3.54 m). Eleven focused jump, air-action and Rust tests passed, alongside TypeScript and the production build.


Ground palette updated to cool off-white (#f2f4f8) with faint blue-gray shading and reduced procedural grain strength, replacing the sandy tint. Geometry and collision are unchanged.

The floor and exterior ground now share the exact same white ink material as the other Rust geometry. The separate ground material and color override were removed.

Floating Rust zone names and ladder CLIMB labels were removed from the scene. HUD navigation and collision are unchanged.

Rust scale increased again from 1.10 to 1.21 (10% larger than the previous map). The shared scale covers rendering, collision, spawns, navigation, ladders and invisible perimeter. Player size and movement tuning are unchanged. All eight focused Rust tests, including ladder traversal and high-speed boundary collision, pass at the new scale.

## Spawn containment and map compatibility

Rust joins and respawns now select only authored spawn points with at least 0.7 m perimeter clearance and server collision clearance. Movement updates also require polygon containment instead of relying solely on the broad world bounds. Rust joins require the client to send the shared map scale; older tabs receive a refresh instruction rather than joining a server with differently scaled geometry. Fifteen focused Rust/public-lobby tests pass, covering mismatched clients, 32 spawn slots and out-of-perimeter correction.
