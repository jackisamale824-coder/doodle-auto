import * as T from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { randomSeed } from "./world.ts";

export type CharacterRole = "civilian" | "police" | "combatant";
const outfits = [
  // Outer layer, undershirt, trousers and shoes.
  [0xb35232, 0xf4dfae, 0x364552, 0x51352c],
  [0x328982, 0xf2dcc8, 0x36495d, 0xc6b399],
  [0xe2a741, 0x424b55, 0x4a5040, 0x664435],
  [0x4c6594, 0xe9cba3, 0x695044, 0x3a3434],
  [0x9b4d70, 0xf2cfc0, 0x393d50, 0xc2a68a],
  [0x71814a, 0xe9bf78, 0x3c4648, 0x5d382b],
];
const complexions = [
  0x754733, 0x965e44, 0xad7450, 0xc58a66, 0xdba27d, 0xe9b99a,
];
const hairColors = [0x241e1c, 0x362622, 0x51372c, 0x74503b, 0xa97748, 0x736c65];

export function characterLook(id: string, role: CharacterRole = "combatant") {
  const random = randomSeed("appearance/" + id);
  const skin = complexions[Math.floor(random() * complexions.length)];
  const hair = hairColors[Math.floor(random() * hairColors.length)];
  const style = Math.floor(random() * 3);
  const [shirt, tee, pants, shoes] =
    role === "police"
      ? [0x344d70, 0x1f2d41, 0x293547, 0x25272c]
      : outfits[Math.floor(random() * outfits.length)];
  return {
    skin,
    hair,
    style,
    shirt,
    tee,
    pants,
    shoes,
    role,
    longSleeves: role === "combatant" || random() > 0.52,
  };
}
export type CharacterLook = ReturnType<typeof characterLook>;

function oval(
  x: number,
  y: number,
  z: number,
  rx: number,
  ry: number,
  rz: number,
) {
  return new T.SphereGeometry(1, 16, 12).scale(rx, ry, rz).translate(x, y, z);
}
function box(x: number, y: number, z: number, w: number, h: number, d: number) {
  return new T.BoxGeometry(w, h, d).translate(x, y, z);
}
// Revolved tailoring profiles close the ends and follow the changing width of each limb.
export function profile(
  rings: [number, number][],
  depth: number,
  start = 0,
  span = Math.PI * 2,
) {
  const geometry = new T.LatheGeometry(
    rings.map(([y, r]) => new T.Vector2(r, y)),
    20,
    start,
    span,
  );
  return geometry.scale(1, 1, depth);
}
type Piece = [T.BufferGeometry, T.ColorRepresentation];
// A face, garment or seated occupant renders in a single draw per rigid part.
export function coloredGeometry(parts: Piece[]) {
  const geometries = parts.map(([geometry, tint]) => {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const color = new T.Color(tint);
    const values = new Float32Array(g.getAttribute("position").count * 3);
    for (let i = 0; i < values.length; i += 3) color.toArray(values, i);
    g.setAttribute("color", new T.BufferAttribute(values, 3));
    return g;
  });
  return mergeGeometries(geometries)!;
}

