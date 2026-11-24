import { randomSeed, type Box, type City, type V3 } from "./world.ts";

export const ISLANDS = "four-tides";
export const SEA_LEVEL = -2.25;
type Point = [number, number];
export const islands = [
  {
    name: "Compass Cay",
    x: 0,
    z: 0,
    radius: 14,
    land: "#9cba71",
    cliff: "#8e8992",
  },
  {
    name: "Frostpine Ridge",
    x: 0,
    z: -48,
    radius: 18,
    land: "#e4f1f1",
    cliff: "#668baa",
  },
  {
    name: "Lantern Quay",
    x: 48,
    z: 0,
    radius: 18,
    land: "#dfa666",
    cliff: "#aa8266",
  },
  {
    name: "Ember Caldera",
    x: 0,
    z: 48,
    radius: 18,
    land: "#92675b",
    cliff: "#645762",
  },
  {
    name: "Shipwreck Cove",
    x: -48,
    z: 0,
    radius: 18,
    land: "#f3c572",
    cliff: "#bc9671",
  },
];
export const crossings: Point[] = [
  [0, 1],
  [0, 2],
  [0, 3],
  [0, 4],
  [1, 2],
  [2, 3],
  [3, 4],
  [4, 1],
];
export function coastline(id: number, scale = 1): Point[] {
  const { x, z, radius } = islands[id];
  return Array.from({ length: 28 }, (_, i) => {
    const a = (i * Math.PI) / 14;
    const r =
      scale *
      radius *
      (1 + 0.059 * Math.sin(3 * a + id) + 0.044 * Math.cos(7 * a - id));
    return [x + r * Math.cos(a), z + r * Math.sin(a)];
  });
}

