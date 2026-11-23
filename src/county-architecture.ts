import type { Ladder } from "./rust-blockout.ts";
import type { Box, V3 } from "./world.ts";

export type Facade = "works" | "shops" | "homes" | "glass" | "civic" | "clock";
type Piece = NonNullable<Box["piece"]>;
export interface CountyPiece extends Box {
  piece: Piece;
  buildingId: string;
  frontage: Facade;
  face?: "front" | "back" | "left" | "right";
  sign?: string;
  ladder?: Ladder;
  closedDoor?: { p: V3; s: V3 };
}
export function isCountyPiece(box: Box): box is CountyPiece {
  return !!box.piece && "frontage" in box;
}

export function architectureLadders(boxes: Box[]) {
  return boxes.flatMap((box) =>
    isCountyPiece(box) && box.ladder ? [box.ladder] : [],
  );
}

interface Storey {
  x: number;
  z: number;
  w: number;
  d: number;
  base: number;
  top: number;
  style: Facade;
}
interface Wing {
  dx: number;
  dz: number;
  w: number;
  d: number;
  top: number;
  floors: number;
  style: Facade;
}
interface ShellOptions {
  sign?: string;
  pitch?: { bays: number; rise: number; ridge: number };
  frontPortal?: boolean;
  backPortal?: boolean;
  theatre?: boolean;
  stoop?: boolean;
}

