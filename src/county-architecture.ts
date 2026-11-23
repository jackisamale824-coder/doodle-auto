import type { Box } from "./world.ts";

export type Facade = "works" | "shops" | "homes" | "glass" | "civic" | "clock";
export interface CityMass extends Box {
  frontage: Facade;
  sign?: string;
}
export function isCityMass(box: Box): box is CityMass {
  return box.kind === "building" && "frontage" in box;
}

// Each occupied volume is also a collision hull. Upper floors and roofs use
// world heights so the rendered terraces are reachable with the usual traversal.
export function cityLot(
  x: number,
  z: number,
  design: number,
  variation: number,
): Box[] {
  const boxes: Box[] = [];
  const mass = (
    dx: number,
    dz: number,
    w: number,
    d: number,
    bottom: number,
    top: number,
    frontage: Facade,
    sign?: string,
  ) => {
    const block: CityMass = {
      p: [x + dx, (top + bottom) / 2, z + dz],
      s: [w, top - bottom, d],
      kind: "building",
      solid: true,
      frontage,
      sign,
    };
    boxes.push(block);
  };
  function pitched(
    dx: number,
    w: number,
    d: number,
    base: number,
    rise: number,
    ridge: number,
  ) {
    const l = x + dx - w / 2,
      r = l + w,
      peak = l + w * ridge,
      f = z + d / 2,
      b = z - d / 2;
    const vertices = [
      l,
      base,
      f,
      r,
      base,
      f,
      peak,
      base + rise,
      f,
      l,
      base,
      b,
      r,
      base,
      b,
      peak,
      base + rise,
      b,
    ];
    boxes.push({
      p: [x + dx, base + rise / 2, z],
      s: [w, rise, d],
      kind: "county-roof",
      solid: true,
      mesh: {
        vertices,
        indices: [
          0, 1, 2, 5, 4, 3, 0, 2, 5, 0, 5, 3, 2, 1, 4, 2, 4, 5, 0, 3, 4, 0, 4,
          1,
        ],
      },
    });
  }
  const floors = Math.floor(variation * 3);
  switch (design) {
    case 6:
      mass(-7, -5, 9, 8, 0, 3.8, "shops", "KIOSK");
      break;
    case 0: // Sawtooth works, a boiler house and a freestanding stack.
      mass(-3, 0, 23, 23, 0, 8, "works", "IRONWORKS");
      for (let i = 0; i < 3; i++)
        pitched(-3 + (i - 1) * 7.66, 7.66, 23, 8, 3.7, 0.86);
      mass(10, -3, 3.2, 3.2, 0, 21 + floors * 2, "works");
      break;
    case 1: // Narrow pitched row houses and alternating front setbacks.
      for (let i = 0; i < 3; i++) {
        const dx = (i - 1) * 9.2,
          h = 7 + ((floors + i) % 3) * 2;
        mass(dx, 0, 8.8, 15 + i, 0, h, "homes");
        pitched(dx, 8.8, 15 + i, h, 3.8, 0.5);
        for (let j = 0; j < 2; j++)
          boxes.push({
            p: [
              x + dx + 1.25,
              0.15 + j * 0.13,
              z + (15 + i) / 2 + 0.82 - j * 0.43,
            ],
            s: [2.4, 0.3 + j * 0.26, 0.8],
            kind: "pavement",
            solid: true,
          });
      }
      break;
    case 2: // A street-level arcade with a set-back apartment wing.
      mass(
        0,
        0,
        29,
        23,
        0,
        4.8,
        "shops",
        variation > 0.5 ? "CENTRAL MARKET" : "ARCADE",
      );
      mass(-6, -3, 15, 15, 4.8, 16 + 4 * floors, "homes");
      break;
    case 3: // A low theatre, tall fly tower and a projecting entrance.
      mass(0, -4, 25, 17, 0, 12, "civic");
      mass(0, 8, 23, 7, 0, 6.5, "shops", "CINEMA");
      mass(-6, -6, 9, 10, 12, 18 + floors, "civic");
      break;
    case 4: {
      // Slim glass office above a wide podium and a stepped crown.
      const h = 27 + floors * 10;
      mass(0, 0, 28, 24, 0, 7, "shops", "EXCHANGE");
      mass(2, -1, 18, 17, 7, h, "glass");
      mass(2, -2, 13, 12, h, h + 6, "glass");
      break;
    }
    default: // An asymmetric civic hall with a clock above the entrance.
      mass(-4, 0, 19, 22, 0, 9, "civic", "TOWN HALL");
      pitched(-4, 19, 22, 9, 4, 0.5);
      mass(9, 5, 7, 8, 0, 18, "civic");
      mass(9, 5, 7.3, 8.3, 18, 24, "clock");
      // The roof is centered on the clock tower's own footprint.
      mass(9, 5, 5.5, 6, 24, 26, "civic");
  }
  return boxes;
}
