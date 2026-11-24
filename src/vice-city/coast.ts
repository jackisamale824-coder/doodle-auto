import * as T from "three";
import { randomSeed } from "../world";

export const avenues = [-90, -40, 10, 60];
export const streets = [-100, -50, 0, 50, 100];
export type Point = { x: number; z: number };
type Block = Point & { w: number; d: number };
const random = randomSeed("vice-coast-ocean-strip");
const pick = <T>(options: T[]) =>
  options[Math.floor(random() * options.length)];

export function buildCoast(scene: T.Scene) {
  const blocks: Block[] = [];
  const boxGeo = new T.BoxGeometry();
  const disc = new T.CylinderGeometry(1, 1, 1, 12);
  const leaf = new T.BufferGeometry();
  leaf.setAttribute(
    "position",
    new T.Float32BufferAttribute(
      [
        0, 0, 0, 0.23, 0.57, 1.4, 0, 0.76, 1.65, 0, 0, 0, 0, 0.76, 1.65, -0.3,
        0.52, 1.4, 0.23, 0.57, 1.4, 0, -0.2, 3.3, 0, 0.76, 1.65, 0, 0.76, 1.65,
        0, -0.2, 3.3, -0.3, 0.52, 1.4,
      ],
      3,
    ),
  );
  leaf.computeVertexNormals();
  const groups = new Map<
    T.BufferGeometry,
    { matrix: T.Matrix4; color: number }[]
  >();
  const transform = new T.Object3D();
  function piece(
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: number,
    geo: T.BufferGeometry = boxGeo,
    yaw = 0,
    tilt = 0,
  ) {
    transform.position.set(x, y, z);
    transform.scale.set(w, h, d);
    transform.rotation.set(0, yaw, tilt);
    transform.updateMatrix();
    if (!groups.has(geo)) groups.set(geo, []);
    groups.get(geo)!.push({ matrix: transform.matrix.clone(), color });
  }
  const sea = 0x3aadb2,
    sand = 0xf2cc9b,
    road = 0x504955;
  piece(0, -1.05, 0, 2000, 1.3, 2000, sea);
  piece(-8, -0.41, 0, 226, 0.78, 250, sand);
  piece(-15, -0.24, 0, 175, 0.5, 218, 0xc4ab9d);
  for (const x of avenues) piece(x, 0.028, 0, 13, 0.04, 215, road);
  for (const z of streets) piece(-15, 0.04, z, 164, 0.035, 13, road);
  for (const x of avenues)
    for (let z = -103; z <= 105; z += 5)
      if (streets.every((v) => Math.abs(z - v) > 7))
        piece(x, 0.06, z, 0.13, 0.02, 2, 0xf2bd81);
  for (const z of streets)
    for (let x = -92; x <= 65; x += 5)
      if (avenues.every((v) => Math.abs(x - v) > 7))
        piece(x, 0.069, z, 2, 0.02, 0.13, 0xf2bd81);
  for (const x of avenues)
    for (const z of streets)
      for (const offset of [-8, 8])
        for (let i = -4; i <= 4; i += 2)
          piece(x + i, 0.07, z + offset, 0.77, 0.018, 1.65, 0xe5ceba);
  function palm(x: number, z: number, scale = 1) {
    const h = 6.7 * scale;
    piece(x, h / 2, z, 0.22 * scale, h, 0.22 * scale, 0x845e57, disc, 0, -0.07);
    for (let j = 0; j < 9; j++)
      piece(
        x + h * 0.035,
        h,
        z,
        1.8 * scale,
        1.45 * scale,
        1.35 * scale,
        j % 2 ? 0x2b796e : 0x368c79,
        leaf,
        j * 0.698 + z,
        0,
      );
  }
  for (let z = -108; z <= 108; z += 10) {
    palm(69, z, 0.85 + random() * 0.38);
    if (z % 20 === -8 || random() > 0.55)
      palm(88 + random() * 6, z, 0.82 + random() * 0.42);
    piece(76, 0.02, z, 0.25, 0.04, 9.9, 0xffe5b5);
    piece(104, 0.015, z, 1 + random() * 2, 0.04, 6, 0xc7f4de);
  }
  for (let j = 0; j < 80; j++)
    piece(
      115 + random() * 160,
      -0.34,
      -210 + random() * 420,
      1 + random() * 9,
      0.05,
      0.17,
      0xa2ddd0,
    );
  // Beach clubs, hotels and storefronts occupy the lots between the avenues.
  const hues = [0xe69b9c, 0x99c5bd, 0xecc797, 0xdbb7cc, 0xa2c4d5, 0xeac0ab];
  const stripe = [0x72ded1, 0xff86ae, 0xffdf91];
  for (let ix = 0; ix < avenues.length - 1; ix++)
    for (let iz = 0; iz < streets.length - 1; iz++) {
      const west = avenues[ix],
        north = streets[iz];
      for (const dx of [15, 35])
        for (const dz of [15, 35]) {
          const x = west + dx,
            z = north + dz,
            w = 12 + random() * 3,
            d = 12 + random() * 3;
          const h =
            (ix === 2 ? 7 : 10) + Math.floor(random() * (ix === 0 ? 25 : 10));
          const wall = pick(hues),
            trim = pick(stripe);
          blocks.push({ x, z, w: w + 1, d: d + 1 });
          piece(x, h / 2, z, w, h, d, wall);
          piece(x, h + 0.22, z, w + 1, 0.44, d + 1, 0xf9ddc1);
          piece(x, h + 0.8, z, w * 0.68, 1.25, d * 0.65, wall);
          const face = dx === 35 ? 1 : -1;
          for (let y = 2.9; y < h - 0.65; y += 2.85) {
            piece(
              x + face * (w / 2 + 0.03),
              y,
              z,
              0.1,
              0.95,
              d * 0.84,
              0x536574,
            );
            for (let k = -4; k <= 4; k += 2)
              piece(
                x + face * (w / 2 + 0.12),
                y,
                z + k,
                0.18,
                1.08,
                0.27,
                wall,
              );
            piece(
              x + face * (w / 2 + 0.27),
              y - 0.66,
              z,
              0.66,
              0.22,
              d + 0.25,
              trim,
            );
            piece(x, y, z + d / 2 + 0.04, w * 0.85, 0.8, 0.12, 0x626778);
            for (let k = -4; k <= 4; k += 2)
              piece(x + k, y, z + d / 2 + 0.13, 0.3, 0.94, 0.22, wall);
          }
          piece(x + face * (w / 2 + 0.6), 2.4, z, 1.65, 0.32, d * 0.81, trim);
          piece(x + face * (w / 2 + 0.06), 1, z, 0.16, 1.9, 1.55, 0x525766);
        }
    }
  function sign(text: string, x: number, y: number, z: number, tint: string) {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 96;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#33304a";
    ctx.fillRect(0, 0, 512, 96);
    ctx.fillStyle = tint;
    ctx.font = "italic bold 52px Georgia";
    ctx.textAlign = "center";
    ctx.fillText(text, 256, 62);
    const texture = new T.CanvasTexture(c);
    texture.colorSpace = T.SRGBColorSpace;
    const mesh = new T.Mesh(
      new T.PlaneGeometry(10.6, 2),
      new T.MeshBasicMaterial({ map: texture }),
    );
    mesh.rotation.y = Math.PI / 2;
    mesh.position.set(x, y, z);
    scene.add(mesh);
  }
  for (const [i, name] of [
    "MARLIN CLUB",
    "PALM MOTEL",
    "SUNSET FM",
    "THE LIDO",
  ].entries())
    sign(name, 53.4, 4.05, -65 + 50 * i, i % 2 ? "#9affdf" : "#ff9fbd");
  for (let z = -93; z <= 99; z += 16) {
    piece(67, 2.4, z, 0.12, 4.8, 0.12, 0x565467);
    piece(66.5, 4.8, z, 1.1, 0.17, 0.22, 0xffe6aa);
    if (z % 32 === -29) {
      piece(83, 1.3, z, 0.09, 2.5, 0.09, 0xefdfc5);
      piece(83, 2.55, z, 1.9, 0.3, 1.9, 0xed8895, disc);
    }
  }
  // Low mountains and a distant skyline give the island a horizon in every direction.
  for (let i = 0; i < 65; i++) {
    const x = -160 - random() * 100,
      z = -240 + random() * 480,
      h = 12 + random() * 58;
    piece(x, h / 2 - 1, z, 6 + random() * 13, h, 7 + random() * 10, 0x967d97);
  }
  const pierZ = -71;
  piece(104, 0.35, pierZ, 44, 0.7, 4.7, 0xa4806d);
  for (let x = 87; x < 128; x += 5)
    for (const s of [-1, 1])
      piece(x, -0.2, pierZ + s * 2, 0.35, 2, 0.35, 0x68556a);
  const sail = new T.ConeGeometry(1, 1, 3);
  for (let i = 0; i < 8; i++) {
    const x = 125 + random() * 60,
      z = -120 + i * 32;
    piece(x, -0.01, z, 1.25, 0.7, 3.7, 0xf8dcb5, disc);
    piece(x, 2, z, 0.07, 4, 0.07, 0x655b70);
    piece(x + 0.48, 2, z, 1.1, 3.8, 0.07, i % 2 ? 0xf89b9d : 0xffdec0, sail);
  }
  for (const [geo, items] of groups) {
    const mesh = new T.InstancedMesh(
      geo,
      new T.MeshLambertMaterial({
        side: geo === leaf ? T.DoubleSide : T.FrontSide,
      }),
      items.length,
    );
    items.forEach(({ matrix, color }, i) => {
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, new T.Color(color));
    });
    scene.add(mesh);
  }
  const sky = new T.Mesh(
    new T.SphereGeometry(520, 48, 24),
    new T.ShaderMaterial({
      side: T.BackSide,
      depthWrite: false,
      vertexShader:
        "varying vec3 ray; void main(){ray=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}",
      fragmentShader: `varying vec3 ray;
    void main(){vec3 p=normalize(ray); float h=max(0.,p.y);
      vec3 col=mix(vec3(1.,.65,.45),vec3(.82,.46,.65),smoothstep(0.,.23,h));
      col=mix(col,vec3(.28,.40,.66),smoothstep(.19,.72,h));
      float sun=distance(p,normalize(vec3(.46,.14,-1.)));
      col+=vec3(.33,.2,.045)*exp(-sun*9.);
      col=mix(col,vec3(1.,.91,.65),1.-smoothstep(.092,.095,sun));
      gl_FragColor=vec4(col,1.);}`,
    }),
  );
  scene.add(sky);
  scene.fog = new T.FogExp2(0xe5a5a1, 0.0043);
  scene.add(new T.HemisphereLight(0xffe6df, 0xc39fac, 2.0));
  const light = new T.DirectionalLight(0xffdbad, 1.65);
  light.position.set(80, 110, -64);
  scene.add(light);
  return {
    blocks,
    canStand(x: number, z: number, r: number) {
      if (x < -97 + r || x > 102 - r || Math.abs(z) > 107 - r) return false;
      return !blocks.some(
        (b) =>
          Math.abs(x - b.x) < b.w / 2 + r && Math.abs(z - b.z) < b.d / 2 + r,
      );
    },
  };
}
