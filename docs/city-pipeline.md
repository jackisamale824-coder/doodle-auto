# Bounded city generation

The game generates one finite, deterministic district at a time. It uses a stable arterial cross, variable block widths, and neighborhood-specific infill. It deliberately does not attempt infinite streaming, a full tensor-field road-growth solver, or a GIS simulation.

## Stages and contracts

1. `src/city-plan.ts` defines four neighborhoods: low industrial Inkworks, retail Old Paper Market, residential Bluebird Heights, and the taller Press Quarter. Each owns a building kit, height range, setback and map accent.
2. A connected rectilinear arterial/local street graph defines sixty-four blocks. The arterial cross and training plaza remain fixed. Other road coordinates vary by district seed, with minimum block sizes enforced by construction.
3. Frontage-preserving block splits create parcels. Every parcel records its block, neighborhood, street edge and facing. Every block has two street-facing rows of two parcels, separated by a continuous rear alley. This is a constrained rectangular split, not a general polygon solver.
4. The existing modular building kit generates real doors, windows, floors, collision-checked interior stairways and roofs. Door, sign, awning and fire-escape orientation follow parcel frontage. All buildings remain enterable. Ground is one continuous collider; road and pavement markings are presentation surfaces without curb-height collision lips.
5. Frontage operators place streetlights, residential trees, cars and cover away from door approaches. Rendered prop placement and collision hulls consume the same records. Parked cars run parallel to the street.
6. AI uses the connected street/interior navigation graph. Spawns and pickups use graph positions. A separate rooftop graph rejects occluded links, excessive height differences and out-of-range connections; it classifies short level crossings as jumps and others as grapple opportunities. It describes opportunities, not an automatic parkour path solver.
7. The HUD map consumes the same streets, building footprints and rooftop links, and labels the nearest neighborhood. Objective marks are selected from the tallest buildings in three neighborhoods.

## Regional changes and authored exceptions

`generateCity(seed, district, overrides)` accepts:

```ts
{
  blockSeeds: { "block-0-0": "infill-revision-2" },
  buildings: {
    "block-1-0-lot-0": { name: "THE SAFEHOUSE", floors: 3 }
  }
}
```

Independent block seeds vary local floor choices without altering streets or neighboring building records. Named building overrides survive those local changes. Heights are bounded to one through sixteen floors. Paired bridge buildings use stable shared elevations, independent of local infill seeds; authored buildings are excluded from automatic pairing. This API regenerates the city data deterministically; selective renderer hot-swapping, persisted editor UI, arbitrary mission-volume imports, and on-demand collision streaming are not implemented.

## Validation

Automated checks cover twelve seeds for graph connectivity, unobstructed frontage, clear multiplayer spawns and rooftop opportunities; authored override preservation; parcel separation; and a real Rapier controller walking every building's interior route to the roof. The default notebook seed produces 256 buildings across 64 blocks in a 584 by 584 metre playable area, with taller office blocks and lower industrial parcels. Building footprints cover about 51 percent of the playable area. Counts are computed by the pipeline and shown dynamically in the menu.

Browser fixtures that previously assumed the old grid now derive entrances and stair routes from generated building records. The protected training plaza retains its deliberate vault obstacles.

Nearby geometry is grouped spatially, keeping each building intact. Beyond 145 metres from a cell center, detailed modules switch to inexpensive building massing. Collision remains resident across the full city. Static cell indexes accelerate stance-clearance and rooftop-connection checks. The HUD map and multiplayer position limits use generated world bounds.


## Aerial routes

The height hierarchy rises from 2–3 floor industrial blocks through 3–5 floor markets and 5–9 floor housing to 8–12 floor offices and 16-floor landmark towers. Deterministic building pairs share roof elevations. Solid 2.6-metre sky-bridges span rear alleys and selected streets, with rails and landings aligned to roof parapet openings. Their endpoints also join the navigation graph.

Twelve solid floating platforms occupy the arterial airspace at staggered heights. Twelve blimps orbit above nearby rooftops with gold grapple rings. Blimp envelopes are visual objects; their rings are moving grapple targets, not rideable collision bodies. Use platforms and rooftops to land. Hook selection respects nearer solid occluders, attached anchors follow their targets, and rope tension uses relative velocity. Releasing retains the player's current momentum.

Blimp trajectories are deterministic functions of shared wall-clock seconds, corrected from server snapshots online. Position and analytic velocity remain continuous across hour boundaries. Bridges and moving rings are marked in gold on the map.
