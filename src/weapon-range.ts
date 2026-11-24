import * as T from "three";
import { label } from "./render.ts";
import { FISTS } from "./fists.ts";
import { WEAPONS, loadoutSlots } from "./weapon-balance.ts";
import type { Box, City } from "./world.ts";
import "./weapon-range.css";

const plates = [
  { x: -3, distance: 3, size: 1.1 },
  { x: 0, distance: 12, size: 1.8 },
  { x: 6, distance: 30, size: 2.4 },
  { x: -9, distance: 55, size: 3.2 },
];
export function rangeWorld(): City {
  const boxes: Box[] = [
    { p: [0, -0.5, -24], s: [42, 1, 88], kind: "ground", solid: true },
    { p: [0, 4, -64], s: [42, 8, 1], kind: "metal", solid: true },
    ...[-21, 21].map((x): Box => ({
      p: [x, 1.5, -24],
      s: [0.5, 3, 88],
      kind: "metal",
      solid: true,
    })),
  ];
  for (const [index, t] of plates.entries()) {
    boxes.push({
      p: [t.x, 1.6, -t.distance],
      s: [t.size, t.size, 0.15],
      kind: "metal",
      solid: true,
      pieceId: index,
    });
    boxes.push({
      p: [t.x, 0.7, -t.distance],
      s: [0.14, 1.4, 0.12],
      kind: "metal",
      solid: true,
    });
    boxes.push({
      p: [0, 0.01, -t.distance],
      s: [40, 0.02, 0.09],
      kind: "mark",
      solid: false,
    });
  }
  return {
    seed: "weapon-test",
    district: 1,
    boxes,
    bounds: 65,
    spawns: [[0, 0.08, 0]],
    buildings: [],
    beacons: [],
    nodes: [],
    links: [],
    streetNodes: [],
    roofLinks: [],
    dressing: [],
    bridges: [],
    blimps: [],
    platforms: [],
    aerialLinks: [],
    aerialEntries: [],
    flightCeiling: 60,
    plan: { streets: [], blocks: [], parcels: [], landmarks: [], bridges: [] },
  };
}
export function drawRange(group: T.Group) {
  for (const t of plates) {
    const face = new T.Group();
    face.position.set(t.x, 1.6, -t.distance + 0.081);
    // Concentric paper targets share the same position as the simulated panels.
    [0.46, 0.36, 0.25, 0.12].forEach((radius, i) => {
      const disc = new T.Mesh(
        new T.CircleGeometry(radius * t.size, 48),
        new T.MeshBasicMaterial({
          color: [0x29404c, 0xf4dfae, 0x29404c, 0xde603a][i],
        }),
      );
      disc.position.z = i * 0.003;
      face.add(disc);
    });
    const distance = label(t.distance + " m", 256, "#f9edcf", "#263c46");
    distance.position.y = t.size * 0.5 + 0.38;
    distance.scale.setScalar(0.6);
    face.add(distance);
    group.add(face);
  }
}

export function weaponRack(current: number) {
  const groups = loadoutSlots.map((slot) => ({
    name: slot.name,
    ids: slot.key === "utility" ? [FISTS, ...slot.options] : slot.options,
  }));
  return `<section class="range-rack">
    <header><div><span class="range-brand">Doodle Auto</span><h2>Weapon test range</h2></div><a href="./">Back to game ↗</a></header>
    <p>Choose a weapon to enter the range with a full magazine.</p>
    ${groups
      .map(
        ({ name, ids }) =>
          `<section><h3>${name}</h3><div class="range-grid">${ids
            .map(
              (id) =>
                `<button type="button" data-range-weapon="${id}" aria-pressed="${id === current}">
        ${id === FISTS ? '<span class="range-fist" aria-hidden="true">✊</span>' : `<img alt="" src="${import.meta.env.BASE_URL}loadout/weapon-${id}.webp">`}
        <strong>${WEAPONS[id].name}</strong></button>`,
            )
            .join("")}</div></section>`,
      )
      .join("")}
    <footer><span><kbd>B</kbd> Weapon rack</span><span><kbd>Scroll</kbd> Cycle weapons</span><span><kbd>R</kbd> Reload / restock</span></footer>
  </section>`;
}
