import * as T from "three";
import { coastline, crossings, islands, SEA_LEVEL } from "./islands.ts";
import { label } from "./render.ts";
import type { City } from "./world.ts";

export function drawIslands(city: City, group: T.Group) {
  const batches = [
    { positions: [] as number[], colors: [] as number[] },
    { positions: [] as number[], colors: [] as number[] },
  ];
  const tint = new T.Color();
  for (const box of city.boxes) {
    if (!box.mesh) continue;
    const batch = batches[Number(box.p[1] + box.s[1] / 2 > 0.35)];
    tint.set(box.ink!);
    const { vertices, indices } = box.mesh;
    for (const i of indices) {
      batch.positions.push(
        vertices[i * 3],
        vertices[i * 3 + 1],
        vertices[i * 3 + 2],
      );
      batch.colors.push(tint.r, tint.g, tint.b);
    }
  }
  const material = new T.MeshLambertMaterial({
    vertexColors: true,
    side: T.DoubleSide,
    shadowSide: T.BackSide,
  });
  batches.forEach(({ positions, colors }, i) => {
    const geo = new T.BufferGeometry();
    geo.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
    geo.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const land = new T.Mesh(geo, material);
    land.castShadow = i === 1;
    land.receiveShadow = true;
    group.add(land);
  });
  const sun = new T.DirectionalLight(0xffedcf, 1.95);
  sun.position.set(-48, 72, 30);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, {
    left: -76,
    right: 76,
    top: 76,
    bottom: -76,
    near: 1,
    far: 190,
  });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.00045;
  sun.shadow.normalBias = 0.055;
  group.add(sun, new T.HemisphereLight(0xd9ecff, 0xc39c80, 1.55));
  const water = new T.ShaderMaterial({
    uniforms: {
      time: { value: 0 },
      shores: {
        value: islands.map(({ x, z, radius }) => new T.Vector3(x, z, radius)),
      },
      deep: { value: new T.Color("#176e99") },
      shoal: { value: new T.Color("#38c9b8") },
      foam: { value: new T.Color("#dafff0") },
      haze: { value: new T.Color("#a6dddf") },
    },
    vertexShader: `varying vec3 world;
      void main(){vec4 p=modelMatrix*vec4(position,1.);world=p.xyz;gl_Position=projectionMatrix*viewMatrix*p;}`,
    fragmentShader: `uniform float time;uniform vec3 shores[5],deep,shoal,foam,haze;varying vec3 world;
      void main(){
        vec2 p=world.xz;float coast=1000.;
        for(int i=0;i<5;i++)coast=min(coast,length(p-shores[i].xy)-shores[i].z);
        float distanceToEye=distance(world,cameraPosition);
        float wave=sin(p.y*1.7+.7*sin(p.x*.55+time*.52)+time*.63);
        float ripple=sin(p.x*1.09+p.y*.51)+.65*sin(p.x*.43-p.y*.65);
        float crest=smoothstep(.91,.995,wave)*smoothstep(.7,1.12,ripple)*(1.-smoothstep(28.,100.,distanceToEye));
        vec3 color=mix(deep,shoal,1.-smoothstep(2.,15.,coast+.7*sin(p.x*.4+p.y*.2)));
        color*=.96+.04*sin(p.y*.33+p.x*.18+time*.32);
        gl_FragColor=vec4(mix(mix(color,foam,crest*.63),haze,smoothstep(85.,220.,distanceToEye)),1.);
        #include <colorspace_fragment>
      }`,
  });
  const ocean = new T.Mesh(new T.PlaneGeometry(820, 820), water);
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.y = SEA_LEVEL;
  group.add(ocean);
  const puff = new T.IcosahedronGeometry(1, 1);
  const smoke = Array.from({ length: 6 }, (_, i) => {
    const cloud = new T.Mesh(
      puff,
      new T.MeshBasicMaterial({
        color: i % 2 ? "#adb0b2" : "#b6b3b5",
        transparent: true,
        depthWrite: false,
      }),
    );
    group.add(cloud);
    return cloud;
  });
  for (const island of islands.slice(1)) {
    const dx = island.x / 48,
      dz = island.z / 48,
      x = dx * 11.3 + dz * 3.2,
      z = dz * 11.3 - dx * 3.2;
    const post = new T.Mesh(
      new T.BoxGeometry(0.15, 1.62, 0.15),
      new T.MeshBasicMaterial({ color: "#7a624f" }),
    );
    post.position.set(x, 0.81, z);
    const sign = label(island.name, 512, "#263f49", "#f1dfaf");
    sign.scale.set(0.64, 0.62, 1);
    sign.position.set(x - dx * 0.1, 1.56, z - dz * 0.1);
    sign.rotation.y = Math.atan2(-dx, -dz);
    group.add(post, sign);
  }
  return (time: number) => {
    water.uniforms.time.value = time;
    smoke.forEach((cloud, i) => {
      const age = (time * 0.12 + i / smoke.length) % 1;
      cloud.position.set(
        1 + 5 * age * age,
        9.5 + age * 8,
        58 + 0.6 * Math.sin(age * 5),
      );
      cloud.scale.setScalar(0.55 + age * 1.8);
      cloud.material.opacity = 0.48 * Math.sin(Math.PI * age);
    });
  };
}

export const islandMapScale = 1.29;
export function drawIslandMap(
  ctx: CanvasRenderingContext2D,
  x: number,
  z: number,
) {
  ctx.save();
  ctx.fillStyle = "#b3d6d5";
  ctx.fillRect(0, 0, 190, 190);
  ctx.translate(95, 95);
  ctx.scale(islandMapScale, islandMapScale);
  ctx.lineCap = "round";
  for (const [a, b] of crossings) {
    ctx.beginPath();
    ctx.moveTo(islands[a].x, islands[a].z);
    ctx.lineTo(islands[b].x, islands[b].z);
    ctx.lineWidth = 3.4;
    ctx.strokeStyle = "#796e62";
    ctx.stroke();
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = "#f4d99d";
    ctx.stroke();
  }
  let closest = islands[0],
    distance = Infinity;
  islands.forEach((island, i) => {
    ctx.beginPath();
    coastline(i).forEach(([px, pz], j) =>
      j ? ctx.lineTo(px, pz) : ctx.moveTo(px, pz),
    );
    ctx.closePath();
    ctx.fillStyle = island.land;
    ctx.fill();
    ctx.strokeStyle = island.cliff;
    ctx.lineWidth = 0.85;
    ctx.stroke();
    const d = Math.hypot(x - island.x, z - island.z);
    if (d < distance) {
      closest = island;
      distance = d;
    }
  });
  ctx.restore();
  return distance > closest.radius + 1 ? "Bridge crossing" : closest.name;
}
