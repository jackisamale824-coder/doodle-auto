import * as T from "three";
import type { Box } from "./world.ts";

// One seamless architectural bay per tile. Mipmaps turn distant mullions into
// an even tone rather than thousands of subpixel triangles and ink outlines.
function elevationTile(factory: boolean, ground: boolean) {
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
  if (ground && factory) {
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
  } else if (ground) {
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
  return new T.MeshBasicMaterial({ map, fog: true });
}
export function countyBuildings(group: T.Group, blocks: Box[]) {
  const mats = [
    elevationTile(true, true),
    elevationTile(true, false),
    elevationTile(false, true),
    elevationTile(false, false),
    new T.MeshBasicMaterial({ color: 0xe2e5e2 }),
    new T.MeshBasicMaterial({ color: 0x828fae, side: T.DoubleSide }),
  ];
  const buckets = mats.map(() => ({ pos: [] as number[], uv: [] as number[] }));
  function quad(
    m: number,
    a: T.Vector3,
    b: T.Vector3,
    c: T.Vector3,
    d: T.Vector3,
    u: number,
    v: number,
  ) {
    for (const p of [a, b, c, a, c, d]) buckets[m].pos.push(p.x, p.y, p.z);
    buckets[m].uv.push(0, 0, u, 0, u, v, 0, 0, u, v, 0, v);
  }
  for (const block of blocks) {
    const [x, , z] = block.p,
      [w, h, d] = block.s,
      kind = x < 0 ? 0 : 2,
      base = Math.min(4, h * 0.45);
    function shell(
      cx: number,
      cz: number,
      width: number,
      depth: number,
      lo: number,
      top: number,
      m: number,
    ) {
      const corners = [
        [1, 1],
        [-1, 1],
        [-1, -1],
        [1, -1],
      ].map(
        ([a, b]) =>
          new T.Vector3(cx + (a * width) / 2, lo, cz + (b * depth) / 2),
      );
      const roof = corners.map((p) => new T.Vector3(p.x, top, p.z));
      for (let i = 0; i < 4; i++) {
        const j = (i + 1) % 4;
        quad(
          m,
          corners[j],
          corners[i],
          roof[i],
          roof[j],
          Math.max(1, Math.round(corners[i].distanceTo(corners[j]) / 5)),
          Math.max(1, Math.round((top - lo) / 3.6)),
        );
      }
      if (top === h) quad(4, roof[3], roof[2], roof[1], roof[0], 1, 1);
    }
    shell(x, z, w, d, 0, base, kind);
    shell(x, z, w, d, base, h, kind + 1);
    // Cantilevered awnings sit above the entrance and cast a blue fascia.
    const awning = Math.min(8, w * 0.35),
      front = z + d / 2,
      y = base * 0.88;
    const a = new T.Vector3(x - awning, y, front),
      b = new T.Vector3(x + awning, y, front);
    const c = new T.Vector3(x + awning, y - 0.18, front + 1.2),
      e = new T.Vector3(x - awning, y - 0.18, front + 1.2);
    quad(5, a, b, c, e, 1, 1);
    quad(5, e, c, c.clone().setY(y - 0.44), e.clone().setY(y - 0.44), 1, 1);
  }
  buckets.forEach(({ pos, uv }, i) => {
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
    group.add(new T.Mesh(geo, mats[i]));
  });
}
