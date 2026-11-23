import * as T from "three";
import type { CityMass, Facade } from "./county-architecture.ts";

// One seamless architectural bay per tile. Mipmaps turn distant mullions into
// an even tone rather than thousands of subpixel triangles and ink outlines.
function elevationTile(style: Facade, ground: boolean) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const c = canvas.getContext("2d")!;
  const rect = (x: number, y: number, w: number, h: number, fill: string) => {
    c.fillStyle = fill;
    c.fillRect(x, y, w, h);
  };
  const paper = "#f4f2e8",
    shadow = "#c2c8d4",
    ink = "#66739b",
    glass = "#b2becd";
  rect(0, 0, 256, 256, paper);
  const factory = style === "works";
  if (factory) {
    for (let i = 0; i < 16; i++) {
      rect(0, i * 16, 256, 1, "#dedfd9");
      for (let x = (i % 2) * 24; x < 256; x += 48)
        rect(x, i * 16, 1, 16, "#e0e0db");
    }
  }
  rect(0, 0, 9, 256, "#dadcd8");
  rect(9, 0, 2, 256, shadow);
  const win = (x: number, y: number, w: number, h: number, panes: number) => {
    rect(x - 5, y - 5, w + 10, h + 12, shadow);
    rect(x - 2, y - 2, w + 4, h + 4, ink);
    rect(x, y, w, h, glass);
    rect(x + 3, y + 3, w - 6, h * 0.45, "#c7d0d6");
    rect(x + 3, y + 4, w - 6, 5, "#acb8c8");
    for (let i = 1; i < panes; i++) rect(x + (w * i) / panes - 2, y, 4, h, ink);
    rect(x, y + h * 0.42, w, 3, ink);
    rect(x - 7, y + h + 3, w + 14, 5, "#fdfbf1");
    rect(x - 6, y + h + 8, w + 12, 3, shadow);
  };
  if (style === "clock") {
    c.fillStyle = "#d9dce2";
    c.fillRect(0, 0, 256, 256);
    for (const [r, color] of [
      [79, "#7581a0"],
      [72, "#faf8ec"],
    ] as const) {
      c.fillStyle = color;
      c.beginPath();
      c.arc(128, 126, r, 0, Math.PI * 2);
      c.fill();
    }
    c.save();
    c.translate(128, 126);
    for (let i = 0; i < 12; i++) {
      c.rotate(Math.PI / 6);
      rect(-2, -66, 4, 8, ink);
    }
    rect(-3, -48, 6, 49, ink);
    c.rotate(2.05);
    rect(-3, -35, 6, 36, ink);
    c.restore();
  } else if (style === "glass") {
    rect(0, 0, 256, 241, "#8b9db7");
    rect(5, 3, 119, 223, "#b5c4d3");
    rect(130, 3, 119, 223, "#a7b7cb");
    c.fillStyle = "#c8d3dd";
    c.beginPath();
    c.moveTo(5, 3);
    c.lineTo(124, 3);
    c.lineTo(5, 118);
    c.fill();
    rect(0, 215, 256, 15, ink);
    rect(0, 230, 256, 20, "#d4dae0");
  } else if (style === "civic") {
    rect(16, 18, 224, 14, shadow);
    for (let x = 57; x < 240; x += 72) {
      c.fillStyle = ink;
      c.beginPath();
      c.arc(x, 110, 27, Math.PI, 2 * Math.PI);
      c.fill();
      rect(x - 27, 110, 54, 85, ink);
      rect(x - 20, 111, 40, 78, glass);
      rect(x - 2, 109, 4, 80, ink);
      rect(x - 32, 193, 64, 7, shadow);
    }
  } else if (ground && style === "homes") {
    win(19, 65, 106, 120, 2);
    rect(148, 54, 86, 195, shadow);
    rect(154, 59, 74, 188, ink);
    rect(160, 65, 61, 177, "#8798ae");
    rect(166, 74, 48, 52, "#c4ced7");
    rect(169, 144, 18, 70, "#a3b0c2");
    rect(193, 144, 18, 70, "#a3b0c2");
    rect(210, 137, 6, 5, paper);
    rect(140, 40, 100, 10, shadow);
    rect(134, 34, 112, 7, paper);
  } else if (ground && factory) {
    rect(19, 49, 167, 173, ink);
    rect(24, 55, 157, 161, shadow);
    for (let y = 62; y < 211; y += 10) rect(24, y, 157, 2, "#a7afbd");
    for (let x = 36; x < 170; x += 29) {
      rect(x, 81, 20, 15, ink);
      rect(x + 2, 83, 16, 10, glass);
    }
    win(200, 79, 36, 137, 1);
    rect(224, 152, 3, 12, paper);
    rect(12, 34, 180, 12, "#a9b1c0");
    rect(9, 29, 186, 7, paper);
  } else if (ground && style === "shops") {
    win(21, 58, 130, 139, 3);
    win(168, 54, 65, 183, 2);
    rect(194, 148, 3, 20, paper);
    rect(16, 24, 224, 17, shadow);
    rect(12, 20, 232, 7, paper);
    rect(12, 27, 232, 3, ink);
    rect(0, 242, 256, 14, "#d3d7d8");
  } else if (factory) {
    win(25, 64, 207, 132, 5);
    rect(19, 50, 219, 9, shadow);
  } else {
    win(25, 40, 84, 154, 2);
    win(140, 40, 84, 154, 2);
    rect(20, 199, 210, 8, shadow);
  }
  rect(0, 0, 256, 6, shadow);
  rect(0, 6, 256, 4, "#faf8ef");
  rect(0, 253, 256, 3, ink);
  const map = new T.CanvasTexture(canvas);
  map.wrapS = map.wrapT = T.RepeatWrapping;
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = 4;
  return new T.MeshBasicMaterial({ map, fog: true, vertexColors: true });
}
export function countyBuildings(group: T.Group, blocks: CityMass[]) {
  const styles: Facade[] = [
    "works",
    "shops",
    "homes",
    "glass",
    "civic",
    "clock",
  ];
  const mats = styles.flatMap((style) => [
    elevationTile(style, true),
    elevationTile(style, false),
  ]);
  const roof =
    mats.push(
      new T.MeshBasicMaterial({ color: 0xe2e5e2, vertexColors: true }),
    ) - 1;
  const trim =
    mats.push(
      new T.MeshBasicMaterial({
        color: 0x7986a4,
        side: T.DoubleSide,
        vertexColors: true,
      }),
    ) - 1;
  const names = [...new Set(blocks.flatMap((b) => (b.sign ? [b.sign] : [])))];
  const atlas = document.createElement("canvas");
  atlas.width = 512;
  atlas.height = 64 * names.length;
  const ctx = atlas.getContext("2d")!;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 40px sans-serif";
  names.forEach((name, i) => {
    const y = i * 64;
    ctx.fillStyle = "#45557f";
    ctx.fillRect(0, y, 512, 64);
    ctx.fillStyle = "#f8f6ed";
    ctx.fillRect(5, y + 4, 502, 2);
    ctx.fillText(name, 256, y + 34, 470);
  });
  const map = new T.CanvasTexture(atlas);
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = 4;
  const sign =
    mats.push(new T.MeshBasicMaterial({ map, vertexColors: true })) - 1;
  const buckets = mats.map(() => ({
    pos: [] as number[],
    uv: [] as number[],
    rgb: [] as number[],
  }));
  function quad(
    m: number,
    a: T.Vector3,
    b: T.Vector3,
    c: T.Vector3,
    d: T.Vector3,
    u = 1,
    v = 1,
    baseV = 0,
  ) {
    const tint = b.x > a.x ? 1 : b.z < a.z ? 0.88 : b.x < a.x ? 0.92 : 0.79;
    for (const p of [a, b, c, a, c, d]) {
      buckets[m].pos.push(p.x, p.y, p.z);
      buckets[m].rgb.push(tint, tint, Math.min(1, tint + 0.035));
    }
    buckets[m].uv.push(
      0,
      baseV,
      u,
      baseV,
      u,
      baseV + v,
      0,
      baseV,
      u,
      baseV + v,
      0,
      baseV + v,
    );
  }
  for (const block of blocks) {
    const [x, y, z] = block.p,
      [w, h, d] = block.s,
      lo = y - h / 2,
      top = y + h / 2,
      m = styles.indexOf(block.frontage) * 2;
    const corners = (height: number) =>
      [
        [1, 1],
        [-1, 1],
        [-1, -1],
        [1, -1],
      ].map(
        ([a, b]) => new T.Vector3(x + (a * w) / 2, height, z + (b * d) / 2),
      );
    function walls(bottom: number, end: number, material: number) {
      const foot = corners(bottom),
        cap = corners(end);
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4,
          clock = block.frontage === "clock";
        quad(
          material,
          foot[j],
          foot[i],
          cap[i],
          cap[j],
          clock ? 1 : Math.max(1, Math.round(foot[i].distanceTo(foot[j]) / 5)),
          clock ? 1 : Math.max(1, Math.round((end - bottom) / 3.6)),
        );
      }
    }
    const base = Math.min(4, top);
    if (lo < 0.01) {
      walls(lo, base, m);
      if (top > base) walls(base, top, m + 1);
    } else walls(lo, top, m + 1);
    const cap = corners(top);
    quad(roof, cap[3], cap[2], cap[1], cap[0]);
    if (!block.sign) continue;
    const width = Math.min(8, w * 0.43),
      front = z + d / 2,
      side = x - w / 2,
      sy = Math.min(3.3, top - 1.3);
    const a = new T.Vector3(x - width, sy, front),
      b = new T.Vector3(x + width, sy, front);
    const c = new T.Vector3(x + width, sy - 0.14, front + 1.45),
      e = new T.Vector3(x - width, sy - 0.14, front + 1.45);
    quad(trim, a, b, c, e);
    const v = 1 / names.length,
      uv = 1 - (names.indexOf(block.sign) + 1) * v;
    quad(
      sign,
      e.clone().setY(sy - 0.9),
      c.clone().setY(sy - 0.9),
      c,
      e,
      1,
      v,
      uv,
    );
    quad(
      sign,
      new T.Vector3(side - 0.015, sy, z - width * 0.7),
      new T.Vector3(side - 0.015, sy, z + width * 0.7),
      new T.Vector3(side - 0.015, sy + 1.1, z + width * 0.7),
      new T.Vector3(side - 0.015, sy + 1.1, z - width * 0.7),
      1,
      v,
      uv,
    );
  }
  buckets.forEach(({ pos, uv, rgb }, i) => {
    if (!pos.length) {
      mats[i].map?.dispose();
      mats[i].dispose();
      return;
    }
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    geo.setAttribute("color", new T.Float32BufferAttribute(rgb, 3));
    group.add(new T.Mesh(geo, mats[i]));
  });
}
