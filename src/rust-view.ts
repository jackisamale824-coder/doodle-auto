import * as T from "three";
import { randomSeed, type Box } from "./world.ts";

const finishes = [
  "sandy_gravel",
  "precast_concrete_wall",
  "corrugated_iron",
  "rusty_painted_metal",
  "rusty_metal_02",
] as const;
type Finish = (typeof finishes)[number];

async function loadSurfaces() {
  const loader = new T.TextureLoader();
  const entries = await Promise.all(
    finishes.map(async (finish) => {
      const load = async (suffix: string) => {
        const url = new URL(
          `./assets/oil-yard/${finish}-${suffix}.webp`,
          import.meta.url,
        );
        const texture = await loader.loadAsync(url.href);
        texture.wrapS = texture.wrapT = T.RepeatWrapping;
        texture.anisotropy = 4;
        return texture;
      };
      const [map, normalMap] = await Promise.all([
        load("Diffuse"),
        load("nor_gl"),
      ]);
      map.colorSpace = T.SRGBColorSpace;
      return [finish, { map, normalMap }] as const;
    }),
  );
  return Object.fromEntries(entries) as Record<
    Finish,
    { map: T.Texture; normalMap: T.Texture }
  >;
}

function canvasMap(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext("2d")!);
  const map = new T.CanvasTexture(canvas);
  map.colorSpace = T.SRGBColorSpace;
  return map;
}

function fenceMaterial() {
  const map = canvasMap(128, 128, (ctx) => {
    for (const offset of [-128, 0, 128]) {
      for (const direction of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(offset, direction > 0 ? 0 : 128);
        ctx.lineTo(offset + 128, direction > 0 ? 128 : 0);
        ctx.strokeStyle = "#474c49";
        ctx.lineWidth = 9;
        ctx.stroke();
        ctx.strokeStyle = "#a8aaa0";
        ctx.lineWidth = 3;
        ctx.stroke();
      }
    }
  });
  map.wrapS = map.wrapT = T.RepeatWrapping;
  return new T.MeshStandardMaterial({
    map,
    side: T.DoubleSide,
    alphaTest: 0.2,
    alphaToCoverage: true,
    roughness: 0.76,
  });
}

function yardSign(paint: T.Texture) {
  const map = canvasMap(768, 432, (ctx) => {
    ctx.fillStyle = "#e2d2a9";
    ctx.fillRect(0, 0, 768, 432);
    ctx.strokeStyle = "#233e40";
    ctx.lineWidth = 8;
    ctx.strokeRect(19, 19, 730, 394);
    ctx.fillStyle = "#a14524";
    ctx.fillRect(27, 27, 714, 66);
    ctx.textAlign = "center";
    ctx.fillStyle = "#f5dfad";
    ctx.font = "bold 32px Arial";
    ctx.fillText("PETROLEUM DIVISION", 384, 72);
    ctx.fillStyle = "#263d3b";
    ctx.font = "900 160px Arial Black, Arial";
    ctx.fillText("RUST", 384, 255);
    ctx.font = "bold 65px Arial";
    ctx.fillText("OIL YARD", 384, 345);
    ctx.globalAlpha = 0.22;
    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(paint.image, 0, 0, 768, 432);
  });
  return new T.MeshStandardMaterial({
    map,
    side: T.DoubleSide,
    roughness: 0.86,
  });
}

