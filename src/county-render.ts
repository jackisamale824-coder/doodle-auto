import { loadFleet } from "./county-car.ts";
import { isCountyPiece } from "./county-architecture.ts";
import { countyBuildings } from "./county-buildings.ts";
import * as T from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { assetUrl } from "./release-info.ts";
import { inkMaterial } from "./render.ts";
import { elevation, countyCars } from "./county.ts";
import { drawCountyRoads } from "./county-roads.ts";
import { randomSeed, type City } from "./world.ts";

export async function drawCounty(city: City, group: T.Group) {
  const loader = new GLTFLoader(),
    mat = inkMaterial("#294856", 0.16);
  mat.uniforms.uPaper.value.set("#557981");
  group.add(countySky());
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
  const cars = countyCars().map((c, i) => {
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
  const cells = new Map<string, typeof city.boxes>();
  for (const tree of city.boxes.filter((b) => b.kind === "county-tree")) {
    const cell = Math.floor(tree.p[0] / 96) + "," + Math.floor(tree.p[2] / 96);
    if (!cells.has(cell)) cells.set(cell, []);
    cells.get(cell)!.push(tree);
  }
  for (const trees of cells.values()) {
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
  return cars;
}

function countySky() {
  const material = new T.ShaderMaterial({
    side: T.BackSide,
    depthWrite: false,
    uniforms: {
      zenith: { value: new T.Color("#408dcc") },
      horizon: { value: new T.Color("#b4dce7") },
    },
    vertexShader: `varying vec3 skyDirection;
    void main(){skyDirection=position;vec4 clip=projectionMatrix*vec4(mat3(viewMatrix)*position,1.);gl_Position=clip.xyww;}`,
    fragmentShader: `uniform vec3 zenith,horizon;varying vec3 skyDirection;
    float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
    float noise(vec2 p){vec2 i=floor(p),t=fract(p);t=t*t*(3.-2.*t);
      return mix(mix(hash(i),hash(i+vec2(1,0)),t.x),mix(hash(i+vec2(0,1)),hash(i+1.),t.x),t.y);}
    void main(){vec3 d=normalize(skyDirection);float h=max(0.,d.y);
      vec3 sky=mix(horizon,zenith,1.-exp(-3.4*h));vec2 p=d.xz/(.16+h)*2.8;
      float clouds=noise(p)*.52+noise(p*2.1)*.29+noise(p*4.3)*.14+noise(p*8.5)*.05;
      sky=mix(sky,vec3(.95,.93,.87),smoothstep(.49,.75,clouds)*smoothstep(.02,.25,h)*.76);
      float sun=max(0.,dot(d,normalize(vec3(-.55,.82,.35))));
      gl_FragColor=vec4(mix(sky+vec3(.35,.22,.09)*pow(sun,32.),vec3(1.,.95,.78),smoothstep(.9992,.99965,sun)),1.);
      #include <colorspace_fragment>
    }`,
  });
  const sky = new T.Mesh(new T.SphereGeometry(1, 24, 12), material);
  sky.name = "county-daylight";
  sky.frustumCulled = false;
  sky.renderOrder = 1000;
  return sky;
}
