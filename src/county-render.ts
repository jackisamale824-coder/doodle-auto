import { loadCoupe } from "./county-car.ts";
import { isCityMass } from "./county-architecture.ts";
import { countyBuildings } from "./county-buildings.ts";
import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
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
  const roofs: T.BufferGeometry[][] = [[], []];
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
    if (box.kind === "county-roof") roofs[Number(box.p[0] > 0)].push(geo);
    else group.add(new T.Mesh(geo, terrainTint));
  }
  for (const district of roofs) {
    if (!district.length) continue;
    group.add(new T.Mesh(mergeGeometries(district), terrainTint));
    district.forEach((g) => g.dispose());
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
  for (const town of TOWNS)
    for (const dx of [-88, -44, 0, 44, 88]) {
      const x = town + dx;
      for (const offset of [-10, 10])
        for (let i = -4; i <= 4; i++) {
          rect(markings, x + offset, i * 1.15, 2.3, 0.48, 0.054);
          rect(markings, x + i * 1.15, offset, 0.48, 2.3, 0.054);
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
  countyBuildings(group, city.boxes.filter(isCityMass));
  const rng = randomSeed("county-landscape");
  const matrix = new T.Object3D();
  for (const town of TOWNS) {
    for (const start of [-130, 2]) {
      const lamps = new T.InstancedMesh(lamp, mat, 6);
      for (let i = 0; i < 6; i++) {
        matrix.position.set(town + 6, 0, start + i * 22);
        matrix.updateMatrix();
        lamps.setMatrixAt(i, matrix.matrix);
      }
      group.add(lamps);
    }
  }
  const trunkGeo = new T.CylinderGeometry(0.14, 0.24, 3.3, 8);
  const trunkMat = new T.MeshBasicMaterial({ color: 0x7887a5 });
  const crown = new T.SphereGeometry(1, 14, 9),
    colors = [];
  const vertex = crown.getAttribute("position"),
    leaf = new T.Color();
  for (let i = 0; i < vertex.count; i++) {
    normal.fromBufferAttribute(crown.attributes.normal, i);
    const { x, y, z } = normal;
    const radius =
      1 +
      0.13 * Math.sin(5 * x + 2 * z) * Math.cos(5 * y - 3 * z) +
      0.08 * Math.sin(7 * z - 4 * y);
    vertex.setXYZ(i, x * radius, y * radius, z * radius);
    const light = normal.dot(sun) + 0.12 * Math.sin(x * 7 + y * 4);
    leaf.setHex(light > 0.55 ? 0xe3e7e1 : light > -0.12 ? 0xb9c7d4 : 0x90a2ba);
    colors.push(leaf.r, leaf.g, leaf.b);
  }
  crown.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  const leafMat = new T.MeshBasicMaterial({ vertexColors: true });
  const cells = new Map<string, typeof city.boxes>();
  for (const tree of city.boxes.filter((b) => b.kind === "county-tree")) {
    const cell = Math.floor(tree.p[0] / 96) + "," + Math.floor(tree.p[2] / 96);
    if (!cells.has(cell)) cells.set(cell, []);
    cells.get(cell)!.push(tree);
  }
  for (const trees of cells.values()) {
    const trunks = new T.InstancedMesh(trunkGeo, trunkMat, trees.length),
      leaves = new T.InstancedMesh(crown, leafMat, trees.length);
    trees.forEach(({ p }, i) => {
      matrix.position.set(p[0], 1.65, p[2]);
      matrix.scale.set(1, 1, 1);
      matrix.updateMatrix();
      trunks.setMatrixAt(i, matrix.matrix);
      const slim = rng() > 0.65;
      matrix.position.y = 4.15 + rng() * 0.75;
      matrix.scale.set(slim ? 1.4 : 2.2, slim ? 2.8 : 2.05, slim ? 1.45 : 2);
      matrix.rotation.y = rng() * 6.28;
      matrix.updateMatrix();
      leaves.setMatrixAt(i, matrix.matrix);
    });
    group.add(trunks, leaves);
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
