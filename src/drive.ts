import * as T from "three";
import { COUNTY, LIMIT, TOWNS, countyBlocks, elevation } from "./county.ts";
import { Network } from "./network.ts";
import { randomSeed } from "./world.ts";

export async function startDrive() {
  document.title = "Switchback County · doodlesCreed";
  document.body.innerHTML =
    '<canvas id="road-view" aria-label="Switchback County driving world"></canvas><aside id="drive-panel"><b>SWITCHBACK COUNTY</b><strong id="drive-readout">Connecting…</strong><span>W/S accelerate &amp; reverse · A/D steer · Space brake</span><a href="./">Return to Rust</a></aside>';
  const style = document.createElement("style");
  style.textContent =
    "#road-view{position:fixed;inset:0;width:100%;height:100%;display:block}#drive-panel{position:fixed;bottom:24px;left:24px;background:#182d33ed;color:#fff9e6;padding:16px 22px;border-left:5px solid #ffbc55;display:grid;gap:5px;font:14px system-ui}#drive-panel b{letter-spacing:.13em;color:#ffd28c}#drive-panel strong{font-size:18px}#drive-panel a{color:#d3f0e6}";
  document.head.append(style);
  const hud = document.querySelector<HTMLElement>("#drive-readout")!;
  try {
    const renderer = new T.WebGLRenderer({
      canvas: document.querySelector("canvas")!,
      antialias: true,
    });
    const scene = new T.Scene(),
      camera = new T.PerspectiveCamera(65, 1, 0.15, 1500);
    scene.background = new T.Color(0xf2d5b4);
    scene.fog = new T.FogExp2(0xf2d5b4, 0.0015);
    scene.add(new T.HemisphereLight(0xfff4df, 0xb1aa8c, 1.9));
    const sun = new T.DirectionalLight(0xffe1ae, 2);
    sun.position.set(-80, 130, 50);
    scene.add(sun);
    const cube = new T.BoxGeometry(),
      blocks = countyBlocks();
    function box(
      parent: T.Object3D,
      x: number,
      y: number,
      z: number,
      w: number,
      h: number,
      d: number,
      color: number,
    ) {
      const m = new T.Mesh(cube, new T.MeshStandardMaterial({ color }));
      m.scale.set(w, h, d);
      m.position.set(x, y, z);
      parent.add(m);
      return m;
    }
    const terrain = new T.PlaneGeometry(1900, 1900, 190, 190);
    terrain.rotateX(-Math.PI / 2);
    const verts = terrain.attributes.position,
      colors = [],
      color = new T.Color();
    for (let i = 0; i < verts.count; i++) {
      const x = verts.getX(i),
        z = verts.getZ(i),
        h = elevation(x, z);
      verts.setY(i, h - 0.06);
      color.setHSL(
        0.22 + 0.025 * Math.sin(z / 80),
        0.31,
        0.39 + 0.09 * Math.sin(x / 59) * Math.cos(z / 51) + h * 0.001,
      );
      colors.push(color.r, color.g, color.b);
    }
    terrain.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
    terrain.computeVertexNormals();
    scene.add(
      new T.Mesh(terrain, new T.MeshStandardMaterial({ vertexColors: true })),
    );
    box(scene, 0, 0.02, 0, 1560, 0.04, 14, 0x495254);
    for (const t of TOWNS)
      for (let i = -3; i <= 3; i++) {
        box(scene, t + i * 44, 0.05, 0, 11, 0.07, 278, 0x50585b);
        box(scene, t, 0.06, i * 44, 278, 0.07, 11, 0x50585b);
      }
    for (let x = -770; x < 770; x += 18)
      box(scene, x, 0.13, 0, 7, 0.04, 0.22, 0xffde88);
    const palette = [0xc08369, 0xe2be91, 0x80999b, 0xa8ada1, 0xda9773];
    blocks.forEach((b, i) => {
      box(scene, ...b.p, ...b.s, palette[i % 5]);
      box(
        scene,
        b.p[0],
        b.s[1] + 0.4,
        b.p[2],
        b.s[0] + 1,
        0.8,
        b.s[2] + 1,
        0x505b60,
      );
      for (let y = 4; y < b.s[1] - 1; y += 6)
        box(
          scene,
          b.p[0],
          y,
          b.p[2],
          b.s[0] + 0.12,
          1.2,
          b.s[2] + 0.12,
          0x586e76,
        );
    });
    // All county architecture is stationary and shares one box geometry.
    const architecture = scene.children.filter(
      (o): o is T.Mesh<T.BoxGeometry, T.MeshStandardMaterial> =>
        o instanceof T.Mesh && o.geometry === cube,
    );
    const districtMesh = new T.InstancedMesh(
      cube,
      new T.MeshStandardMaterial(),
      architecture.length,
    );
    architecture.forEach((mesh, i) => {
      mesh.updateMatrix();
      districtMesh.setMatrixAt(i, mesh.matrix);
      districtMesh.setColorAt(i, mesh.material.color);
      scene.remove(mesh);
      mesh.material.dispose();
    });
    scene.add(districtMesh);
    const forest = new T.InstancedMesh(
        new T.ConeGeometry(3, 12, 6),
        new T.MeshStandardMaterial({ color: 0x3c6956 }),
        650,
      ),
      rand = randomSeed("county-pines");
    for (let i = 0; i < forest.count;) {
      const x = (rand() - 0.5) * 1600,
        z = (rand() - 0.5) * 1600;
      if (
        Math.abs(z) < 15 ||
        TOWNS.some((t) => Math.max(Math.abs(x - t), Math.abs(z)) < 152)
      )
        continue;
      forest.setMatrixAt(
        i++,
        new T.Matrix4().makeTranslation(x, elevation(x, z) + 5.9, z),
      );
    }
    scene.add(forest);
    function car(tint: number) {
      const g = new T.Group();
      box(g, 0, 0.78, 0, 1.95, 0.72, 4.25, tint);
      box(g, 0, 1.37, 0.18, 1.58, 0.64, 2.06, 0x324858);
      box(g, 0, 1.72, 0.18, 1.62, 0.15, 1.62, tint);
      for (const x of [-0.98, 0.98])
        for (const z of [-1.3, 1.3])
          box(g, x, 0.41, z, 0.32, 0.78, 0.82, 0x263036);
      for (const x of [-0.65, 0.65]) {
        box(g, x, 0.84, -2.14, 0.42, 0.2, 0.08, 0xffedac);
        box(g, x, 0.84, 2.14, 0.42, 0.18, 0.08, 0xf36650);
      }
      scene.add(g);
      return g;
    }
    const local = car(0xf69a36),
      others = new Map<string, T.Group>(),
      net = new Network("county"),
      keys = new Set<string>();
    let speed = 0,
      yaw = 0,
      x = 0,
      z = 0,
      sendTime = 0,
      last = performance.now();
    net.onMessage = (m) => {
      if (m.type === "correction" || m.type === "resumed") {
        const p = m.p ?? m.spawn;
        if (p) {
          [x, , z] = p;
          speed = 0;
        }
      }
    };
    const welcome =
      (await net.bootstrap()) ??
      (await net.connect("public", "Driver", COUNTY, ""));
    [x, , z] = welcome.spawn ?? welcome.p;
    window.addEventListener("keydown", (e) => {
      keys.add(e.code);
      if (
        ["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
          e.code,
        )
      )
        e.preventDefault();
    });
    window.addEventListener("keyup", (e) => keys.delete(e.code));
    window.addEventListener("blur", () => keys.clear());
    document
      .querySelector("aside a")!
      .addEventListener("click", () => net.disconnect());
    function resize() {
      renderer.setPixelRatio(Math.min(1.6, devicePixelRatio));
      renderer.setSize(innerWidth, innerHeight, false);
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
    }
    resize();
    window.addEventListener("resize", resize);
    const held = (a: string, b: string) => Number(keys.has(a) || keys.has(b));
    camera.position.set(x, elevation(x, z) + 6, z + 12);
    function frame(now: number) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const throttle = held("KeyW", "ArrowUp") - held("KeyS", "ArrowDown");
      if (net.active) {
        speed = T.MathUtils.clamp(speed + throttle * 17 * dt, -12, 42);
        speed = T.MathUtils.damp(
          speed,
          0,
          keys.has("Space") ? 4 : throttle ? 0.12 : 0.65,
          dt,
        );
        yaw +=
          (held("KeyA", "ArrowLeft") - held("KeyD", "ArrowRight")) *
          Math.min(1, Math.abs(speed) / 7) *
          Math.sign(speed) *
          1.55 *
          dt;
        const nx = x - Math.sin(yaw) * speed * dt,
          nz = z - Math.cos(yaw) * speed * dt;
        if (
          Math.max(Math.abs(nx), Math.abs(nz)) < LIMIT - 2 &&
          !blocks.some(
            (b) =>
              Math.abs(nx - b.p[0]) < b.s[0] / 2 + 1.9 &&
              Math.abs(nz - b.p[2]) < b.s[2] / 2 + 1.9,
          )
        ) {
          x = nx;
          z = nz;
        } else speed = 0;
      }
      local.position.set(x, elevation(x, z), z);
      local.rotation.y = yaw;
      if (now - sendTime >= 50) {
        net.send({
          type: "state",
          p: local.position.toArray(),
          yaw,
          pitch: 0,
          weapon: 0,
          height: 1.5,
        });
        sendTime = now;
      }
      const seen = new Set<string>();
      for (const p of net.players) {
        if (p.id === net.id) continue;
        seen.add(p.id);
        let g = others.get(p.id);
        if (!g) {
          g = car(palette[parseInt(p.id[0], 16) % 5]);
          others.set(p.id, g);
        }
        g.position.fromArray(net.position(p));
        g.rotation.y = p.yaw;
      }
      for (const [id, g] of others)
        if (!seen.has(id)) {
          scene.remove(g);
          g.traverse((o) => {
            if (o instanceof T.Mesh) o.material.dispose();
          });
          others.delete(id);
        }
      camera.position.lerp(
        new T.Vector3(
          x + Math.sin(yaw) * 11,
          local.position.y + 5.6,
          z + Math.cos(yaw) * 11,
        ),
        1 - Math.exp(-7 * dt),
      );
      camera.lookAt(
        x - Math.sin(yaw) * 4,
        local.position.y + 1.4,
        z - Math.cos(yaw) * 4,
      );
      const district =
        Math.abs(z) < 145 && Math.abs(x + 320) < 145
          ? "Westhaven"
          : Math.abs(z) < 145 && Math.abs(x - 320) < 145
            ? "Eastbank"
            : "Highlands";
      hud.textContent = net.active
        ? district +
          " · " +
          Math.round(Math.abs(speed) * 3.6) +
          " km/h · " +
          Math.max(1, net.players.length) +
          "/30 drivers"
        : net.reconnecting
          ? "Reconnecting…"
          : "Disconnected · refresh to rejoin";
      renderer.render(scene, camera);
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  } catch (e) {
    hud.textContent =
      e instanceof Error ? e.message : "Unable to enter the county.";
  }
}