// Wall panels, glass, fittings and slabs are ordinary world boxes. The same
// array therefore defines client collision, hits on the server and rendering.
export function cityLot(
  x: number,
  z: number,
  design: number,
  variation: number,
): CountyPiece[] {
  const pieces: CountyPiece[] = [];
  const tier = Math.min(2, Math.floor(variation * 3));
  const shell = (id: string, wings: Wing[], options: ShellOptions = {}) => {
    const buildingId = `${x},${z}/${id}`;
    const storeys: Storey[] = [];
    let base = 0.2;
    for (const wing of wings) {
      const h = (wing.top - base) / wing.floors;
      for (let f = 0; f < wing.floors; f++)
        storeys.push({
          x: x + wing.dx,
          z: z + wing.dz,
          w: wing.w,
          d: wing.d,
          base: base + f * h,
          top: base + (f + 1) * h,
          style: wing.style,
        });
      base = wing.top;
    }

    let arriving: Ladder | undefined;
    for (const [index, room] of storeys.entries()) {
      const landing = arriving;
      const { x: cx, z: cz, w, d, base, top, style } = room;
      const thick = 0.26,
        slab = 0.2;
      const left = cx - w / 2,
        right = cx + w / 2;
      const rear = cz - d / 2,
        front = cz + d / 2;
      const ceiling = top - slab;
      const add = (piece: Piece, kind: string, p: V3, s: V3) => {
        const box: CountyPiece = {
          piece,
          kind,
          p,
          s,
          solid: true,
          buildingId,
          frontage: style,
        };
        if (piece === "door") box.closedDoor = { p: [...p], s: [...s] };
        pieces.push(box);
        return box;
      };
      // Lower storeys supply the walking surface for the next one, including
      // their accessible terraces at setbacks. Only the first needs a foundation.
      if (!index) add("floor", "foundation", [cx, base / 2, cz], [w, base, d]);

      const doorWidth = Math.min(1.85, w * 0.36);
      const doorHeight = Math.min(2.48, ceiling - base - 0.2);
      function side(
        face: NonNullable<CountyPiece["face"]>,
        entry = false,
        portal = false,
      ) {
        const alongX = face === "front" || face === "back";
        const fixed =
          face === "front"
            ? front - thick / 2
            : face === "back"
              ? rear + thick / 2
              : face === "left"
                ? left + thick / 2
                : right - thick / 2;
        const lo = alongX ? left : rear + thick;
        const hi = alongX ? right : front - thick;
        function panel(
          start: number,
          end: number,
          y0: number,
          y1: number,
          glass = false,
        ) {
          if (end - start < 0.02 || y1 - y0 < 0.02) return;
          const length = end - start,
            mid = (start + end) / 2;
          const thickness = glass ? 0.08 : thick;
          const b = add(
            glass ? "fixture" : "wall",
            glass ? "window" : "exterior",
            [alongX ? mid : fixed, (y0 + y1) / 2, alongX ? fixed : mid],
            [alongX ? length : thickness, y1 - y0, alongX ? thickness : length],
          );
          b.face = face;
        }
        let end = hi;
        if (entry || portal) {
          const openingRight = cx + doorWidth / 2;
          panel(openingRight, hi, base, ceiling);
          panel(cx - doorWidth / 2, openingRight, base + doorHeight, ceiling);
          if (!portal)
            add(
              "door",
              "entry-door",
              [cx, base + doorHeight / 2, fixed],
              [doorWidth, doorHeight, 0.13],
            );
          end = cx - doorWidth / 2;
        }
        // A glazed opening has its own hit volume, with a solid sill and lintel.
        // Exposed edges and wide stretches of masonry stay independently breakable.
        const span = end - lo;
        if (span < 2.2) {
          panel(lo, end, base, ceiling);
          return;
        }
        const panes = Math.max(1, Math.round(span / 8));
        for (let i = 0; i < panes; i++) {
          const start = lo + (span * i) / panes,
            stop = lo + (span * (i + 1)) / panes;
          const inset = Math.min(1.1, (stop - start) * 0.17);
          const l = start + inset,
            r = stop - inset;
          const sill =
            base + (style === "shops" || style === "glass" ? 0.65 : 1.04);
          const head = Math.min(
            ceiling - 0.26,
            sill + (style === "civic" ? 2.2 : 1.7),
          );
          panel(start, l, base, ceiling);
          panel(l, r, base, sill);
          panel(l, r, sill, head, true);
          panel(l, r, head, ceiling);
          panel(r, stop, base, ceiling);
        }
      }
      const prev = storeys[index - 1];
      const terraceEntry = !!prev && front < prev.z + prev.d / 2 - 1.6;
      side("front", !index || terraceEntry, !index && options.frontPortal);
      side("back", false, !index && options.backPortal);
      side("left");
      side("right");

      const upper = storeys[index + 1];
      const access = !!upper || !options.pitch;
      const cover = upper ? "floor" : "roof";
      const deck = (x0: number, x1: number, z0: number, z1: number) => {
        if (x1 - x0 > 0.01 && z1 - z0 > 0.01)
          add(
            cover,
            upper ? "upper-floor" : "flat-roof",
            [(x0 + x1) / 2, top - slab / 2, (z0 + z1) / 2],
            [x1 - x0, slab, z1 - z0],
          );
      };
      let ladderX = Infinity,
        ladderZ = Infinity;
      if (access) {
        const target = upper ?? room;
        // Alternating sides leave a landing at the foot of the next flight.
        ladderX =
          target.x + (index % 2 ? -1 : 1) * Math.max(0, target.w / 2 - 1.55);
        ladderZ = target.z - target.d / 2 + 1.72;
        deck(left, ladderX - 0.92, rear, front);
        deck(ladderX + 0.92, right, rear, front);
        deck(ladderX - 0.92, ladderX + 0.92, rear, ladderZ - 0.9);
        deck(ladderX - 0.92, ladderX + 0.92, ladderZ + 0.9, front);
        const ladder = add(
          "fixture",
          "ladder",
          [ladderX, (top + base) / 2, ladderZ - 0.6],
          [0.78, top - base, 0.085],
        );
        arriving = ladder.ladder = {
          x: ladderX,
          z: ladderZ,
          bottom: base,
          get top() {
            return ladder.solid ? top : base;
          },
          exit: [ladderX, top + 0.08, ladderZ + 1.4],
        };
      } else {
        deck(left, cx, rear, front);
        deck(cx, right, rear, front);
      }

      if (w >= 7 && d >= 10 && !options.theatre) {
        const partitionZ = cz - 0.02 * d,
          opening = 1.56;
        const mid = (left + thick + cx - opening / 2) / 2;
        const length = cx - opening / 2 - left - thick;
        add(
          "wall",
          "partition",
          [mid, (base + ceiling) / 2, partitionZ],
          [length, ceiling - base, 0.15],
        );
        add(
          "wall",
          "partition",
          [2 * cx - mid, (base + ceiling) / 2, partitionZ],
          [length, ceiling - base, 0.15],
        );
        add(
          "door",
          "room-door",
          [cx, base + doorHeight / 2, partitionZ],
          [opening, doorHeight, 0.11],
        );
        add(
          "wall",
          "partition",
          [cx, (base + doorHeight + ceiling) / 2, partitionZ],
          [opening, ceiling - base - doorHeight, 0.15],
        );
      }
      if (w >= 7 && d >= 10 && !options.theatre) {
        add(
          "fixture",
          "framed-print",
          [cx - w * 0.28, base + 1.62, cz - 0.02 * d + 0.12],
          [1.25, 0.9, 0.075],
        );
      }
      const furnishing = (
        kind: string,
        px: number,
        pz: number,
        sw: number,
        sh: number,
        sd: number,
      ) => {
        // Leave the arrival shaft and the step off its lip clear on this floor
        // as well as the approach to the next flight.
        const paths = [[ladderX, ladderZ]];
        if (landing) paths.push([landing.x, landing.z]);
        if (
          paths.some(
            ([lx, lz]) =>
              Math.abs(px - lx) < sw / 2 + 0.46 &&
              pz + sd / 2 > lz - 0.45 &&
              pz - sd / 2 < lz + 1.86,
          )
        )
          return;
        add("furniture", kind, [px, base + sh / 2, pz], [sw, sh, sd]);
      };
      const lx = left + Math.min(w * 0.24, 2.35),
        rx = 2 * cx - lx;
      const near = cz + 0.26 * d,
        far = cz - 0.22 * d;
      if (options.theatre && !index) {
        for (let row = 0; row < 3; row++)
          for (const px of [cx - w * 0.24, cx + w * 0.24])
            furnishing(
              "theatre-seats",
              px,
              cz + (row - 1) * 2.45,
              w * 0.27,
              1.06,
              0.88,
            );
        add(
          "fixture",
          "screen",
          [cx, base + 3.1, rear + 0.44],
          [w * 0.62, 3.25, 0.17],
        );
      } else if (w < 6) {
        furnishing("cabinet", left + 0.67, near, 0.66, 1.28, 0.6);
      } else if (style === "homes") {
        furnishing("sofa", lx, near, 2.12, 0.98, 0.93);
        furnishing("bed", rx, far, 1.5, 0.82, 2.12);
        furnishing("cabinet", left + 0.8, far, 0.8, 1.38, 0.65);
      } else if (style === "works") {
        furnishing("workbench", lx, near, 3, 1.05, 1.18);
        furnishing("machine", rx, far, 2.4, 1.87, 1.36);
        furnishing("cabinet", rx, near, 1.25, 1.65, 0.72);
      } else if (style === "shops") {
        furnishing("counter", lx, near, Math.min(3.25, w * 0.34), 1.05, 0.93);
        furnishing("shelving", rx, far, Math.min(2.8, w * 0.27), 1.78, 0.75);
        if (w > 10) furnishing("shelving", lx, far, 2.82, 1.78, 0.75);
      } else {
        furnishing(
          style === "glass" ? "desk" : "bench",
          lx,
          near,
          Math.min(2.8, w * 0.3),
          0.88,
          0.95,
        );
        furnishing(
          style === "glass" ? "cabinet" : "lectern",
          rx,
          far,
          1.14,
          1.2,
          0.82,
        );
      }
      add(
        "fixture",
        "ceiling-light",
        [cx, ceiling - 0.055, near],
        [Math.min(1.75, w * 0.25), 0.11, 0.34],
      );
      if (!index && options.sign) {
        const h = Math.min(0.78, ceiling - base - doorHeight - 0.08);
        add(
          "fixture",
          "sign",
          [cx, base + doorHeight + 0.05 + h / 2, front + 0.08],
          [Math.min(w * 0.68, 11.4), h, 0.19],
        ).sign = options.sign;
      }
      if (!index && options.stoop)
        add("floor", "stoop", [cx, 0.095, front + 0.5], [2.48, 0.19, 1]);
    }
    if (options.pitch) {
      const { bays, rise, ridge } = options.pitch;
      const r = storeys[storeys.length - 1];
      for (let i = 0; i < bays; i++) {
        const w = r.w / bays,
          l = r.x - r.w / 2 + w * i,
          peak = l + w * ridge,
          f = r.z + r.d / 2,
          b = r.z - r.d / 2,
          t = r.top;
        pieces.push({
          p: [l + w / 2, t + rise / 2, r.z],
          s: [w, rise, r.d],
          piece: "roof",
          kind: "county-roof",
          buildingId,
          frontage: r.style,
          solid: true,
          mesh: {
            vertices: [
              l,
              t,
              f,
              l + w,
              t,
              f,
              peak,
              t + rise,
              f,
              l,
              t,
              b,
              l + w,
              t,
              b,
              peak,
              t + rise,
              b,
            ],
            indices: [
              0, 1, 2, 5, 4, 3, 0, 2, 5, 0, 5, 3, 2, 1, 4, 2, 4, 5, 0, 3, 4, 0,
              4, 1,
            ],
          },
        });
      }
    }
  };
  const wing = (
    dx: number,
    dz: number,
    w: number,
    d: number,
    top: number,
    floors: number,
    style: Facade,
  ): Wing => ({ dx, dz, w, d, top, floors, style });
  switch (design) {
    case 0:
      shell("works", [wing(-3, 0, 23, 23, 8, 2, "works")], {
        sign: "IRONWORKS",
        pitch: { bays: 3, rise: 3.7, ridge: 0.86 },
      });
      shell("boiler", [wing(11, -3, 4.6, 5, 21 + tier * 2, 4, "works")]);
      break;
    case 1:
      for (let i = 0; i < 3; i++) {
        const h = 7 + ((tier + i) % 3) * 2;
        shell(
          "house-" + i,
          [wing((i - 1) * 9.2, 0, 8.8, 15 + i, h, 2, "homes")],
          { stoop: true, pitch: { bays: 1, rise: 3.8, ridge: 0.5 } },
        );
      }
      break;
    case 2:
      shell(
        "market",
        [
          wing(0, 0, 29, 23, 4.8, 1, "shops"),
          wing(-6, -3, 15, 15, 16 + 4 * tier, 3 + tier, "homes"),
        ],
        { sign: variation > 0.5 ? "CENTRAL MARKET" : "ARCADE" },
      );
      break;
    case 3:
      shell("cinema", [wing(0, 8, 23, 7, 6.5, 1, "shops")], {
        sign: "CINEMA",
        backPortal: true,
      });
      shell(
        "cinema",
        [
          wing(0, -4, 25, 17, 12, 2, "civic"),
          wing(-6, -6, 9, 10, 18 + tier, 1, "civic"),
        ],
        { frontPortal: true, theatre: true },
      );
      break;
    case 4: {
      const h = 27 + tier * 10;
      shell(
        "exchange",
        [
          wing(0, 0, 28, 24, 7, 1, "shops"),
          wing(2, -1, 18, 17, h, 5 + tier * 2, "glass"),
          wing(2, -2, 13, 12, h + 6, 1, "glass"),
        ],
        { sign: "EXCHANGE" },
      );
      break;
    }
    case 5:
      shell("hall", [wing(-4, 0, 19, 22, 9, 2, "civic")], {
        sign: "TOWN HALL",
        pitch: { bays: 1, rise: 4, ridge: 0.5 },
      });
      shell("clock", [
        wing(9, 5, 7, 8, 18, 4, "civic"),
        wing(9, 5, 7, 8, 24, 1, "clock"),
      ]);
      break;
    default:
      shell("kiosk", [wing(-7, -5, 9, 8, 3.8, 1, "shops")], { sign: "KIOSK" });
  }
  return pieces;
}
