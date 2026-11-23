import { loadFleet } from "./county-car.ts";
import { isCountyPiece } from "./county-architecture.ts";
import { countyBuildings } from "./county-buildings.ts";
import * as T from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { assetUrl } from "./release-info.ts";
import { inkMaterial, INK } from "./render.ts";
import { elevation, parkedCars } from "./county.ts";
import { drawCountyRoads } from "./county-roads.ts";
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
  countyBuildings(group, city.boxes.filter(isCountyPiece));
  const [vehicle, lamp, rock] = await Promise.all([
    loadFleet(),
    geometry("lamp"),
    geometry("outcrop"),
  ]);
  for (const box of city.boxes) {
    if (!box.mesh || box.piece) continue;
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
  const cars = parkedCars().map((c, i) => {
    const m = vehicle(
      c.kind,
      c.kind === "taxi" ? 1 : c.kind === "delivery" ? 3 : i,
    );
    m.rotation.y = c.yaw;
    m.position.fromArray(c.p);
    group.add(m);
    return m;
  });
  const lightPositions = drawCountyRoads(group, city.plan.streets);
  const rng = randomSeed("county-landscape");
  const matrix = new T.Object3D();
  const lamps = new T.InstancedMesh(lamp, mat, lightPositions.length);
  lightPositions.forEach((p, i) => {
    matrix.position.fromArray(p);
    matrix.updateMatrix();
    lamps.setMatrixAt(i, matrix.matrix);
  });
  group.add(lamps);
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
    if (elevation(x, z) < 1) continue;
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
