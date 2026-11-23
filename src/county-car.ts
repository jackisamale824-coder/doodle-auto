import * as T from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { assetUrl } from "./release-info.ts";
import { VEHICLES, type VehicleKind } from "./county.ts";

function panel(
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext("2d")!);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  return new T.MeshBasicMaterial({ map: texture });
}
// The GLB seat marker is the driver's eye position. Bake the jacket, head and
// visor into one colored mesh so an occupied near-detail car adds one draw.
function seatedMotorist() {
  const parts = [
    [
      new T.CylinderGeometry(0.19, 0.15, 0.32, 7)
        .scale(1, 1, 0.72)
        .translate(0, -0.31, 0.025),
      0x39867e,
    ],
    [
      new T.SphereGeometry(1, 9, 6)
        .scale(0.145, 0.172, 0.14)
        .translate(0, -0.012, 0.01),
      0xf5efdf,
    ],
    [
      new T.BoxGeometry(0.22, 0.045, 0.045).translate(0, 0.012, -0.109),
      0x28364c,
    ],
  ] as const;
  const light = new T.Vector3(-0.55, 1, -0.4).normalize(),
    n = new T.Vector3();
  const baked = parts.map(([shape, tint]) => {
    const geo = shape.toNonIndexed();
    // Face normals keep the two paper-shading bands crisp.
    geo.computeVertexNormals();
    const normals = geo.getAttribute("normal"),
      colors: number[] = [];
    const base = new T.Color(tint),
      shade = new T.Color();
    for (let i = 0; i < normals.count; i++) {
      const brightness = n.fromBufferAttribute(normals, i).dot(light);
      shade
        .copy(base)
        .multiplyScalar(
          brightness > 0.35 ? 1 : brightness > -0.35 ? 0.79 : 0.58,
        );
      colors.push(shade.r, shade.g, shade.b);
    }
    geo.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
    return geo;
  });
  const body = new T.Mesh(
    mergeGeometries(baked)!,
    new T.MeshBasicMaterial({ vertexColors: true }),
  );
  body.name = "civilian-driver";
  body.visible = false;
  return body;
}
const driverFigure = seatedMotorist();
export async function loadFleet() {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const paint = new T.ShaderMaterial({
    vertexColors: true,
    uniforms: { coat: { value: new T.Color(0xf5f4ec) } },
    vertexShader: `uniform vec3 coat; varying vec3 tint; varying vec3 n; void main(){tint=mix(pow(color.rgb,vec3(2.2)),coat,color.a);n=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec3 tint;varying vec3 n;void main(){float sun=dot(normalize(n),normalize(vec3(-.5,1.,.45)));float band=smoothstep(-.2,-.12,sun)*.11+smoothstep(.48,.56,sun)*.13;gl_FragColor=vec4(mix(vec3(.13,.18,.39),tint,.76+band),1.);
 #include <colorspace_fragment>
 }`,
  });
  const glass = new T.MeshBasicMaterial({
    color: 0xa7c9e3,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    side: T.FrontSide,
  });
  const paints = [0xf5f4ec, 0xcbd9e9, 0x98afcc, 0xe2e7ee].map((hex) => {
    const material = paint.clone();
    material.uniforms.coat.value.setHex(hex);
    return material;
  });
  paint.dispose();
  const instruments = panel(256, 88, (ctx) => {
    ctx.fillStyle = "#293955";
    ctx.fillRect(0, 0, 256, 88);
    for (const cx of [70, 186]) {
      for (let j = 0; j <= 12; j++) {
        const a = (0.78 + j * 0.12) * Math.PI;
        ctx.strokeStyle = "#e4ebf1";
        ctx.lineWidth = j % 3 === 0 ? 4 : 2;
        ctx.beginPath();
        ctx.moveTo(cx + 32 * Math.cos(a), 54 + 32 * Math.sin(a));
        ctx.lineTo(cx + 41 * Math.cos(a), 54 + 41 * Math.sin(a));
        ctx.stroke();
      }
    }
    ctx.fillStyle = "#b4c8de";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("km/h", 70, 76);
    ctx.fillText("RPM", 186, 76);
  });
  const dial = new T.PlaneGeometry(0.33, 0.114),
    needleGeo = new T.PlaneGeometry(0.004, 0.041).translate(0, 0.019, 0);
  const needleMat = new T.MeshBasicMaterial({ color: 0xd7e9ff });
  const taxiLabel = panel(192, 54, (ctx) => {
    ctx.fillStyle = "#e6edf2";
    ctx.fillRect(0, 0, 192, 54);
    ctx.fillStyle = "#273d62";
    ctx.textAlign = "center";
    ctx.font = "bold 49px sans-serif";
    ctx.fillText("TAXI", 96, 45);
  });
  const templates = new Map<VehicleKind, T.Group>();
  await Promise.all(
    VEHICLES.map(async (kind) => {
      const { scene } = await loader.loadAsync(
        assetUrl("models/fleet/" + kind + ".glb"),
      );
      scene.traverse((o) => {
        if (o instanceof T.Mesh)
          o.material = o.name.includes("_glass_") ? glass : paints[0];
      });
      const dash = new T.Mesh(dial, instruments),
        wheel = scene.getObjectByName("near_steering")!;
      dash.position.copy(wheel.position);
      dash.position.z -= 0.115;
      dash.position.y += 0.103;
      scene.getObjectByName("near")!.add(dash);
      for (const [i, x] of [-0.075, 0.075].entries()) {
        const needle = new T.Mesh(needleGeo, needleMat);
        needle.name = "dial" + i;
        needle.position.set(x, -0.012, 0.001);
        dash.add(needle);
      }
      if (kind === "taxi") {
        const [lo, hi] = scene.userData.taxiSign;
        const geo = new T.PlaneGeometry(
          (hi[0] - lo[0]) * 0.93,
          (hi[1] - lo[1]) * 0.8,
        );
        for (const tier of ["near", "street"])
          for (const side of [-1, 1]) {
            const label = new T.Mesh(geo, taxiLabel);
            label.position.set(
              0,
              (hi[1] + lo[1]) / 2,
              side < 0 ? lo[2] - 0.003 : hi[2] + 0.003,
            );
            label.rotation.y = side < 0 ? Math.PI : 0;
            scene.getObjectByName(tier)!.add(label);
          }
      }
      templates.set(kind, scene);
    }),
  );
  return (kind: VehicleKind, finish: number) =>
    new CountyCarModel(
      templates.get(kind)!,
      paints[finish % paints.length],
      paints[0],
    );
}
export class CountyCarModel extends T.Group {
  readonly seat: T.Vector3;
  readonly doorSide: number;
  private motorist: T.Mesh;
  private radius: number;
  private hinges: T.Object3D[];
  private levels: T.Object3D[];
  private previous: string | null | undefined;
  private elapsed = 1;
  private lastTime = 0;
  private lastPosition = new T.Vector3();
  private roll = 0;
  private turn = 0;
  private steering: T.Object3D;
  private wheels: T.Object3D[];
  private needles: T.Object3D[];
  constructor(template: T.Group, coat: T.Material, baseCoat: T.Material) {
    super();
    const model = template.clone(true);
    model.traverse((o) => {
      if (o instanceof T.Mesh && o.material === baseCoat) o.material = coat;
    });
    this.needles = [
      model.getObjectByName("dial0")!,
      model.getObjectByName("dial1")!,
    ];
    this.seat = new T.Vector3().fromArray(model.userData.seat);
    this.doorSide = model.userData.doorSide;
    this.radius = model.userData.wheelRadius;
    const tiers = ["near", "street", "far"];
    this.levels = tiers.map((name) => model.getObjectByName(name)!);
    this.motorist = driverFigure.clone();
    this.motorist.position.copy(this.seat);
    this.levels[0].add(this.motorist);
    this.hinges = tiers.map((name) => model.getObjectByName(name + "_door")!);
    this.steering = model.getObjectByName("near_steering")!;
    this.wheels = ["fl", "fr", "rl", "rr"].map((name) =>
      model.getObjectByName("near_wheel_" + name)!,
    );
    this.add(model);
    this.levels.forEach((o, i) => (o.visible = i === 2));
  }
  update(driver: string | null, now: number, distance: number, steer = 0) {
    const dt = this.lastTime
      ? Math.min(0.12, Math.max(0, now - this.lastTime))
      : 0;
    this.elapsed += dt;
    if (this.previous !== undefined && driver !== this.previous)
      this.elapsed = 0;
    let speed = 0;
    if (driver && this.previous === driver) {
      const dx = this.position.x - this.lastPosition.x,
        dz = this.position.z - this.lastPosition.z;
      speed = dt > 0 ? Math.hypot(dx, dz) / dt : 0;
      this.roll +=
        (dx * Math.sin(this.rotation.y) + dz * Math.cos(this.rotation.y)) /
        this.radius;
    }
    this.needles.forEach(
      (n, i) =>
        (n.rotation.z = 2.18 - Math.min(1, speed / (i ? 43 : 50)) * 4.36),
    );
    this.lastPosition.copy(this.position);
    this.lastTime = now;
    this.turn += (steer - this.turn) * (1 - Math.exp(-12 * dt));
    if (this.steering) this.steering.rotation.z = -this.turn * 1.9;
    this.wheels.forEach((wheel, i) => {
      if (wheel) {
        wheel.rotation.x = this.roll;
        wheel.rotation.y = i < 2 ? -this.turn * 0.45 : 0;
      }
    });
    this.previous = driver;
    const t = Math.min(1, this.elapsed / 0.98);
    // Swing out, pause for the runner, then close at the front hinge.
    const openness =
      t < 0.36
        ? T.MathUtils.smoothstep(t, 0, 0.36)
        : 1 - T.MathUtils.smoothstep(t, 0.55, 1);
    const level = distance < 10 ? 0 : distance < 35 ? 1 : 2;
    this.motorist.visible =
      level === 0 && !!driver?.startsWith("civilian-driver-");
    this.levels.forEach((o, i) => {
      o.visible = i === level;
      this.hinges[i].rotation.y = this.doorSide * 1.12 * openness;
    });
  }
}
