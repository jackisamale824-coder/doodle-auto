import * as T from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { assetUrl } from "./release-info.ts";
import { inkMaterial, INK } from "./render.ts";
import { TOWNS, elevation, parkedCars } from "./county.ts";
import { randomSeed, type City } from "./world.ts";

export async function drawCounty(city: City, group: T.Group) {
  const loader = new GLTFLoader(),
    mat = inkMaterial(INK, 0.025);
  mat.uniforms.uSurface.value = 1.7;
  async function geometry(name: string) {
    const model = await loader.loadAsync(assetUrl("models/" + name + ".glb"));
    const mesh = model.scene.getObjectByProperty("isMesh", true) as T.Mesh;
    const geo = mesh.geometry;
    geo.computeVertexNormals();
    geo.computeBoundingBox();
    return geo;
  }
  const [car, apartment, factory, lamp, rock] = await Promise.all(
    ["sports-car", "apartment", "factory", "lamp", "outcrop"].map(geometry),
  );
  const ground = city.boxes.find((b) => b.mesh)!.mesh!,
    geo = new T.BufferGeometry();
  geo.setAttribute(
    "position",
    new T.Float32BufferAttribute(ground.vertices, 3),
  );
  geo.setIndex(ground.indices);
  geo.computeVertexNormals();
  group.add(new T.Mesh(geo, mat));
  const cars = parkedCars().map((c) => {
    const m = new T.Mesh(car, mat);
    m.position.fromArray(c.p);
    group.add(m);
    return m;
  });
  const dummy = new T.Object3D(),
    rng = randomSeed("county-landscape");
  for (const b of city.boxes.filter((b) => b.kind === "building")) {
    const model = b.p[0] < 0 ? factory : apartment,
      sz = model.boundingBox!.getSize(new T.Vector3());
    const floors = Math.max(2, Math.round(b.s[1] / 3.5)),
      bays = 5;
    const facade = new T.InstancedMesh(model, mat, floors * bays * 4);
    let i = 0;
    for (let side = 0; side < 4; side++)
      for (let f = 0; f < floors; f++)
        for (let bay = 0; bay < bays; bay++) {
          const angle = (side * Math.PI) / 2,
            w = b.s[side % 2 ? 2 : 0],
            d = b.s[side % 2 ? 0 : 2],
            u = ((bay + 0.5) / bays - 0.5) * w;
          dummy.position.set(
            b.p[0] + Math.cos(angle) * u + Math.sin(angle) * (d / 2 + 0.19),
            (f * b.s[1]) / floors,
            b.p[2] - Math.sin(angle) * u + Math.cos(angle) * (d / 2 + 0.19),
          );
          dummy.rotation.y = angle + Math.PI;
          dummy.scale.set(w / bays / sz.x, b.s[1] / floors / sz.y, 1);
          dummy.updateMatrix();
          facade.setMatrixAt(i++, dummy.matrix);
        }
    facade.userData.detailRange = 68;
    facade.userData.detailCenter = [b.p[0], b.p[2]];
    group.add(facade);
  }
  for (const town of TOWNS)
    for (let z = -130; z <= 130; z += 22) {
      const mesh = new T.Mesh(lamp, mat);
      mesh.position.set(town + 6, 0, z);
      group.add(mesh);
    }
  for (let i = 0; i < 150;) {
    const x = (rng() - 0.5) * 1560,
      z = (rng() - 0.5) * 1560;
    if (Math.abs(z) < 165) continue;
    const stone = new T.Mesh(rock, mat);
    stone.position.set(x, elevation(x, z) - 0.3, z);
    stone.rotation.y = rng() * Math.PI * 2;
    stone.scale.setScalar(
      (2 + rng() * 7) / rock.boundingBox!.getSize(new T.Vector3()).length(),
    );
    group.add(stone);
    i++;
  }
  for (const point of city.beacons) {
    const token = new T.Mesh(
      new T.OctahedronGeometry(0.6),
      inkMaterial("#dfa52b", 0.55),
    );
    token.position.fromArray(point);
    token.position.y += 1.4;
    group.add(token);
    token.name = "county-mark";
  }
  return cars;
}
