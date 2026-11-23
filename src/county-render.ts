import { loadCoupe } from "./county-car.ts";
import { countyBuildings } from "./county-buildings.ts";
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
  // Terrain lighting is static, so bake its cel shading into vertex colors.
  const terrainTint = new T.MeshBasicMaterial({ vertexColors: true });
  const normal = new T.Vector3(),
    sun = new T.Vector3(-0.55, 1, 0.35).normalize();
  const paper = new T.Color(0xf4f2e8),
    blue = new T.Color(0x9daac7),
    color = new T.Color();
  const [coupe, lamp, rock] = await Promise.all([
    loadCoupe(),
    geometry("lamp"),
    geometry("outcrop"),
  ]);
  for (const box of city.boxes) {
    if (!box.mesh) continue;
    const geo = new T.BufferGeometry();
    geo.setAttribute(
      "position",
      new T.Float32BufferAttribute(box.mesh.vertices, 3),
    );
    geo.setIndex(box.mesh.indices);
    geo.computeVertexNormals();
    const normals = geo.getAttribute("normal"),
      colors = [];
    for (let i = 0; i < normals.count; i++) {
      normal.fromBufferAttribute(normals, i);
      const light = normal.dot(sun);
      color
        .copy(paper)
        .lerp(blue, light > 0.8 ? 0.05 : light > 0.56 ? 0.22 : 0.45);
      colors.push(color.r, color.g, color.b);
    }
    geo.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
    group.add(new T.Mesh(geo, terrainTint));
  }
  const cars = parkedCars().map((c) => {
    const m = coupe();
    m.position.fromArray(c.p);
    group.add(m);
    return m;
  });
  // One opaque road surface and one marking batch. Leave junctions clear.
  const asphalt: number[] = [],
    markings: number[] = [];
  function rect(
    out: number[],
    x: number,
    z: number,
    w: number,
    d: number,
    y: number,
  ) {
    const l = x - w / 2,
      r = x + w / 2,
      t = z - d / 2,
      b = z + d / 2;
    out.push(l, y, b, r, y, b, r, y, t, l, y, b, r, y, t, l, y, t);
  }
  for (const { a, b, width } of city.plan!.streets) {
    const alongX = a[2] === b[2],
      cx = (a[0] + b[0]) / 2,
      cz = (a[2] + b[2]) / 2;
    const length = Math.abs(alongX ? b[0] - a[0] : b[2] - a[2]);
    rect(
      asphalt,
      cx,
      cz,
      alongX ? length : width,
      alongX ? width : length,
      0.042,
    );
    if (alongX && cz === 0 && length < 1000) continue;
    for (let offset = 5; offset < length - 2; offset += 10) {
      const x = alongX ? a[0] + offset : cx,
        z = alongX ? cz : a[2] + offset;
      if (
        TOWNS.some(
          (t) =>
            Math.abs(x - t) < 140 &&
            Math.abs(z) < 140 &&
            Math.abs(
              (alongX ? x - t : z) - 44 * Math.round((alongX ? x - t : z) / 44),
            ) < 8,
        )
      )
        continue;
      rect(markings, x, z, alongX ? 3 : 0.14, alongX ? 0.14 : 3, 0.05);
    }
  }
  for (const [vertices, tint] of [
    [asphalt, 0xcdd3dd],
    [markings, 0xfbf9f1],
  ] as const) {
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.Float32BufferAttribute(vertices, 3));
    group.add(new T.Mesh(geo, new T.MeshBasicMaterial({ color: tint })));
  }
  countyBuildings(
    group,
    city.boxes.filter((b) => b.kind === "building"),
  );
  const rng = randomSeed("county-landscape");
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
