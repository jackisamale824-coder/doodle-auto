import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { VEHICLES, type CountyCar } from "../src/county.ts";

// Decode one shared collision model per vehicle kind. Ray tests are synchronous,
// so each query can pose the template without allocating a model per parked car.
export async function loadCountyFleet(assetRoot: string) {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const fleet = new Map(
    await Promise.all(
      VEHICLES.map(async (kind) => {
        const bytes = await readFile(
          join(assetRoot, "models", "fleet", kind + ".glb"),
        );
        const { scene } = await loader.parseAsync(
          Uint8Array.from(bytes).buffer,
          "",
        );
        return [kind, scene.getObjectByName("near")!] as const;
      }),
    ),
  );
  return (car: CountyCar) => {
    const near = fleet.get(car.kind)!;
    near.position.fromArray(car.p);
    near.rotation.y = car.yaw;
    return near;
  };
}