export function islandWorld(district = 1): City {
  const boxes: Box[] = [];
  const nodes: V3[] = islands.map(({ x, z }) => [x, 0.075, z]);
  const links: Point[] = [];
  function mesh(
    vertices: number[],
    indices: number[],
    ink: string,
    solid: boolean,
  ) {
    const min: V3 = [Infinity, Infinity, Infinity],
      max: V3 = [-Infinity, -Infinity, -Infinity];
    vertices.forEach((v, i) => {
      const axis = i % 3;
      min[axis] = Math.min(min[axis], v);
      max[axis] = Math.max(max[axis], v);
    });
    const p: V3 = [0, 0, 0],
      s: V3 = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      p[i] = (min[i] + max[i]) / 2;
      s[i] = max[i] - min[i];
    }
    boxes.push({
      kind: "island",
      p,
      s,
      mesh: { vertices, indices },
      ink,
      solid,
    });
  }
  function prism(
    base: Point[],
    top: Point[],
    bottom: number,
    height: number,
    ink: string,
    solid = true,
  ) {
    const vertices: number[] = [],
      indices: number[] = [],
      n = base.length;
    for (const [ring, y] of [
      [base, bottom],
      [top, bottom + height],
    ] as const)
      for (const [x, z] of ring) vertices.push(x, y, z);
    for (const [ring, y] of [
      [base, bottom],
      [top, bottom + height],
    ] as const)
      vertices.push(
        ring.reduce((sum, p) => sum + p[0], 0) / n,
        y,
        ring.reduce((sum, p) => sum + p[1], 0) / n,
      );
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      indices.push(
        2 * n,
        i,
        j,
        2 * n + 1,
        n + j,
        n + i,
        i,
        n + i,
        n + j,
        i,
        n + j,
        j,
      );
    }
    mesh(vertices, indices, ink, solid);
  }
  function box(
    x: number,
    z: number,
    y: number,
    w: number,
    h: number,
    d: number,
    ink: string,
    yaw = 0,
    solid = true,
  ) {
    const ring: Point[] = [
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
      [w / 2, d / 2],
      [-w / 2, d / 2],
    ].map(([dx, dz]) => [
      x + dx * Math.cos(yaw) + dz * Math.sin(yaw),
      z - dx * Math.sin(yaw) + dz * Math.cos(yaw),
    ]);
    prism(ring, ring, y, h, ink, solid);
  }
  function cone(
    x: number,
    z: number,
    y: number,
    h: number,
    r: number,
    tip: number,
    sides: number,
    ink: string,
    solid = true,
    angle = 0,
    leanX = 0,
    leanZ = 0,
  ) {
    function ring(radius: number, dx = 0, dz = 0): Point[] {
      return Array.from({ length: sides }, (_, i) => {
        const a = angle + (i * 2 * Math.PI) / sides;
        return [x + dx + radius * Math.cos(a), z + dz + radius * Math.sin(a)];
      });
    }
    prism(ring(r), ring(tip, leanX, leanZ), y, h, ink, solid);
  }

  const random = randomSeed("four-tides-shore");
  islands.forEach(({ x, z, land, cliff, radius }, id) => {
    prism(coastline(id, 1.18), coastline(id, 1.07), -3.5, 1.9, cliff);
    prism(
      coastline(id, 1.07),
      coastline(id),
      -1.6,
      1.35,
      ["#dab98d", "#acc5ca", "#dab98d", "#6b5157", "#dab98d"][id],
    );
    prism(coastline(id), coastline(id, 0.985), -0.25, 0.25, land);
    for (let i = 0; i < 45; i++) {
      const a = random() * Math.PI * 2,
        r = (0.37 + 0.52 * random()) * radius;
      box(
        x + r * Math.cos(a),
        z + r * Math.sin(a),
        0.008,
        0.17 + random() * 0.56,
        0.008,
        0.08 + random() * 0.18,
        ["#c2b598", "#b6cfd4", "#c4a875", "#746570", "#d4b476"][id],
        a,
        false,
      );
    }
    const inner = coastline(id, 1.115),
      outer = coastline(id, 1.132);
    for (let i = 0; i < inner.length; i += 2) {
      const j = (i + 1) % inner.length,
        foam = [inner[i], outer[i], outer[j], inner[j]];
      prism(foam, foam, SEA_LEVEL + 0.012, 0.01, "#d4e9df", false);
    }
  });
  for (const [from, to] of crossings) {
    const a = islands[from],
      b = islands[to],
      length = Math.hypot(b.x - a.x, b.z - a.z);
    const dx = (b.x - a.x) / length,
      dz = (b.z - a.z) / length,
      yaw = Math.atan2(dx, dz);
    const start = a.radius - 3,
      end = length - b.radius + 3,
      mid = (start + end) / 2,
      width = from === 0 ? 4.8 : 3.8;
    function at(t: number, offset = 0): Point {
      return [a.x + dx * t + dz * offset, a.z + dz * t - dx * offset];
    }
    box(...at(mid), -0.32, width, 0.37, end - start, "#be905d", yaw);
    const planks = Math.ceil((end - start) / 0.65);
    for (let i = 1; i < planks; i++)
      box(
        ...at(start + ((end - start) * i) / planks),
        0.05,
        width,
        0.008,
        0.035,
        "#896744",
        yaw,
        false,
      );
    for (const side of [-1, 1]) {
      const offset = side * (width / 2 - 0.12);
      box(...at(mid, offset), 0.86, 0.12, 0.14, end - start, "#865d43", yaw);
      const posts = Math.ceil((end - start) / 5);
      for (let i = 0; i <= posts; i++) {
        const p = at(start + ((end - start) * i) / posts, offset);
        box(...p, -2.9, 0.26, 4.08, 0.26, "#765440", yaw);
        box(...p, 1.17, 0.31, 0.075, 0.31, "#dcb878", yaw, false);
      }
    }
    let last = from;
    for (const t of [start, mid, end]) {
      const [x, z] = at(t);
      nodes.push([x, 0.09, z]);
      links.push([last, nodes.length - 1]);
      last = nodes.length - 1;
    }
    links.push([last, to]);
  }

  // Compass Cay's lighthouse, plaza and compass rose.
  for (const [y, h, r, top, color] of [
    [0, 0.55, 2.05, 1.9, "#3c5362"],
    [0.55, 2.5, 1.63, 1.44, "#f4e8cf"],
    [3.05, 1.7, 1.44, 1.31, "#c35a4b"],
    [4.75, 2.5, 1.31, 1.13, "#f4e8cf"],
    [7.25, 0.32, 1.55, 1.55, "#3c5362"],
    [7.57, 1.35, 1.04, 1.04, "#ffcb66"],
    [8.92, 0.7, 1.55, 0.14, "#c35a4b"],
  ] as const)
    cone(-6, 6, y, h, r, top, 12, color);
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    cone(
      -6 + Math.cos(a),
      6 + Math.sin(a),
      7.55,
      1.42,
      0.07,
      0.07,
      5,
      "#3c5362",
      false,
    );
  }
  cone(0, 0, 0, 0.014, 4.7, 4.7, 32, "#b4a180", false);
  cone(0, 0, 0.014, 0.009, 4.54, 4.54, 32, "#f5ead4", false);
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4,
      r = i % 2 ? 2.25 : 3.9;
    const triangle: Point[] = [
      [-0.5 * Math.cos(a), -0.5 * Math.sin(a)],
      [r * Math.sin(a), -r * Math.cos(a)],
      [0.5 * Math.cos(a), 0.5 * Math.sin(a)],
    ];
    prism(
      triangle,
      triangle,
      0.024,
      0.006,
      i % 2 ? "#bf9662" : "#526e77",
      false,
    );
  }
  for (const [x, z] of [
    [5, 7],
    [-7, -5],
  ]) {
    box(x, z, 0.49, 2.5, 0.18, 0.66, "#9f7754");
    box(x, z + 0.32, 0.73, 2.5, 0.57, 0.12, "#ad835b");
    for (const leg of [-0.85, 0.85])
      box(x + leg, z, 0, 0.18, 0.5, 0.51, "#655c54");
  }

  // Frostpine Ridge
  for (const [x, z, r, h] of [
    [-6, -58, 6, 11],
    [1, -59, 7, 16],
    [8, -58, 5, 10],
  ]) {
    cone(x, z, 0, h * 0.55, r, r * 0.49, 7, "#8294a9", true, 0.3);
    cone(x, z, h * 0.55, h * 0.45, r * 0.49, 0.07, 7, "#f5fcf8", true, 0.3);
  }
  for (const [x, z, h] of [
    [-11, -46, 7],
    [-9, -51, 8],
    [10, -51, 8],
    [13, -47, 5],
    [-12, -43, 5],
    [7, -54, 5],
  ]) {
    cone(x, z, 0, h * 0.35, 0.36, 0.29, 6, "#77675a");
    for (let tier = 0; tier < 3; tier++) {
      const y = h * (0.2 + 0.21 * tier),
        r = h * (0.3 - 0.062 * tier),
        canopy = h * (0.42 - 0.06 * tier);
      cone(x, z, y, canopy, r, 0.06, 8, "#39776d", false);
      cone(
        x,
        z,
        y + canopy * 0.37,
        canopy * 0.65,
        r * 0.65,
        0.04,
        8,
        "#e7f6f3",
        false,
      );
    }
  }
  box(-10, -54, 0, 4.6, 2.35, 3.1, "#997660");
  const eaves: Point[] = [
    [-12.65, -56],
    [-7.35, -56],
    [-7.35, -52],
    [-12.65, -52],
  ];
  prism(
    eaves,
    eaves.map(([x, z]) => [x, -54 + (z + 54) * 0.04]),
    2.35,
    1.55,
    "#e6f1ef",
  );
  box(-10, -52.42, 0, 0.92, 1.85, 0.12, "#645e58", 0, false);
  for (const x of [-11.45, -8.55])
    box(x, -52.41, 1, 0.75, 0.72, 0.15, "#efc679", 0, false);
  box(-11.55, -54.3, 3, 0.48, 1.25, 0.5, "#786c70");

  // Lantern Quay
  for (const x of [54, 60])
    for (const z of [-3, 3]) cone(x, z, 0, 4, 0.22, 0.22, 8, "#9d4035");
  for (const [y, r, h] of [
    [3.8, 6, 2],
    [6, 4.45, 1.5],
    [7.7, 2.95, 1.45],
  ]) {
    cone(57, 0, y, 0.31, r, r * 1.05, 4, "#224e59", true, Math.PI / 4);
    cone(
      57,
      0,
      y + 0.31,
      h,
      r * 1.05,
      r * 0.3,
      4,
      "#347777",
      true,
      Math.PI / 4,
    );
    cone(
      57,
      0,
      y + h + 0.15,
      0.5,
      r * 0.3,
      r * 0.3,
      4,
      "#9d4035",
      true,
      Math.PI / 4,
    );
  }
  cone(57, 0, 9.6, 1.2, 0.32, 0.06, 8, "#edbc5e");
  for (const z of [-3.1, 3.1]) cone(46, z, 0, 3.85, 0.22, 0.22, 8, "#9d4035");
  box(46, 0, 3.7, 0.52, 0.36, 7.8, "#9d4035");
  for (const z of [-2.3, 2.3])
    cone(46, z, 3.15, 0.55, 0.34, 0.32, 9, "#eb8150", false);
  for (const z of [-9, 9]) {
    box(48, z, 0, 3.8, 1.05, 2.4, "#936548");
    for (const x of [46.3, 49.7])
      cone(x, z, 1.04, 1.25, 0.1, 0.1, 6, "#9d4035");
    for (let i = 0; i < 5; i++)
      box(
        46.24 + i * 0.88,
        z,
        2.25,
        0.88,
        0.17,
        3,
        i % 2 ? "#f4e8cf" : "#c35a4b",
        0,
        false,
      );
  }
  for (const side of [-1, 1]) {
    for (const x of [50.3, 57.3])
      cone(x, side * 6.5, 0, 3.37, 0.1, 0.1, 7, "#8c6648");
    for (let i = 0; i < 5; i++) {
      const x = 51 + i * 1.4,
        y = 2.95 + 0.075 * (i - 2) ** 2;
      box(x, side * 6.5, y, 1.44, 0.045, 0.045, "#78614f", 0, false);
      cone(
        x,
        side * 6.5,
        y - 0.51,
        0.44,
        0.23,
        0.22,
        7,
        i % 2 ? "#edac59" : "#de6d51",
        false,
      );
    }
  }

  // Ember Caldera
  cone(1, 58, 0, 4.8, 7.3, 4.15, 10, "#66545d", true, 0.22);
  cone(1, 58, 4.8, 3.9, 4.15, 2.8, 10, "#504858", true, 0.22);
  cone(1, 58, 8.7, 0.07, 2.52, 2.52, 10, "#ff9d45", false, 0.22);
  for (let i = 0; i < 3; i++)
    cone(
      1.2,
      51.15 + i * 1.5,
      i * 2.7,
      2.9,
      0.67,
      0.4,
      5,
      "#f28b50",
      false,
      0,
      0.55,
      1.68,
    );
  for (const [x, z, h] of [
    [-9, 50, 4],
    [-10, 52, 5.8],
    [-12, 51, 3.1],
    [10, 48, 5],
    [12, 49, 3.3],
    [9, 52, 2.8],
  ]) {
    cone(x, z, 0, h, 1.45, 1.25, 6, "#514c60");
    cone(x, z, h, 0.12, 1.24, 1.2, 6, "#947169", false);
  }

  // Shipwreck Cove
  const hull: Point[] = [
    [-62, -4],
    [-60, -6],
    [-55, -4],
    [-54, 3],
    [-57, 7],
    [-61, 3],
  ];
  prism(
    hull.map(([x, z]) => [-58 + (x + 58) * 0.7, z * 0.7]),
    hull,
    0,
    2.1,
    "#986848",
  );
  prism(hull, hull, 2.1, 0.18, "#dec291");
  cone(-58, 0, 2.25, 7, 0.19, 0.12, 7, "#705747", true, 0, 0.42, 0.35);
  box(-57.8, 0, 7.9, 0.18, 0.2, 5.9, "#71553f");
  const sail: Point[] = [
    [-57.82, -2.7],
    [-57.52, -2.7],
    [-57.52, 2.6],
    [-57.82, 2.6],
  ];
  prism(
    sail,
    sail.map(([x, z]) => [x + 0.32, z * 0.85]),
    4.6,
    3.34,
    "#f4e4be",
    false,
  );
  for (const [x, z, h, lean] of [
    [-49, -10, 7, 0.95],
    [-54, 10, 7.8, -1],
    [-45, 11, 5.6, 1],
    [-58, -10, 6, -0.6],
  ]) {
    cone(x, z, 0, h, 0.43, 0.24, 8, "#a87b51", true, 0, lean, 0.65);
    for (let leaf = 0; leaf < 7; leaf++) {
      const a = (leaf * Math.PI * 2) / 7 + 0.4;
      const vertices = [
        [0, 0, 0],
        [2, 0.6, -0.64],
        [4.6, -0.9, 0],
        [2, 0.6, 0.64],
        [2, 0.93, 0],
      ].flatMap(([dx, dy, dz]) => [
        x + lean + dx * Math.cos(a) - dz * Math.sin(a),
        h + dy,
        z + 0.65 + dx * Math.sin(a) + dz * Math.cos(a),
      ]);
      mesh(
        vertices,
        [0, 4, 1, 1, 4, 2, 2, 4, 3, 3, 4, 0],
        leaf % 2 ? "#478969" : "#5f9e68",
        false,
      );
    }
  }
  for (const [x, z] of [
    [-54, 6],
    [-53.1, 6.45],
    [-53.7, 7.1],
  ]) {
    cone(x, z, 0, 0.83, 0.39, 0.4, 10, "#ab784d");
    for (const y of [0.18, 0.61])
      cone(x, z, y, 0.075, 0.41, 0.41, 10, "#666867", false);
  }
  islands.slice(1).forEach(({ x, z }, i) => {
    const dx = x / 48,
      dz = z / 48;
    for (const side of [-6, 6]) {
      cone(
        x + dz * side - dx * 2,
        z - dx * side - dz * 2,
        0,
        2.8,
        2.25,
        1.75,
        7,
        ["#a6bbc6", "#b78060", "#665767", "#bca77b"][i],
        true,
        0.4,
      );
      nodes.push([x + dz * side + dx * 2, 0.075, z - dx * side + dz * 2]);
      links.push([i + 1, nodes.length - 1]);
    }
  });
  return {
    seed: ISLANDS,
    district,
    boxes,
    buildings: [],
    bounds: 72,
    nodes,
    links,
    spawns: [
      [0, 0.08, 0],
      [2, 0.08, 1],
      [-2, 0.08, 1],
      [2, 0.08, -2],
      [-2, 0.08, -2],
      [0, 0.08, 3],
      [3, 0.08, 0],
      [-3, 0.08, 0],
    ],
    beacons: [
      [0, 0.65, -50],
      [51, 0.65, 0],
      [-50, 0.65, 0],
    ],
    bridges: [],
    blimps: [],
    platforms: [],
    aerialLinks: [],
    aerialEntries: [],
    flightCeiling: 65,
    plan: { streets: [], blocks: [], parcels: [], landmarks: [], bridges: [] },
    streetNodes: nodes.map((_, i) => i),
    roofLinks: [],
    dressing: [],
  };
}
