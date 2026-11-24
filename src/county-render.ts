import { loadFleet } from "./county-car.ts";
import { isCountyPiece } from "./county-architecture.ts";
import { countyBuildings } from "./county-buildings.ts";
import * as T from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { assetUrl } from "./release-info.ts";
import { inkMaterial } from "./render.ts";
import { elevation, countyCars, type CountyCar } from "./county.ts";
import { drawCountyRoads } from "./county-roads.ts";
import { randomSeed, type City, type V3 } from "./world.ts";

// Keep each instance batch small enough for Three.js to cull streets outside the view.
function countyCells<T>(items: T[], position: (item: T) => V3) {
  const cells = new Map<string, T[]>();
  for (const item of items) {
    const [x, , z] = position(item);
    const key = Math.floor(x / 96) + "," + Math.floor(z / 96);
    const cell = cells.get(key);
    if (cell) cell.push(item);
    else cells.set(key, [item]);
  }
  return cells.values();
}

export async function drawCounty(city: City, group: T.Group) {
  const loader = new GLTFLoader(),
    mat = inkMaterial("#294856", 0.16);
  mat.uniforms.uPaper.value.set("#557981");
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
  const grass = new T.Color(0x80aa62),
    dryGrass = new T.Color(0xa5ba68),
    ridge = new T.Color(0x9e8c74),
    color = new T.Color();
  countyBuildings(group, city.boxes.filter(isCountyPiece));
  const [vehicle, lamp, rock] = await Promise.all([
    loadFleet(),
    geometry("lamp"),
    geometry("outcrop"),
  ]);
  for (const box of city.boxes) {
    if (box.kind !== "ground" || box.piece) continue;
    const geo = box.mesh
      ? new T.BufferGeometry()
      : new T.PlaneGeometry(box.s[0], box.s[2], 8, 8)
          .rotateX(-Math.PI / 2)
          .translate(box.p[0], box.p[1] + box.s[1] / 2, box.p[2]);
    if (box.mesh) {
      geo.setAttribute(
        "position",
        new T.Float32BufferAttribute(box.mesh.vertices, 3),
      );
      geo.setIndex(box.mesh.indices);
    }
    geo.computeVertexNormals();
    const normals = geo.getAttribute("normal"),
      colors = [];
    for (let i = 0; i < normals.count; i++) {
      normal.fromBufferAttribute(normals, i);
      const light = normal.dot(sun);
      const pos = geo.getAttribute("position");
      color
        .copy(grass)
        .lerp(
          dryGrass,
          0.4 +
            0.22 * Math.sin(pos.getX(i) * 0.038) +
            0.17 * Math.cos(pos.getZ(i) * 0.053),
        )
        .lerp(ridge, T.MathUtils.smoothstep(pos.getY(i), 12, 48))
        .multiplyScalar(0.66 + 0.34 * Math.max(0, light));
      colors.push(color.r, color.g, color.b);
    }
    geo.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
    group.add(new T.Mesh(geo, terrainTint));
  }
  const addCar = (c: CountyCar, i: number) => {
    const m = vehicle(
      c.kind,
      c.kind === "taxi" ? 1 : c.kind === "delivery" ? 3 : i,
      c.cruiser,
    );
    m.rotation.y = c.yaw;
    m.position.fromArray(c.p);
    group.add(m);
    return m;
  };
  const cars = countyCars().map(addCar);
  const lightPositions = drawCountyRoads(group, city.plan.streets);
  const rng = randomSeed("county-landscape");
  const matrix = new T.Object3D();
  for (const positions of countyCells(lightPositions, (p) => p)) {
    const lamps = new T.InstancedMesh(lamp, mat, positions.length);
    positions.forEach((p, i) => {
      matrix.position.fromArray(p);
      matrix.updateMatrix();
      lamps.setMatrixAt(i, matrix.matrix);
    });
    lamps.computeBoundingSphere();
    group.add(lamps);
  }
  const trunkGeo = new T.CylinderGeometry(0.14, 0.24, 4.2, 8);
  const trunkMat = new T.MeshBasicMaterial({ color: 0x8b6749 });
  const frond = new T.BufferGeometry(),
    frondPositions: number[] = [],
    frondIndices: number[] = [];
  const segments = 12;
  for (let i = 0; i <= segments; i++) {
    const t = i / segments,
      x = 2.8 * t,
      y = -1.75 * t * t,
      width = 0.04 + 0.34 * Math.sin(Math.PI * t);
    frondPositions.push(x, y - width, 0, x, y + width, 0);
    if (i < segments) {
      const a = i * 2;
      frondIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  frond.setAttribute(
    "position",
    new T.Float32BufferAttribute(frondPositions, 3),
  );
  frond.setIndex(frondIndices);
  frond.computeVertexNormals();
  const leafMat = new T.MeshBasicMaterial({
    color: 0xffffff,
    side: T.DoubleSide,
  });
  const palms = city.boxes.filter((b) => b.kind === "county-tree");
  for (const trees of countyCells(palms, (tree) => tree.p)) {
    const trunks = new T.InstancedMesh(trunkGeo, trunkMat, trees.length),
      leaves = new T.InstancedMesh(frond, leafMat, trees.length * 8);
    trees.forEach(({ p }, i) => {
      matrix.position.set(p[0], 2.1, p[2]);
      matrix.scale.set(1, 1, 1);
      matrix.updateMatrix();
      trunks.setMatrixAt(i, matrix.matrix);
      for (let j = 0; j < 8; j++) {
        matrix.position.set(p[0], 4.1 + rng() * 0.25, p[2]);
        matrix.scale.setScalar(0.82 + rng() * 0.28);
        matrix.rotation.set(0, (j / 8) * Math.PI * 2, 0);
        matrix.updateMatrix();
        leaves.setMatrixAt(i * 8 + j, matrix.matrix);
        leaves.setColorAt(
          i * 8 + j,
          color.setHex([0x347850, 0x4a9060, 0x63a157, 0x448557][(i + j) % 4]),
        );
      }
    });
    group.add(trunks, leaves);
  }
  const stoneMaterial = inkMaterial("#635f5c", 0.09);
  stoneMaterial.uniforms.uPaper.value.set("#b89b7b");
  for (let i = 0; i < 150;) {
    const x = (rng() - 0.5) * 1560,
      z = (rng() - 0.5) * 1560;
    if (elevation(x, z) < 1) continue;
    const stone = new T.Mesh(rock, stoneMaterial);
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
  return { cars, addCar };
}
