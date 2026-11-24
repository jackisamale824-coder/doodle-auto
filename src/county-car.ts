import * as T from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { assetUrl } from "./release-info.ts";
import { VEHICLES, type CountyCar, type VehicleKind } from "./county.ts";

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
    vertexShader: `uniform vec3 coat;
    varying vec3 tint, worldNormal, worldPosition, panelPosition;
    varying float enamel;
    #ifdef PANEL_DAMAGE
    uniform int count; uniform vec3 points[16], normals[16];
    #endif
    void main(){
      enamel=color.a;
      tint=mix(pow(color.rgb,vec3(2.2)),coat,enamel);
      panelPosition=position;
      vec3 p=position;
      #ifdef PANEL_DAMAGE
      for(int i=0;i<16;i++){if(i>=count)break;
        p-=normals[i]*.055*(1.-smoothstep(.015,.17,distance(position,points[i])))*max(0.,dot(normal,normals[i]));}
      #endif
      worldNormal=normalize(mat3(modelMatrix)*normal);
      worldPosition=(modelMatrix*vec4(p,1.)).xyz;
      gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);
    }`,
    fragmentShader: `varying vec3 tint,worldNormal,worldPosition,panelPosition;
    varying float enamel;
    #ifdef PANEL_DAMAGE
    uniform int count; uniform vec3 points[16];
    #endif
    void main(){
      vec3 n=normalize(worldNormal),l=normalize(vec3(-.55,1.,.35)),v=normalize(cameraPosition-worldPosition);
      float rim=pow(1.-max(0.,dot(n,v)),3.);
      vec3 paint=tint*(.50+.56*max(0.,dot(n,l)))+enamel*(vec3(.06,.12,.15)*rim+vec3(.75,.69,.55)*pow(max(0.,dot(n,normalize(l+v))),48.)*.48);
      #ifdef PANEL_DAMAGE
      for(int i=0;i<16;i++){if(i>=count)break;
        float r=distance(panelPosition,points[i]);paint=mix(paint,vec3(.085,.072,.06),1.-smoothstep(.018,.048,r));}
      #endif
      gl_FragColor=vec4(paint,1.);
      #include <colorspace_fragment>
    }`,
  });
  const glass = new T.MeshBasicMaterial({
    color: 0x73b1c4,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    side: T.FrontSide,
  });
  const paints = [
    0x1c9b9c, 0xf4b42b, 0xb84a44, 0x4379b3, 0xd47346, 0x537b58, 0x975c82,
    0xe7d3ae,
  ].map((hex) => {
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
  const shadow = panel(64, 64, (ctx) => {
    const shade = ctx.createRadialGradient(32, 32, 5, 32, 32, 32);
    shade.addColorStop(0, "rgba(30,34,42,.55)");
    shade.addColorStop(1, "rgba(30,34,42,0)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, 64, 64);
  });
  shadow.transparent = true;
  shadow.depthWrite = false;
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
      const footprint = new T.Mesh(
        new T.PlaneGeometry(2.4, kind === "delivery" ? 5.6 : 4.8),
        shadow,
      );
      footprint.rotation.x = -Math.PI / 2;
      footprint.position.y = 0.075;
      scene.add(footprint);
      templates.set(kind, scene);
    }),
  );
  const lettering = panel(256, 72, (ctx) => {
    ctx.fillStyle = "#f1f2ed";
    ctx.fillRect(0, 0, 256, 72);
    ctx.textAlign = "center";
    ctx.fillStyle = "#182d48";
    ctx.font = "bold 49px sans-serif";
    ctx.fillText("POLICE", 128, 47);
    ctx.font = "bold 18px sans-serif";
    ctx.fillText("SWITCHBACK COUNTY", 128, 67);
  });
  const markings = new T.Group();
  for (const side of [-1, 1]) {
    const sign = new T.Mesh(new T.PlaneGeometry(1.65, 0.46), lettering);
    sign.rotation.y = (side * Math.PI) / 2;
    sign.position.set(side * 1.057, 0.75, 0.1);
    markings.add(sign);
  }
  const bar = new T.Mesh(
    new T.BoxGeometry(1.18, 0.07, 0.26),
    new T.MeshBasicMaterial({ color: 0x152237 }),
  );
  bar.position.y = 1.49;
  markings.add(bar);
  const lamps = [0xff253e, 0x269dff].map((color, i) => {
    const lamp = new T.Mesh(
      new T.BoxGeometry(0.5, 0.14, 0.22),
      new T.MeshBasicMaterial({ color }),
    );
    lamp.name = i ? "blue-beacon" : "red-beacon";
    lamp.position.set(i ? 0.32 : -0.32, 1.58, 0);
    markings.add(lamp);
    return lamp;
  });
  const policePaint = paints[0].clone();
  policePaint.uniforms.coat.value.setHex(0x192a3b);
  return (kind: VehicleKind, finish: number, cruiser = false) => {
    const car = new CountyCarModel(
      templates.get(kind)!,
      cruiser ? policePaint : paints[finish % paints.length],
      paints[0],
    );
    if (cruiser) {
      const kit = markings.clone();
      car.add(kit);
      car.beacons = lamps.map((lamp) => {
        const light = kit.getObjectByName(lamp.name) as typeof lamp;
        light.material = lamp.material.clone();
        return light.material;
      });
    }
    return car;
  };
}
export class CountyCarModel extends T.Group {
  readonly seat: T.Vector3;
  readonly doorSide: number;
  beacons?: T.MeshBasicMaterial[];
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
  private glass: {
    mesh: T.Mesh;
    original: T.BufferGeometry;
    panes: number[];
  }[] = [];
  private damage = 0;
  private dentVersion = 0;
  private panelMaterials = new Map<T.Mesh, T.ShaderMaterial>();
  private smoke?: T.Group;
  private smokeStrength = 0;
  private sparksAt = 0;
  private fragments: {
    mesh: T.Mesh;
    velocity: T.Vector3;
    life: number;
    material: T.MeshBasicMaterial;
  }[] = [];
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
    model.traverse((o) => {
      if (o instanceof T.Mesh && o.userData.paneBits)
        this.glass.push({
          mesh: o,
          original: o.geometry,
          panes: o.userData.paneBits,
        });
    });
    this.add(model);
    this.levels.forEach((o, i) => (o.visible = i === 2));
  }
  get collisionModel() {
    return this.levels[0];
  }
  setDamage(car: CountyCar) {
    const mask = car.damage ?? 0;
    if (mask !== this.damage) {
      for (const [i, wheel] of this.wheels.entries()) {
        wheel.scale.y = mask & (1 << i) ? 0.42 : 1;
        wheel.position.y = this.radius * wheel.scale.y;
      }
      for (const { mesh, original, panes } of this.glass) {
        if (!panes.some((bit) => bit & (mask ^ this.damage))) continue;
        if (mesh.geometry !== original) mesh.geometry.dispose();
        mesh.geometry = original;
        mesh.userData.paneBits = panes;
        if (!panes.some((bit) => bit & mask)) continue;
        const geometry = new T.BufferGeometry();
        geometry.attributes = { ...original.attributes };
        const indices: number[] = [],
          remaining: number[] = [];
        panes.forEach((bit, face) => {
          if (mask & bit) return;
          remaining.push(bit);
          for (let i = 0; i < 3; ++i)
            indices.push(original.index!.getX(face * 3 + i));
        });
        geometry.setIndex(indices);
        mesh.geometry = geometry;
        mesh.userData.paneBits = remaining;
      }
      this.damage = mask;
    }
    if (this.dentVersion === (car.dentVersion ?? 0)) return;
    this.dentVersion = car.dentVersion ?? 0;
    for (const material of this.panelMaterials.values())
      material.uniforms.count.value = 0;
    for (const dent of car.dents ?? []) {
      for (const tier of this.levels) {
        const panel = tier.getObjectByName(tier.name + "_" + dent.panel);
        if (
          !(panel instanceof T.Mesh) ||
          !(panel.material instanceof T.ShaderMaterial)
        )
          continue;
        let material = this.panelMaterials.get(panel);
        if (!material) {
          material = panel.material.clone() as T.ShaderMaterial;
          material.defines = { ...material.defines, PANEL_DAMAGE: 1 };
          material.uniforms.count = { value: 0 };
          for (const key of ["points", "normals"])
            material.uniforms[key] = {
              value: Array.from({ length: 16 }, () => new T.Vector3()),
            };
          this.panelMaterials.set(panel, material);
          panel.material = material;
        }
        const i = material.uniforms.count.value++;
        material.uniforms.points.value[i].fromArray(dent.point);
        material.uniforms.normals.value[i].fromArray(dent.normal);
      }
    }
    this.smokeStrength = Math.min(1, Math.max(0, ((car.wear ?? 0) - 2) / 14));
    if (this.smokeStrength && !this.smoke) {
      this.smoke = new T.Group();
      const geo = new T.IcosahedronGeometry(1, 0);
      for (let i = 0; i < 4; i++)
        this.smoke.add(
          new T.Mesh(
            geo,
            new T.MeshBasicMaterial({
              color: 0x5e6266,
              transparent: true,
              depthWrite: false,
            }),
          ),
        );
      this.add(this.smoke);
    }
  }
  showImpact(part: number, point: T.Vector3, direction: T.Vector3) {
    this.spawnFragments(
      point,
      direction,
      part >= 16 ? 0xc9efff : part ? 0x333943 : 0xb5a184,
      part >= 16 ? 8 : 3,
    );
  }
  private spawnFragments(
    point: T.Vector3,
    direction: T.Vector3,
    color: number,
    count: number,
  ) {
    const host = this.parent ?? this;
    const position = host.worldToLocal(point.clone()),
      away = direction
        .clone()

        .negate();
    for (let i = 0; i < count && this.fragments.length < 42; i++) {
      const material = new T.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
        }),
        mesh = new T.Mesh(
          new T.TetrahedronGeometry(0.025 + Math.random() * 0.035),
          material,
        );
      mesh.position
        .copy(position)
        .add(
          new T.Vector3(
            (Math.random() - 0.5) * 0.14,
            (Math.random() - 0.5) * 0.14,
            (Math.random() - 0.5) * 0.14,
          ),
        );
      host.add(mesh);
      this.fragments.push({
        mesh,
        velocity: away
          .clone()
          .multiplyScalar(0.45 + Math.random() * 0.8)
          .add(
            new T.Vector3(
              (Math.random() - 0.5) * 2.2,
              0.8 + Math.random() * 2,
              (Math.random() - 0.5) * 2.2,
            ),
          ),
        life: 0.8 + Math.random() * 0.35,
        material,
      });
    }
  }
  private updateFragments(dt: number) {
    for (let i = this.fragments.length - 1; i >= 0; i--) {
      const fragment = this.fragments[i];
      fragment.life -= dt;
      fragment.velocity.y -= 4.5 * dt;
      fragment.mesh.position.addScaledVector(fragment.velocity, dt);
      fragment.mesh.rotation.x += dt * 6;
      fragment.mesh.rotation.z += dt * 4;
      fragment.material.opacity = Math.min(0.9, fragment.life * 1.2);
      if (fragment.life > 0) continue;
      fragment.mesh.removeFromParent();
      fragment.mesh.geometry.dispose();
      fragment.material.dispose();
      this.fragments.splice(i, 1);
    }
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
      level === 0 &&
      (!!driver?.startsWith("civilian-driver-") ||
        !!driver?.startsWith("police-"));
    this.beacons?.forEach((lamp, i) => {
      const flashing =
        driver?.startsWith("police-") || (!driver && this.elapsed < 12);
      const lit = flashing && Math.floor(now * 5) % 2 === i;
      lamp.color.setHex(
        i ? (lit ? 0x59cfff : 0x19395d) : lit ? 0xff4841 : 0x681b28,
      );
    });
    this.levels.forEach((o, i) => {
      o.visible = i === level;
      this.hinges[i].rotation.y = this.doorSide * 1.12 * openness;
    });
    if (distance < 30 && speed > 4 && this.damage & 15 && now > this.sparksAt) {
      this.sparksAt = now + 0.12;
      for (const [i, wheel] of this.wheels.entries())
        if (this.damage & (1 << i)) {
          const point = wheel.getWorldPosition(new T.Vector3());
          point.y -= this.radius * 0.4;
          this.spawnFragments(
            point,
            new T.Vector3(
              Math.sin(this.rotation.y),
              0,
              Math.cos(this.rotation.y),
            ),
            0xffbc53,
            1,
          );
        }
    }
    if (this.smoke) {
      this.smoke.visible = this.smokeStrength > 0 && distance < 65;
      if (this.smoke.visible)
        this.smoke.children.forEach((puff, i) => {
          const phase = (now * 0.9 + i / 4) % 1;
          puff.position.set(
            0.12 * Math.sin(now + i) * phase,
            this.seat.y + phase * 1.5,
            this.wheels[0].position.z + phase * 0.45,
          );
          puff.scale.setScalar(
            (0.07 + 0.23 * phase) * (0.6 + this.smokeStrength),
          );
          ((puff as T.Mesh).material as T.MeshBasicMaterial).opacity =
            (1 - phase) * this.smokeStrength * 0.65;
        });
    }
    this.updateFragments(dt);
  }
}
