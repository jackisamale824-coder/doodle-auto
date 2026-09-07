import * as T from "three";
import { type City, type Box, type V3, randomSeed } from "./world.ts";
export const INK = "#253ba9",
  RED = "#d23c45",
  PAPER = "#f6f2e6",
  GOLD = "#dfa52b";
const vertex = `varying vec3 vNormal; varying vec3 vWorld; varying float vDepth;
void main(){vec4 p=vec4(position,1.);vec3 n=normal;
#ifdef USE_INSTANCING
p=instanceMatrix*p;n=mat3(instanceMatrix)*n;
#endif
vec4 world=modelMatrix*p;vWorld=world.xyz;vNormal=normalize(mat3(modelMatrix)*n);vec4 view=viewMatrix*world;vDepth=-view.z;gl_Position=projectionMatrix*view;}`;
const fragment = `precision highp float;uniform vec3 uInk;uniform vec3 uPaper;uniform float uFill;varying vec3 vNormal;varying vec3 vWorld;varying float vDepth;
void main(){vec3 n=normalize(vNormal);float light=dot(n,normalize(vec3(-.55,1.,.35)));float shade=clamp((1.-light)*.44,0.,.8);
float hatch=1.-smoothstep(.85,1.7,abs(mod(gl_FragCoord.x+gl_FragCoord.y*.9,7.)-3.5));float cross=1.-smoothstep(.7,1.35,abs(mod(gl_FragCoord.x-gl_FragCoord.y*.8,9.)-4.5));
float strength=hatch*shade*.44+cross*max(0.,shade-.48)*.65;strength=max(strength,uFill);vec3 color=mix(uPaper,uInk,clamp(strength,0.,1.));float fog=smoothstep(42.,150.,vDepth);color=mix(color,uPaper,fog*.86);gl_FragColor=vec4(color,1.);
#include <colorspace_fragment>
}`;
export function inkMaterial(ink = INK, fill = 0) {
  return new T.ShaderMaterial({
    uniforms: {
      uInk: { value: new T.Color(ink) },
      uPaper: { value: new T.Color(PAPER) },
      uFill: { value: fill },
    },
    vertexShader: vertex,
    fragmentShader: fragment,
    side: T.DoubleSide,
  });
}
export function stroke(
  a: T.Vector3,
  b: T.Vector3,
  color = INK,
  radius = 0.025,
) {
  const delta = b.clone().sub(a),
    m = new T.Mesh(
      new T.CylinderGeometry(radius, radius, delta.length(), 5),
      new T.MeshBasicMaterial({ color }),
    );
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), delta.normalize());
  return m;
}
export function outlinedBox(
  size: V3,
  pos: V3,
  material: T.Material,
  group: T.Group,
  color = INK,
) {
  const geo = new T.BoxGeometry(...size),
    m = new T.Mesh(geo, material);
  m.position.set(...pos);
  const edge = new T.LineSegments(
    new T.EdgesGeometry(geo),
    new T.LineBasicMaterial({ color }),
  );
  m.add(edge);
  group.add(m);
  return m;
}
export function label(
  text: string,
  width = 512,
  color = INK,
  bg: string | null = null,
) {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = 128;
  const ctx = c.getContext("2d")!;
  if (bg) {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, width, 128);
  }
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = 'bold 52px "Patrick Hand", cursive';
  ctx.fillText(text, width / 2, 66, width - 20);
  const tex = new T.CanvasTexture(c);
  tex.colorSpace = T.SRGBColorSpace;
  const mesh = new T.Mesh(
    new T.PlaneGeometry(width / 128, 1),
    new T.MeshBasicMaterial({
      map: tex,
      transparent: true,
      side: T.DoubleSide,
      depthWrite: false,
    }),
  );
  return mesh;
}
export class Renderer {
  renderer: T.WebGLRenderer;
  scene = new T.Scene();
  camera = new T.PerspectiveCamera(82, 1, 0.06, 230);
  cityGroup = new T.Group();
  beaconMeshes: T.Group[] = [];
  decor: T.Group[] = [];
  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new T.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.setClearColor(PAPER);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.outputColorSpace = T.SRGBColorSpace;
    this.scene.background = new T.Color(PAPER);
    this.scene.fog = new T.Fog(PAPER, 55, 155);
    this.camera.rotation.order = "YXZ";
    this.scene.add(this.cityGroup, this.camera);
    this.resize();
  }
  resize() {
    this.renderer.setSize(innerWidth, innerHeight);
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
  }
  setQuality(high: boolean) {
    this.renderer.setPixelRatio(high ? Math.min(devicePixelRatio, 1.5) : 1);
    this.resize();
  }
  build(city: City) {
    disposeGroup(this.cityGroup);
    this.cityGroup = new T.Group();
    this.scene.add(this.cityGroup);
    this.beaconMeshes = [];
    this.decor = [];
    const groups = new Map<string, Box[]>();
    for (const b of city.boxes) {
      if (b.kind === "collision") continue;
      const kind = ["ground", "road", "mark", "pavement", "metal"].includes(
        b.kind,
      )
        ? b.kind
        : "building";
      if (!groups.has(kind)) groups.set(kind, []);
      groups.get(kind)!.push(b);
    }
    const edgeVertices: number[] = [],
      unit = new T.BoxGeometry(1, 1, 1),
      unitEdges = new T.EdgesGeometry(unit).getAttribute("position");
    for (const [kind, boxes] of groups) {
      const fill =
          kind === "mark"
            ? 0.28
            : kind === "road"
              ? 0.045
              : kind === "metal"
                ? 0.16
                : 0,
        material = inkMaterial(INK, fill),
        inst = new T.InstancedMesh(unit.clone(), material, boxes.length),
        matrix = new T.Matrix4();
      boxes.forEach((b, i) => {
        matrix.compose(
          new T.Vector3(...b.p),
          new T.Quaternion(),
          new T.Vector3(...b.s),
        );
        inst.setMatrixAt(i, matrix);
        if (!["ground", "road", "mark", "stairs"].includes(b.kind)) {
          for (let j = 0; j < unitEdges.count; j++) {
            edgeVertices.push(
              unitEdges.getX(j) * b.s[0] + b.p[0],
              unitEdges.getY(j) * b.s[1] + b.p[1],
              unitEdges.getZ(j) * b.s[2] + b.p[2],
            );
          }
        }
      });
      inst.computeBoundingSphere();
      this.cityGroup.add(inst);
    }
    const edges = new T.BufferGeometry();
    edges.setAttribute(
      "position",
      new T.Float32BufferAttribute(edgeVertices, 3),
    );
    this.cityGroup.add(
      new T.LineSegments(
        edges,
        new T.LineBasicMaterial({
          color: INK,
          transparent: true,
          opacity: 0.76,
        }),
      ),
    );
    for (const b of city.buildings) {
      const sign = label(b.name, 512, INK, PAPER);
      sign.scale.set(Math.min(b.w / 5, 2.4), 0.72, 1);
      sign.position.set(b.x, 2.85, b.z + b.d / 2 + 0.21);
      this.cityGroup.add(sign);
      const number = label(String(b.id + 1).padStart(2, "0"), 128);
      number.scale.set(0.45, 0.45, 0.45);
      number.position.set(b.x + 2.6, 1.7, b.z + b.d / 2 + 0.25);
      this.cityGroup.add(number);
      if (b.kind === "shop") {
        const awning = new T.Group();
        outlinedBox([6, 0.12, 1.8], [0, 0, 0], inkMaterial(INK, 0.08), awning);
        awning.position.set(b.x, 2.6, b.z + b.d / 2 + 0.8);
        awning.rotation.x = 0.12;
        this.cityGroup.add(awning);
        for (let i = -3; i <= 3; i++) {
          const stripe = new T.Mesh(
            new T.BoxGeometry(0.08, 0.025, 1.8),
            inkMaterial(INK, 0.6),
          );
          stripe.position.set(i, 0.08, 0);
          awning.add(stripe);
        }
      }
      // Antennas and rooftop water tanks give buildings varied, readable silhouettes.
      if (b.id % 4 === 0) {
        const tank = new T.Group(),
          mat = inkMaterial();
        const barrel = new T.Mesh(
          new T.CylinderGeometry(1.2, 1.2, 2.2, 10),
          mat,
        );
        barrel.position.y = 2.3;
        tank.add(barrel);
        const roof = new T.Mesh(new T.ConeGeometry(1.3, 0.6, 10), mat);
        roof.position.y = 3.7;
        tank.add(roof);
        for (const part of [barrel, roof])
          part.add(
            new T.LineSegments(
              new T.EdgesGeometry(part.geometry, 20),
              new T.LineBasicMaterial({
                color: INK,
                transparent: true,
                opacity: 0.75,
              }),
            ),
          );
        for (const x of [-0.8, 0.8])
          for (const z of [-0.8, 0.8])
            tank.add(stroke(new T.Vector3(x, 0, z), new T.Vector3(x, 1.3, z)));
        tank.position.set(b.x + 4, b.height, b.z - 4);
        this.cityGroup.add(tank);
      }
      if (b.id % 3 === 0) {
        const antenna = new T.Group();
        antenna.add(stroke(new T.Vector3(), new T.Vector3(0, 3, 0)));
        for (let h = 1.5; h < 3; h += 0.5)
          antenna.add(
            stroke(new T.Vector3(-0.8, h, 0), new T.Vector3(0.8, h, 0)),
          );
        antenna.position.set(b.x + 3, b.height, b.z + 5);
        this.cityGroup.add(antenna);
      }
    }
    const rand = randomSeed(city.seed + "decor");
    for (let i = -2; i <= 2; i++)
      for (let j = -2; j <= 2; j++) {
        const x = i * 30 + 12,
          z = j * 30 + 12;
        const lamp = new T.Group();
        lamp.add(stroke(new T.Vector3(), new T.Vector3(0, 5, 0), INK, 0.045));
        lamp.add(
          stroke(new T.Vector3(0, 5, 0), new T.Vector3(1.1, 5, 0), INK, 0.035),
        );
        outlinedBox([0.8, 0.2, 0.5], [1, 4.9, 0], inkMaterial(), lamp);
        lamp.position.set(x, 0, z);
        this.cityGroup.add(lamp);
        if ((i + j) % 2 === 0) {
          const tree = new T.Group();
          tree.add(
            stroke(new T.Vector3(), new T.Vector3(0, 2.7, 0), INK, 0.12),
          );
          for (let k = 0; k < 5; k++) {
            const canopy = new T.Mesh(
              new T.IcosahedronGeometry(0.9 + rand() * 0.4, 1),
              inkMaterial(INK, 0.04),
            );
            canopy.position.set(
              Math.cos(k * 2) * 0.65,
              2.8 + rand(),
              Math.sin(k * 2) * 0.65,
            );
            const edge = new T.LineSegments(
              new T.EdgesGeometry(canopy.geometry, 30),
              new T.LineBasicMaterial({
                color: INK,
                transparent: true,
                opacity: 0.4,
              }),
            );
            canopy.add(edge);
            tree.add(canopy);
          }
          tree.position.set(x - 1, 0, z - 3);
          this.cityGroup.add(tree);
        }
        if ((i + j) % 3 === 0) {
          const car = new T.Group(),
            mat = inkMaterial();
          outlinedBox([1.8, 0.65, 3.7], [0, 0.7, 0], mat, car);
          outlinedBox([1.5, 0.65, 1.8], [0, 1.3, 0], mat, car);
          for (const x of [-0.95, 0.95])
            for (const z of [-1.2, 1.2]) {
              const wheel = new T.Mesh(
                new T.CylinderGeometry(0.33, 0.33, 0.15, 10),
                inkMaterial(INK, 0.7),
              );
              wheel.rotation.z = Math.PI / 2;
              wheel.position.set(x, 0.4, z);
              car.add(wheel);
            }
          car.position.set(i * 30 + 12.8, 0, j * 30 + 3);
          this.cityGroup.add(car);
        }
      }
    // Overhead telephone wires curve across alleys.
    for (let i = -1; i <= 1; i++) {
      const curve = new T.CatmullRomCurve3([
        new T.Vector3(-10, 8, i * 30 + 10),
        new T.Vector3(15, 6, i * 30 + 10),
        new T.Vector3(40, 8, i * 30 + 10),
      ]);
      const geo = new T.BufferGeometry().setFromPoints(curve.getPoints(40));
      this.cityGroup.add(
        new T.Line(
          geo,
          new T.LineBasicMaterial({
            color: INK,
            transparent: true,
            opacity: 0.55,
          }),
        ),
      );
    }
    city.beacons.forEach((p, i) => {
      const g = new T.Group(),
        mat = new T.MeshBasicMaterial({ color: GOLD });
      for (let h = 0; h < 3; h++) {
        const ring = new T.Mesh(
          new T.TorusGeometry(0.8 + h * 0.13, 0.035, 5, 36),
          mat,
        );
        ring.rotation.x = Math.PI / 2;
        ring.position.y = 0.2 + h * 0.45;
        g.add(ring);
      }
      const diamond = new T.Mesh(
        new T.OctahedronGeometry(0.5),
        inkMaterial(GOLD, 0.3),
      );
      diamond.position.y = 1.6;
      g.add(diamond);
      const text = label("0" + (i + 1), 128, GOLD);
      text.position.y = 2.7;
      text.scale.set(0.8, 0.8, 0.8);
      g.add(text);
      g.position.set(...p);
      this.cityGroup.add(g);
      this.beaconMeshes.push(g);
    });
    unit.dispose();
  }
  draw(time: number) {
    this.beaconMeshes.forEach((b, i) => {
      if (b.visible) {
        b.rotation.y = time * 0.6;
        b.children[3].position.y = 1.6 + Math.sin(time * 2 + i) * 0.15;
      }
    });
    this.renderer.render(this.scene, this.camera);
  }
}
export function disposeGroup(group: T.Group) {
  group.parent?.remove(group);
  const geos = new Set<T.BufferGeometry>(),
    mats = new Set<T.Material>(),
    textures = new Set<T.Texture>();
  group.traverse((o) => {
    const m = o as T.Mesh;
    if (m.geometry) geos.add(m.geometry);
    if (m.material)
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        mats.add(mat);
        const map = (mat as T.MeshBasicMaterial).map;
        if (map) textures.add(map);
      }
  });
  geos.forEach((g) => g.dispose());
  mats.forEach((m) => m.dispose());
  textures.forEach((t) => t.dispose());
  group.clear();
}