// The collision export has positions but no UVs. Project each triangle in metres,
// retaining hard edges and a consistent texel scale across neighbouring pieces.
function yardGeometry(
  box: Box,
  metres: number,
  sign: boolean,
  banded: boolean,
) {
  const indexed = new T.BufferGeometry();
  indexed.setAttribute(
    "position",
    new T.Float32BufferAttribute(box.mesh!.vertices, 3),
  );
  indexed.setIndex(box.mesh!.indices);
  const geometry = indexed.toNonIndexed();
  indexed.dispose();
  geometry.computeVertexNormals();
  const pos = geometry.getAttribute("position"),
    normal = geometry.getAttribute("normal");
  const uv = new Float32Array(pos.count * 2);
  const height = banded ? new Float32Array(pos.count) : undefined;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i),
      y = pos.getY(i),
      z = pos.getZ(i);
    const nx = normal.getX(i),
      ny = normal.getY(i),
      nz = normal.getZ(i);
    const top = Math.abs(ny) > Math.max(Math.abs(nx), Math.abs(nz));
    if (height) height[i] = 0.5 + (y - box.p[1]) / box.s[1];
    if (sign) {
      uv[i * 2] =
        0.5 +
        (box.s[0] < box.s[2]
          ? (-Math.sign(nx) * (z - box.p[2])) / box.s[2]
          : (Math.sign(nz) * (x - box.p[0])) / box.s[0]);
      uv[i * 2 + 1] = 0.5 + (y - box.p[1]) / box.s[1];
    } else {
      uv[i * 2] =
        (top
          ? x
          : Math.abs(nx) > Math.abs(nz)
            ? -Math.sign(nx) * z
            : Math.sign(nz) * x) / metres;
      uv[i * 2 + 1] = (top ? -z : y) / metres;
    }
  }
  geometry.setAttribute("uv", new T.BufferAttribute(uv, 2));
  if (height)
    geometry.setAttribute("yardHeight", new T.BufferAttribute(height, 1));
  return geometry;
}

function paintedBand(base: T.MeshStandardMaterial, color: string) {
  const mat = base.clone();
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.bandPaint = { value: new T.Color(color) };
    shader.vertexShader =
      "attribute float yardHeight; varying float bandHeight;\n" +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nbandHeight = yardHeight;",
      );
    shader.fragmentShader =
      "varying float bandHeight; uniform vec3 bandPaint;\n" +
      shader.fragmentShader.replace(
        "#include <map_fragment>",
        `
        #include <map_fragment>
        float stripe = 1.0 - smoothstep(0.085, 0.09, abs(bandHeight - 0.62));
        float wear = clamp(texture2D(map, vMapUv).g * 3.4, 0.18, 1.);
        diffuseColor.rgb = mix(diffuseColor.rgb, bandPaint * (0.55 + wear * 0.45), stripe * wear);
      `,
      );
  };
  return mat;
}

function desertBluffs() {
  const positions: number[] = [],
    colors: number[] = [],
    indices: number[] = [];
  const random = randomSeed("rust sandstone escarpment");
  const strata = ["#b79171", "#aa7756", "#a16f50", "#bc8b66", "#bf9876"];
  const counts = 180;
  for (let i = 0; i < counts; i++) {
    const a = (i * 2 * Math.PI) / counts;
    const ridge =
      Math.sin(3 * a + 1) + 0.64 * Math.sin(7 * a) + 0.32 * Math.cos(13 * a);
    const height =
      5 + Math.min(1, Math.max(0, ridge + 0.35)) * 18 + 2 * random();
    const foot = 106 + 10 * Math.cos(a * 4) + 4 * random();
    const offsets = [0, 14, 19, 22, 33];
    const levels = [-2, height * 0.42, height * 0.56, height, height + 0.5];
    for (let j = 0; j < levels.length; j++) {
      const radius = foot + offsets[j];
      positions.push(radius * Math.cos(a), levels[j], radius * Math.sin(a));
      new T.Color(strata[j])
        .multiplyScalar(0.89 + 0.15 * random())
        .toArray(colors, colors.length);
      if (j === levels.length - 1) continue;
      const n = i * levels.length + j,
        next = ((i + 1) % counts) * levels.length + j;
      indices.push(n, next, n + 1, next, next + 1, n + 1);
    }
  }
  const geo = new T.BufferGeometry();
  geo.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return new T.Mesh(
    geo,
    new T.MeshLambertMaterial({ vertexColors: true, side: T.DoubleSide }),
  );
}