const headRings: [number, number][] = [
  [-0.151, 0],
  [-0.146, 0.058],
  [-0.119, 0.099],
  [-0.068, 0.131],
  [0.006, 0.151],
  [0.087, 0.153],
  [0.142, 0.137],
  [0.185, 0.096],
  [0.205, 0],
];
export function headGeometry(a: CharacterLook) {
  const lips = new T.Color(a.skin).lerp(new T.Color(0x8e4546), 0.42);
  const face: Piece[] = [
    [profile(headRings, 0.91), a.skin],
    [oval(0, -0.012, 0.13, 0.022, 0.054, 0.027), a.skin],
    [oval(0, -0.038, 0.148, 0.029, 0.02, 0.026), a.skin],
    [oval(0, -0.087, 0.112, 0.043, 0.009, 0.014), lips],
  ];
  for (const side of [-1, 1]) {
    face.push([
      oval(side * 0.145, -0.003, -0.004, 0.025, 0.045, 0.023),
      a.skin,
    ]);
    const eye = oval(0, 0, 0, 0.032, 0.012, 0.009)
      .rotateY(side * 0.39)
      .translate(side * 0.062, 0.024, 0.127);
    face.push(
      [eye, 0xe2d5c3],
      [oval(side * 0.062, 0.024, 0.134, 0.01, 0.01, 0.006), 0x312720],
    );
    const brow = oval(0, 0, 0, 0.038, 0.007, 0.008)
      .rotateZ(-side * 0.08)
      .rotateY(side * 0.4)
      .translate(side * 0.061, 0.049, 0.13);
    face.push([brow, a.hair]);
  }
  // Lower the hairline towards the nape and the temples.
  const cap = new T.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  const pos = cap.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      y = pos.getY(i),
      z = pos.getZ(i);
    const phi = Math.atan2(x, z);
    const hairline = 0.015 + 0.083 * Math.cos(phi) + 0.012 * Math.sin(2 * phi);
    const height = hairline + (0.205 - hairline) * y;
    const upper = headRings.findIndex(([h]) => h >= height);
    const [lo, r0] = headRings[Math.max(0, upper - 1)];
    const [hi, r1] = headRings[upper < 0 ? headRings.length - 1 : upper];
    const radius =
      T.MathUtils.lerp(r0, r1, (height - lo) / (hi - lo)) *
        (a.style === 1 ? 1.105 : 1.045) +
      0.003;
    pos.setXYZ(
      i,
      radius * Math.sin(phi),
      height + 0.007,
      radius * 0.91 * Math.cos(phi),
    );
  }
  cap.computeVertexNormals();
  face.push([cap, a.hair]);
  if (a.role === "police") {
    face.push(
      [oval(0, 0.157, -0.004, 0.17, 0.076, 0.161), a.shirt],
      [oval(0, 0.135, 0.102, 0.151, 0.014, 0.125), a.tee],
      [oval(0, 0.166, 0.147, 0.019, 0.022, 0.005), 0xe1b45f],
    );
  } else if (a.style === 2) {
    face.push([oval(0, 0.064, -0.147, 0.078, 0.081, 0.069), a.hair]);
  } else if (a.style === 1) {
    for (let i = 0; i < 10; i++) {
      const angle = (i * Math.PI) / 5;
      face.push([
        oval(
          0.119 * Math.sin(angle),
          0.135 + 0.025 * Math.cos(angle),
          0.111 * Math.cos(angle),
          0.047,
          0.045,
          0.044,
        ),
        a.hair,
      ]);
    }
  }
  return coloredGeometry(face);
}

export function torsoGeometry(a: CharacterLook) {
  const coat = profile(
    [
      [0.759, 0],
      [0.759, 0.205],
      [0.78, 0.202],
      [0.91, 0.181],
      [1.09, 0.21],
      [1.21, 0.248],
      [1.26, 0.236],
      [1.305, 0.14],
      [1.32, 0.091],
      [1.32, 0],
    ],
    0.73,
  );
  const parts: Piece[] = [
    [coat, a.shirt],
    [
      profile(
        [
          [1.285, 0.082],
          [1.39, 0.078],
          [1.454, 0.092],
        ],
        0.94,
      ),
      a.skin,
    ],
    [
      profile(
        [
          [1.292, 0.112],
          [1.324, 0.1],
        ],
        0.94,
      ),
      a.tee,
    ],
    [oval(0, 0.716, 0, 0.204, 0.103, 0.145), a.pants],
    [
      profile(
        [
          [0.739, 0.209],
          [0.769, 0.207],
        ],
        0.75,
      ),
      0x493e39,
    ],
    [box(0, 0.754, 0.157, 0.047, 0.029, 0.008), 0x998876],
  ];
  if (a.role === "police") {
    for (const side of [-1, 1])
      parts.push([box(side * 0.102, 1.118, 0.145, 0.069, 0.023, 0.014), a.tee]);
    parts.push([oval(0.1, 1.182, 0.15, 0.025, 0.032, 0.009), 0xe4b95b]);
  } else if (a.longSleeves) {
    // The undershirt follows the front of an open jacket as the chest tapers.
    const inset = profile(
      [
        [0.776, 0.204],
        [0.91, 0.184],
        [1.09, 0.213],
        [1.21, 0.251],
        [1.26, 0.239],
        [1.305, 0.143],
        [1.32, 0.094],
      ],
      0.74,
      -0.31,
      0.62,
    );
    parts.push([inset, a.tee]);
  } else {
    parts.push([
      box(0.105, 1.115, 0.144, 0.071, 0.084, 0.009),
      new T.Color(a.shirt).multiplyScalar(0.77),
    ]);
  }
  if (a.role === "police" || a.longSleeves) {
    const collar = new T.Color(a.shirt).multiplyScalar(0.66);
    for (const side of [-1, 1]) {
      const flap = new T.BufferGeometry();
      const corners = [
        side * 0.016,
        1.295,
        0.108,
        side * 0.09,
        1.302,
        0.086,
        side * 0.092,
        1.222,
        0.173,
      ];
      corners.push(
        ...corners.slice(6),
        ...corners.slice(3, 6),
        ...corners.slice(0, 3),
      );
      flap.setAttribute("position", new T.Float32BufferAttribute(corners, 3));
      flap.setAttribute(
        "uv",
        new T.Float32BufferAttribute(new Float32Array(12), 2),
      );
      flap.computeVertexNormals();
      parts.push([flap, collar]);
    }
  }
  return coloredGeometry(parts);
}
