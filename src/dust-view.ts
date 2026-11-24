import * as T from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { randomSeed, type City } from "./world.ts";

export function drawDustSite(city: City, group: T.Group) {
  const random = randomSeed("dust-a-plaster");
  const batches = new Map<T.Material, T.BufferGeometry[]>();
  function put(geo: T.BufferGeometry, m: T.Material) {
    if (!batches.has(m)) batches.set(m, []);
    batches.get(m)!.push(geo);
  }
  function mat(color: string) {
    return new T.MeshStandardMaterial({ color, roughness: 0.96 });
  }
  function surface(color: string, style = "stucco") {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 128;
    const c = canvas.getContext("2d")!;
    c.fillStyle = color;
    c.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 2900; i++) {
      c.fillStyle = i % 2 ? "rgba(65,49,36,.075)" : "rgba(255,246,221,.1)";
      c.fillRect(
        random() * 128,
        random() * 128,
        1 + random() * 3,
        1 + random() * 2,
      );
    }
    if (style === "paving") {
      c.strokeStyle = "#736f6755";
      c.lineWidth = 1.3;
      for (let r = 0; r < 4; r++) {
        const y = r * 32;
        c.beginPath();
        c.moveTo(0, y);
        c.lineTo(128, y);
        c.stroke();
        for (let x = (r % 2) * 32; x < 128; x += 64) {
          c.beginPath();
          c.moveTo(x, y);
          c.lineTo(x, y + 32);
          c.stroke();
        }
      }
    } else if (style === "wood") {
      for (let y = 0; y <= 128; y += 16) {
        c.fillStyle = "#5c503961";
        c.fillRect(0, y, 128, 1);
      }
    } else if (style === "stucco") {
      for (let i = 0; i < 9; i++) {
        c.fillStyle = "#8f796229";
        c.fillRect(random() * 115, random() * 108, 3 + random() * 10, 2);
      }
    }
    const texture = new T.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = T.RepeatWrapping;
    texture.colorSpace = T.SRGBColorSpace;
    return new T.MeshStandardMaterial({ map: texture, roughness: 0.98 });
  }
  const stone = surface("#d4bfa4"),
    plaster = surface("#dfd3be"),
    sand = surface("#be9870");
  const paving = surface("#baaea0", "paving"),
    road = surface("#898785", "asphalt"),
    wood = surface("#a48e72", "wood");
  const iron = mat("#67787a"),
    teal = mat("#599e9d"),
    shade = mat("#425b5c"),
    chalk = mat("#ddcbb2"),
    red = mat("#ad4a37");
  function block(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    m: T.Material,
  ) {
    const geo = new T.BoxGeometry(w, h, d);
    const uv = geo.getAttribute("uv"),
      norm = geo.getAttribute("normal");
    for (let i = 0; i < uv.count; i++) {
      const side = Math.abs(norm.getX(i)) > 0.5,
        top = Math.abs(norm.getY(i)) > 0.5;
      uv.setXY(
        i,
        (uv.getX(i) * (side ? d : w)) / 3,
        (uv.getY(i) * (top ? d : h)) / 3,
      );
    }
    put(geo.translate(x, y, z), m);
  }
  for (const b of city.boxes) {
    if (b.kind === "boundary") continue;
    const [x, y, z] = b.p,
      [w, h, d] = b.s;
    if (b.mesh) {
      const g = new T.BufferGeometry();
      g.setAttribute(
        "position",
        new T.Float32BufferAttribute(b.mesh.vertices, 3),
      );
      g.setAttribute(
        "uv",
        new T.Float32BufferAttribute([0, 0, 5, 0, 5, 8, 0, 8], 2),
      );
      g.setIndex(b.mesh.indices);
      g.computeVertexNormals();
      const slope = new T.Mesh(g, road);
      slope.receiveShadow = true;
      group.add(slope);
      continue;
    }
    if (b.kind === "drum") {
      put(new T.CylinderGeometry(0.5, 0.5, h, 16).translate(x, y, z), iron);
      for (const dy of [-0.35, 0.35])
        put(
          new T.CylinderGeometry(0.516, 0.516, 0.065, 16).translate(
            x,
            y + dy,
            z,
          ),
          shade,
        );
      continue;
    }
    if (b.kind === "wreck") {
      block(x, y - 0.13, z, w, 0.54, d, teal);
      block(x, y + 0.31, z - 0.1, w * 0.87, 0.62, d * 0.52, shade);
      block(x, y + 0.65, z - 0.1, w * 0.88, 0.1, d * 0.55, teal);
      for (const side of [-1, 1])
        for (const end of [-1, 1]) {
          put(
            new T.CylinderGeometry(0.39, 0.39, 0.19, 12)
              .rotateZ(Math.PI / 2)
              .translate(x + side * w * 0.48, 0.42, z + end * 1.35),
            shade,
          );
          block(
            x + side * 0.72,
            0.62,
            z + end * 2.16,
            0.38,
            0.18,
            0.05,
            end < 0 ? chalk : red,
          );
        }
      continue;
    }
    if (b.kind === "cityblock") {
      const facade = Math.floor(Math.abs(x + z)) % 3 === 0 ? sand : plaster;
      block(x, y, z, w, h, d, facade);
      block(x, y + h / 2, z, w + 0.12, 0.18, d + 0.12, chalk);
      for (const sign of [-1, 1]) {
        for (let dx = -w / 2 + 2; dx < w / 2 - 1; dx += 4.7) {
          block(
            x + dx,
            h * 0.65,
            z + sign * (d / 2 + 0.035),
            1.05,
            1.45,
            0.09,
            shade,
          );
          block(
            x + dx,
            h * 0.65 - 0.76,
            z + sign * (d / 2 + 0.1),
            1.31,
            0.14,
            0.26,
            stone,
          );
        }
        for (let dz = -d / 2 + 2; dz < d / 2 - 1; dz += 5.2) {
          block(
            x + sign * (w / 2 + 0.035),
            h * 0.66,
            z + dz,
            0.09,
            1.35,
            0.86,
            shade,
          );
        }
      }
      continue;
    }
    if (b.kind === "gate") {
      block(x, y, z, w, h, d, wood);
      for (const height of [0.75, 2.8])
        block(x, height, z, w + 0.08, 0.13, d + 0.08, iron);
      continue;
    }
    const m =
      b.kind === "crate"
        ? wood
        : b.kind === "stucco" || b.kind === "hotel"
          ? plaster
          : b.kind === "ochre"
            ? sand
            : b.kind === "asphalt"
              ? road
              : b.kind === "paving" || b.kind === "step"
                ? paving
                : stone;
    block(x, y, z, w, h, d, m);
    if (b.kind === "crate") {
      block(x, y + h / 2 + 0.018, z, w + 0.04, 0.045, d + 0.04, teal);
      for (const dx of [-w * 0.44, w * 0.44])
        for (const dz of [-d * 0.5, d * 0.5])
          block(x + dx, y, z + dz, 0.075, h, 0.08, iron);
      for (const dy of [-h * 0.43, h * 0.43])
        block(x, y + dy, z, w + 0.06, 0.085, d + 0.06, iron);
    }
    if (["parapet", "stucco", "ochre", "hotel"].includes(b.kind))
      block(x, y + h / 2 + 0.06, z, w + 0.18, 0.12, d + 0.18, chalk);
  }
  // Paint the site letter and hotel placards on the architecture itself.
  function placard(
    text: string,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    face = 0,
    paint = "#296b67",
    base = "#ddd2b9",
  ) {
    const c = document.createElement("canvas");
    c.width = 384;
    c.height = 160;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, 384, 160);
    ctx.strokeStyle = paint;
    ctx.lineWidth = 5;
    ctx.strokeRect(7, 7, 370, 146);
    ctx.font = "bold " + (text.length > 5 ? 44 : 100) + "px Georgia";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = paint;
    ctx.fillText(text, 192, 82, 353);
    const tex = new T.CanvasTexture(c);
    tex.colorSpace = T.SRGBColorSpace;
    const mesh = new T.Mesh(
      new T.PlaneGeometry(w, h),
      new T.MeshBasicMaterial({ map: tex }),
    );
    mesh.rotation.y = face;
    mesh.position.set(x, y, z);
    group.add(mesh);
  }
  placard("A", -4, 2.1, 5.04, 2.3, 2, 0, "#a34632");
  placard("HÔTEL AURORE", -2, 12.1, -15.45, 10, 1.12);
  placard("A", -12, 12.0, -15.38, 2.15, 2.55, 0, "#b44130", "#97bfb3");
  for (const x of [-11, -6, 5, 9]) {
    block(x, 5.1, -15.42, 1.45, 2.9, 0.12, shade);
    block(x, 5.03, -15.31, 1.12, 2.65, 0.12, wood);
    block(x, 6.68, -15.26, 1.85, 0.2, 0.45, chalk);
  }
  placard("A  →", -24.0, 3.6, 7, 2.8, 1.25, Math.PI / 2, "#b0523e");
  placard("B", -83, 3.4, -23.93, 3.2, 3, 0, "#af432e");
  placard("B  ←", -42.07, 2.35, 4, 2.4, 1.15, -Math.PI / 2, "#ad4533");
  placard("A  →", -36, 2.7, 12.07, 2.6, 1.2, 0, "#ad4533");
  placard("MID", -60, 2.6, 19.94, 2.25, 1.05, Math.PI);
  placard("TUNNELS", -84, 4.3, 42.82, 4, 0.9);
  // Beams and hanging lamps distinguish the roofed tunnel routes from Mid.
  for (const z of [7, 13, 21, 27, 35, 40]) {
    const ceiling = z < 18 ? 5.68 : z < 31 ? 6.68 : 6.48;
    block(-84, ceiling - 0.12, z, 11.9, 0.24, 0.25, wood);
    for (const x of [-89.7, -78.3])
      block(x, ceiling / 2, z, 0.32, ceiling, 0.38, wood);
    block(-84, ceiling - 0.42, z, 1.15, 0.16, 0.4, iron);
    block(-84, ceiling - 0.52, z, 0.96, 0.08, 0.28, chalk);
  }
  for (const x of [-75, -69, -63, -57]) {
    block(x, 4.87, 16, 0.25, 0.25, 8, wood);
    block(x, 4.64, 16, 0.3, 0.14, 1.1, chalk);
  }
  // A faded ground stencil locates the second site from its three entrances.
  const siteMark = document.createElement("canvas");
  siteMark.width = siteMark.height = 160;
  const paint = siteMark.getContext("2d")!;
  paint.strokeStyle = paint.fillStyle = "#ae5038";
  paint.lineWidth = 5;
  paint.beginPath();
  paint.arc(80, 80, 69, 0, Math.PI * 2);
  paint.stroke();
  paint.font = "bold 108px sans-serif";
  paint.textAlign = "center";
  paint.fillText("B", 80, 118);
  const markTexture = new T.CanvasTexture(siteMark);
  markTexture.colorSpace = T.SRGBColorSpace;
  const mark = new T.Mesh(
    new T.PlaneGeometry(5.4, 5.4),
    new T.MeshBasicMaterial({
      map: markTexture,
      transparent: true,
      depthWrite: false,
    }),
  );
  mark.rotation.x = -Math.PI / 2;
  mark.position.set(-80, 0.025, -13);
  group.add(mark);
  const arch = new T.Shape();
  arch.moveTo(-1.05, 0);
  arch.lineTo(1.05, 0);
  arch.lineTo(1.05, 2.2);
  arch.quadraticCurveTo(1.02, 3, 0.0, 3.6);
  arch.quadraticCurveTo(-1.02, 3, -1.05, 2.2);
  arch.closePath();
  for (let x = -13; x <= 10; x += 3.25) {
    const face = new T.Mesh(new T.ShapeGeometry(arch), shade);
    face.position.set(x, 7.5, -15.46);
    group.add(face);
    block(x, 7.45, -15.31, 2.4, 0.18, 0.38, teal);
    for (const side of [-1, 1])
      block(x + side * 1.22, 8.9, -15.37, 0.18, 4.5, 0.25, chalk);
    block(x, 8.0, -15.15, 2.35, 0.12, 0.15, iron);
    for (let dx = -0.9; dx <= 0.91; dx += 0.3)
      block(x + dx, 7.77, -15.15, 0.035, 0.55, 0.04, iron);
  }
  for (let z = -12; z < 23; z += 4.4) {
    if (z < 8 || z > 14) {
      block(21.96, 6.5, z, 0.12, 1.45, 1.04, shade);
      block(21.85, 5.7, z, 0.32, 0.13, 1.4, chalk);
    }
    if (z > -9 && (z < 12 || z > 21))
      block(-23.97, 5.1, z, 0.08, 0.85, 0.6, shade);
  }
  for (let x = -18; x < 10; x += 4.1) {
    block(x, 7.15, 23.94, 1.15, 1.5, 0.1, shade);
    block(x, 6.32, 23.81, 1.5, 0.17, 0.25, teal);
  }
  // The roadway stripe and curb follow the same grade as the walkable ramp.
  for (let i = 0; i < 48; i++) {
    const z = 16.75 - i * 0.5,
      y = (3.6 * (17 - z)) / 24;
    block(20.9, y + 0.035, z, 0.16, 0.03, 0.51, chalk);
    block(21.65, y + 0.09, z, 0.62, 0.17, 0.5, i % 6 < 3 ? red : chalk);
  }
  const flag = new T.Mesh(
    new T.RingGeometry(1.52, 1.62, 40),
    new T.MeshBasicMaterial({ color: 0xae5542, side: T.DoubleSide }),
  );
  flag.rotation.x = -Math.PI / 2;
  flag.position.set(-1.2, 3.62, -1.8);
  group.add(flag);
  for (const s of [-1, 1]) {
    const g = new T.BoxGeometry(0.18, 0.025, 1.6)
      .rotateY(s * 0.34)
      .translate(-1.2 + s * 0.28, 3.632, -1.8);
    put(g, red);
  }
  block(-1.2, 3.632, -1.7, 0.68, 0.025, 0.13, red);
  const trunk = mat("#8d7961"),
    leaf = mat("#66854b");
  leaf.side = T.DoubleSide;
  for (const [x, y, z, h] of [
    [-14, 6, -17, 8],
    [9, 6, -20, 9],
    [-21, 6, -21, 6],
    [17, 5, -26, 7],
  ]) {
    put(
      new T.CylinderGeometry(0.16, 0.3, h, 8).translate(x, y + h / 2, z),
      trunk,
    );
    for (let j = 0; j < 11; j++) {
      const g = new T.BufferGeometry();
      g.setAttribute(
        "position",
        new T.Float32BufferAttribute(
          [
            0, 0, 0, -0.42, 0.9, 1.8, 0.42, 0.9, 1.8, -0.42, 0.9, 1.8, 0, -0.35,
            3.4, 0.42, 0.9, 1.8,
          ],
          3,
        ),
      );
      g.computeVertexNormals();
      g.rotateY(j * 0.59 + x);
      g.translate(x, y + h, z);
      group.add(new T.Mesh(g, leaf));
    }
  }
  for (const z of [-18, 12]) {
    block(21, 8, z, 0.22, 16, 0.22, trunk);
    block(21, 15.2, z, 2.1, 0.13, 0.16, trunk);
  }
  for (const dx of [-0.75, 0, 0.75]) {
    const points = Array.from(
      { length: 17 },
      (_, i) =>
        new T.Vector3(
          21 + dx,
          15.35 - 1.4 * Math.sin((Math.PI * i) / 16),
          -18 + (30 * i) / 16,
        ),
    );
    group.add(
      new T.Line(
        new T.BufferGeometry().setFromPoints(points),
        new T.LineBasicMaterial({ color: 0x554d43 }),
      ),
    );
  }
  // Rooftop silhouettes continue beyond the playable perimeter.
  for (let i = 0; i < 28; i++) {
    const x = -64 + i * 4.6,
      h = 4 + random() * 9,
      z = -38 - random() * 8;
    block(x, h / 2, z, 5 + random() * 3, h, 7, i % 3 ? stone : sand);
    block(x, h + 0.1, z, 6, 0.2, 7.2, chalk);
  }
  for (const [material, geos] of batches) {
    const mesh = new T.Mesh(mergeGeometries(geos)!, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    geos.forEach((g) => g.dispose());
  }
}