export async function drawOilYard(boxes: Box[], group: T.Group) {
  const textures = await loadSurfaces();
  function surface(
    finish: Finish,
    color: string,
    roughness: number,
    metalness = 0,
  ) {
    return new T.MeshStandardMaterial({
      ...textures[finish],
      color,
      roughness,
      metalness,
      side: T.DoubleSide,
    });
  }
  const gravel = surface("sandy_gravel", "#f4d6ad", 1);
  // A second, much broader sample breaks up the repetition in the service yard.
  gravel.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      `
      #include <map_fragment>
      vec3 dust = texture2D(map, vMapUv * 0.117 + vec2(0.37, 0.61)).rgb;
      diffuseColor.rgb *= mix(vec3(0.61, 0.56, 0.49), vec3(1.28, 1.22, 1.10), smoothstep(0.14, 0.46, dust.r));
    `,
    );
  };
  const concrete = surface("precast_concrete_wall", "#e1ddd0", 0.96);
  const oxide = surface("rusty_painted_metal", "#ebcab0", 0.83, 0.12);
  const pipe = surface("rusty_metal_02", "#ac8971", 0.72, 0.18);
  const steel = surface("corrugated_iron", "#a0b4be", 0.62, 0.22);
  const vessel = surface("rusty_metal_02", "#c6d0c1", 0.79, 0.12);
  const safety = surface("corrugated_iron", "#ffc657", 0.69, 0.16);
  const red = surface("corrugated_iron", "#be4437", 0.67, 0.12);
  const siding = ["#69b6c0", "#ce7754", "#d6d9c4", "#78a29e"].map((color) =>
    surface("corrugated_iron", color, 0.76, 0.14),
  );
  const fence = fenceMaterial(),
    sign = yardSign(textures.rusty_painted_metal.map);
  const stop = new T.MeshStandardMaterial({
    side: T.DoubleSide,
    map: canvasMap(128, 128, (ctx) => {
      ctx.fillStyle = "#b73526";
      ctx.fillRect(0, 0, 128, 128);
      ctx.strokeStyle = "#e9dbbc";
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(64, 64, 57, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.fillStyle = "#f6edda";
      ctx.fillRect(23, 55, 82, 18);
    }),
  });
  const tank = paintedBand(vessel, "#267684");
  const drums = [oxide, vessel, siding[0], red].map((base) =>
    paintedBand(base, "#ebd3a0"),
  );
  group.add(desertBluffs());
  for (const box of boxes) {
    if (!box.mesh) continue;
    const name = box.name?.toLowerCase() ?? "";
    const variant = Number(name.match(/(\d+)$/)?.[0] || 0);
    const banded = /tank|barrel/.test(name);
    let material: T.Material = steel,
      metres = 2;
    if (name.includes("ground") || box.kind === "desert") {
      material = gravel;
      metres = 3.7;
    } else if (/concrete|tower base|storage.*base/.test(name)) {
      material = concrete;
      metres = 3.8;
    } else if (name.includes("net")) {
      material = fence;
      metres = 0.16;
    } else if (name.includes("board")) {
      material = sign;
    } else if (/sign/.test(name)) {
      material = stop;
    } else if (/ladder|railing/.test(name)) {
      material = safety;
    } else if (/barrel/.test(name)) {
      material = drums[variant % drums.length];
      metres = 1.3;
    } else if (/tank/.test(name)) {
      material = tank;
      metres = 3.5;
    } else if (/pipe|exhaust/.test(name)) {
      material = pipe;
      metres = 2.4;
    } else if (/pillar|tower/.test(name)) {
      material = oxide;
      metres = 3.2;
    } else if (/container|building|storage|shutter|door|panel/.test(name)) {
      material = siding[variant % siding.length];
      metres = 2.6;
    }
    const mesh = new T.Mesh(
      yardGeometry(box, metres, material === sign || material === stop, banded),
      material,
    );
    mesh.name = box.name || box.kind;
    mesh.castShadow = material !== gravel && material !== fence;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
}
