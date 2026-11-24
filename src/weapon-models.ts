import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import {
  FLASH,
  KNIFE,
  MAMMOTH,
  SMG,
  isGrenade,
  WEAPONS,
} from "./weapon-balance.ts";
import { disposeGroup } from "./render.ts";

const colors = [
  "548399",
  "47778b",
  "516f91",
  "596e83",
  "",
  "747c8d",
  "586977",
  "4e7475",
  "567e8f",
  "6c8193",
  "688c9b",
  "64776d",
  "869cae",
];
const stripes: Record<number, [number, number, string]> = {
  0: [0.32, 0.35, "70cecb"],
  2: [0.27, 0.62, "8bc6e7"],
  3: [0.8, 0.3, "a2c775"],
  8: [0.29, 0.46, "81c5b5"],
};
const flashPaint: Record<string, string> = {
  "938063": "bda16c",
  "4d412a": "554b39",
  "553931": "734d43",
  "43746e": "439e97",
};
const rgb = (hex: string) =>
  new T.Color(Number.parseInt(hex, 16)).convertLinearToSRGB();
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
const models = new Map<number, Promise<T.Group>>();

function enamel(material: T.Material, id: number) {
  if (!(material instanceof T.MeshStandardMaterial)) return;
  const stripe = stripes[id] ?? [3, 3, "ffffff"];
  const shell = id === FLASH && flashPaint[material.color.getHexString()];
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      enamel: { value: rgb(colors[id]) },
      shellPaint: { value: shell ? rgb(shell) : new T.Vector3(-1, 0, 0) },
      printColor: { value: rgb(stripe[2]) },
      printStart: { value: new T.Vector2(stripe[0], stripe[1]) },
    });
    shader.vertexShader =
      "attribute vec2 paintCoord; varying vec2 onProp;\n" +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nonProp=paintCoord;",
      );
    shader.fragmentShader =
      "uniform vec3 enamel,shellPaint,printColor; uniform vec2 printStart; varying vec2 onProp;\n" +
      shader.fragmentShader.replace(
        "#include <opaque_fragment>",
        `
      vec3 pigment=sRGBTransferOETF(vec4(diffuseColor.rgb,1.)).rgb;
      float value=floor(smoothstep(.025,.92,dot(pigment,vec3(.29,.56,.15)))*5.+.5)/5.;
      vec3 base=mix(enamel*.68,vec3(.82,.89,.89),value);
      float warm=smoothstep(.014,.105,pigment.r-pigment.b)*smoothstep(-.012,.035,pigment.r-pigment.g);
      float brass=smoothstep(.52,.9,(pigment.g-pigment.b)/max(.02,pigment.r-pigment.b));
      base=mix(base,mix(vec3(.77,.395,.19),vec3(.79,.65,.33),brass)*(.68+.72*value),warm);
      float leaf=smoothstep(.012,.075,pigment.g-pigment.r)*smoothstep(.014,.085,pigment.g-pigment.b);
      base=mix(base,vec3(.40,.55,.32)*(.72+.72*value),leaf);
      float teal=smoothstep(.035,.12,pigment.g-pigment.r)*smoothstep(-.04,.035,pigment.b-pigment.r);
      base=mix(base,vec3(.19,.66,.62)*(.72+.55*value),teal);
      if(shellPaint.x>=0.)base=shellPaint*(.94+.07*value);
      float s=onProp.x+.10*(onProp.y-.65)-printStart.x;
      float stripe=max(step(0.,s)-step(.023,s),step(.037,s)-step(.047,s));
      base=mix(base,printColor,stripe*step(printStart.y,onProp.y));
      float light=dot(normal,normalize(vec3(-.46,.81,.38)));
      vec3 shade=base*vec3(.58,.62,.78)+vec3(.015,.024,.044);
      vec3 paint=mix(shade,base,smoothstep(-.035,.025,light));
      paint=mix(paint,min(vec3(.98),base*1.12+vec3(.06,.05,.025)),smoothstep(.65,.69,light)*.83);
      outgoingLight=sRGBTransferEOTF(vec4(paint,1.)).rgb;
      #include <opaque_fragment>
    `,
      );
  };
  material.toneMapped = false;
}

