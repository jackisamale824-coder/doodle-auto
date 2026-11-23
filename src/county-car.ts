import * as T from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { assetUrl } from "./release-info.ts";

const hinge = new T.Vector3(-0.88, 0.46, -0.72);
export async function loadCoupe() {
  const loader = new GLTFLoader();
  const paint = new T.ShaderMaterial({
    vertexColors: true,
    vertexShader: `varying vec3 tint; varying vec3 n; void main(){tint=pow(color.rgb,vec3(2.2));n=normalize(mat3(modelMatrix)*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec3 tint;varying vec3 n;void main(){float sun=dot(normalize(n),normalize(vec3(-.5,1.,.45)));float band=smoothstep(-.2,-.12,sun)*.11+smoothstep(.48,.56,sun)*.13;gl_FragColor=vec4(mix(vec3(.13,.18,.39),tint,.76+band),1.);
 #include <colorspace_fragment>
 }`,
  });
  const glass = new T.MeshBasicMaterial({
    color: 0xa7c9e3,
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    side: T.DoubleSide,
  });
  const templates = await Promise.all(
    ["near", "street", "far"].map(async (level) => {
      const model = (
        await loader.loadAsync(assetUrl("models/coupe-" + level + ".glb"))
      ).scene;
      const pivot = new T.Group();
      pivot.name = "driver-hinge";
      pivot.position.copy(hinge);
      const parts: T.Mesh[] = [];
      model.traverse((o) => {
        if (o instanceof T.Mesh) parts.push(o);
      });
      model.add(pivot);
      for (const m of parts) {
        m.material = m.name.includes("glass") ? glass : paint;
        if (m.name.startsWith("door")) pivot.attach(m);
      }
      for (const m of parts) {
        if (m.name !== "steering" && !m.name.startsWith("wheel_")) continue;
        const joint = new T.Group();
        joint.name = m.name + "-joint";
        if (m.name === "steering") joint.position.set(-0.345, 0.795, -0.36);
        else {
          m.geometry.computeBoundingBox();
          m.geometry.boundingBox!.getCenter(joint.position);
        }
        joint.rotation.order = "YXZ";
        model.add(joint);
        joint.attach(m);
      }
      return model;
    }),
  );
  return () => new CountyCarModel(templates);
}
export class CountyCarModel extends T.Group {
  private hinges: T.Object3D[];
  private levels: T.Object3D[];
  private previous: string | null | undefined;
  private elapsed = 1;
  private lastTime = 0;
  private lastPosition = new T.Vector3();
  private roll = 0;
  private turn = 0;
  private steering: T.Object3D | null;
  private wheels: T.Object3D[];
  constructor(templates: T.Object3D[]) {
    super();
    this.levels = templates.map((o) => o.clone(true));
    this.hinges = this.levels.map((o) => o.getObjectByName("driver-hinge")!);
    this.add(...this.levels);
    this.steering = this.levels[0].getObjectByName("steering-joint") ?? null;
    this.wheels = ["fl", "fr", "rl", "rr"].map((name) =>
      this.levels[0].getObjectByName("wheel_" + name + "-joint")!,
    );
  }
  update(driver: string | null, now: number, distance: number, steer = 0) {
    const dt = this.lastTime
      ? Math.min(0.12, Math.max(0, now - this.lastTime))
      : 0;
    this.elapsed += dt;
    if (this.previous !== undefined && driver !== this.previous)
      this.elapsed = 0;
    if (driver && this.previous === driver) {
      const dx = this.position.x - this.lastPosition.x,
        dz = this.position.z - this.lastPosition.z;
      this.roll +=
        (dx * Math.sin(this.rotation.y) + dz * Math.cos(this.rotation.y)) /
        0.36;
    }
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
    this.levels.forEach((o, i) => {
      o.visible = i === level;
      this.hinges[i].rotation.y = -1.12 * openness;
    });
  }
}
