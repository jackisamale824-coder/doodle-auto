# doodlesCreed — approved design

The user approved full implementation on 2026-09-07, including a visual comparison loop and gameplay tests.

Build an original desktop browser first-person ink-on-paper parkour shooter. Use TypeScript, Three.js, Vite, Rapier collision geometry, and a Node WebSocket server. Retain swinging grapples, arcade weapons, and NPC combat inspired by the reference's publicly served JavaScript, without copying its code or assets.

Generate deterministic cities from seeds and district numbers: streets, lots, realistically grouped building variants, navigable interiors, stairs, rooftops, fire escapes, alleys, rooftop routes and street props. Every building has an entrance and roof route. Single-player contracts require enemy eliminations and rooftop beacons before district extraction; include free-roam practice. Movement preserves momentum across running, vaults, wall runs/jumps, slides, ledge mantles and rope release. Swept/substepped collision prevents tunneling.

Multiplayer uses room codes, a shared seed, synchronized avatars, server-owned health/scores and validated fire events. FFA supports up to eight players; solo NPC simulation remains local. Disconnections and full/invalid rooms must show usable errors. No accounts or paid dependencies.

Art direction: warm paper, blue ballpoint architectural outlines and diagonal hatch shading, red doodle enemies, restrained yellow accents, hand-lettered title and HUD. Include settings, instructions, sound, pause/restart, persistence, and responsive menus; gameplay targets desktop keyboard/mouse.

Validation: deterministic generator and clearance tests; physical movement tests including ceilings, sprint momentum, grapple release, vault and wall jump; real WebSocket integration tests; production build; browser screenshots of reference and implementation, visual iteration, keyboard/mouse play checks, and a two-browser multiplayer test.