function template(id: number) {
  let pending = models.get(id);
  if (pending) return pending;
  pending = loader
    .loadAsync(`${import.meta.env.BASE_URL}models/weapons/${id}.glb`)
    .then(({ scene }) => {
      const authored = id >= MAMMOTH;
      if (authored) scene.rotation.y = -Math.PI / 2;
      const holder = new T.Group();
      holder.add(scene);
      const box = new T.Box3().setFromObject(holder, true);
      const size = box.getSize(new T.Vector3());
      const point = new T.Vector3(),
        seen = new Set<T.BufferGeometry>();
      scene.traverse((node) => {
        if (!(node instanceof T.Mesh)) return;
        if (seen.has(node.geometry)) node.geometry = node.geometry.clone();
        seen.add(node.geometry);
        const pos = node.geometry.getAttribute("position");
        const paint = new Float32Array(pos.count * 2);
        for (let n = 0; n < pos.count; n++) {
          point.fromBufferAttribute(pos, n).applyMatrix4(node.matrixWorld);
          paint[2 * n] = (point.z - box.min.z) / size.z;
          paint[2 * n + 1] = (point.y - box.min.y) / size.y;
        }
        node.geometry.setAttribute(
          "paintCoord",
          new T.BufferAttribute(paint, 2),
        );
        for (const m of Array.isArray(node.material)
          ? node.material
          : [node.material])
          enamel(m, id);
        node.userData.sharedWeaponAsset = true;
      });
      const model = WEAPONS[id].model;
      const scale =
        isGrenade(id)
          ? 0.29 / size.y
          : (id === KNIFE
              ? 0.49
              : id === MAMMOTH
                ? 0.48
                : id === SMG
                  ? 0.76
                  : [1.47, 1.45, 0.34, 1.7][model]) / size.z;
      holder.scale.setScalar(scale);
      const socket = scene.userData.muzzle as number[] | undefined;
      if (id === KNIFE) holder.position.z = -0.05;
      else if (isGrenade(id))
        holder.position.y = -box.getCenter(point).y * scale;
      else {
        holder.position.set(
          -(socket?.[0] ?? 0) * scale,
          [0.018, 0.023, 0.006, 0.015][model] - (socket?.[1] ?? 0.16) * scale,
          (id === MAMMOTH
            ? -0.4
            : id === SMG
              ? -0.5
              : [-0.918, -0.86, -0.305, -1.18][model]) -
            (socket?.[2] ?? box.min.z) * scale,
        );
      }
      return holder;
    })
    .catch((error) => {
      models.delete(id);
      throw error;
    });
  models.set(id, pending);
  return pending;
}

/** Keep the procedural mesh visible during the first fetch or if a model is unavailable. */
export function mountWeaponModel(host: T.Group, id: number, pose: "view" | "hand" | "actor" = "view") {
  if (typeof window === "undefined") return;
  host.userData.cancelWeaponLoad?.();
  const fallback = host.children.filter(
    (node) => node.name !== "muzzle" && node.name !== "shell",
  );
  let active = true;
  host.userData.cancelWeaponLoad = () => {
    active = false;
  };
  void template(id)
    .then((source) => {
      if (!active) return;
      delete host.userData.cancelWeaponLoad;
      const old = new T.Group();
      old.add(...fallback);
      disposeGroup(old);
      const instance = source.clone(true);
      const model = new T.Group();
      model.add(instance);
      if (pose === "hand") {
        model.rotation.x = Math.PI / 2;
        model.scale.setScalar(0.74);
      }
      host.add(model);
      if (pose === "actor") {
        model.rotation.y = Math.PI;
        model.scale.setScalar(0.58);
        host.userData.weaponModel = id;
        return;
      }
      const parts: T.Object3D[] = [];
      const shell = host.getObjectByName("shell");
      if (shell) parts.push(shell);
      for (const [name, role] of [
        ["Magazine", "magazine"],
        ["ChargingHandle", "action"],
        ["Pump", "action"],
      ]) {
        const part = instance.getObjectByName(name);
        if (!part) continue;
        // Animate in the same units and axes as the original viewmodel.
        const pivot = new T.Group();
        model.add(pivot);
        model.updateWorldMatrix(true, true);
        pivot.position.copy(
          model.worldToLocal(part.getWorldPosition(new T.Vector3())),
        );
        pivot.attach(part);
        pivot.name = role;
        parts.push(pivot);
      }
      for (const part of parts) {
        part.userData.restPosition = part.position.clone();
        part.userData.restRotation = part.rotation.clone();
      }
      host.userData.animatedParts = parts;
      host.userData.weaponModel = id;
      const muzzle = host.getObjectByName("muzzle");
      if (muzzle && (id === MAMMOTH || id === SMG))
        muzzle.position.z = id === SMG ? -0.5 : -0.4;
    })
    .catch((error) => console.warn("Weapon model unavailable", id, error));
}
