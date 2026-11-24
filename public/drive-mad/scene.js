import { clamp, point, wheels, radius } from "./physics.js";

const palettes = {
  pine: {
    sky: "#a9d8df",
    haze: "#f8dfae",
    sun: "#fff3bc",
    far: "#97b7b1",
    ridge: "#79a6a2",
    shadow: "#608f90",
    forest: "#568783",
    water: "#66adad",
    grass: "#a5bc69",
    edge: "#6d854e",
    stone: "#a47757",
    rock: "#735341",
    bark: "#654734",
    pine: "#376e58",
    light: "#74964e",
  },
  clay: {
    sky: "#b7cdd6",
    haze: "#ffd6a7",
    sun: "#fff0b9",
    far: "#c7afa1",
    ridge: "#c08d78",
    shadow: "#9e746a",
    forest: "#987c70",
    water: "#84aaa0",
    grass: "#d5aa64",
    edge: "#a07d4f",
    stone: "#aa684b",
    rock: "#764d40",
    bark: "#674b42",
    pine: "#687c53",
    light: "#97a061",
  },
  ice: {
    sky: "#accee3",
    haze: "#f4ece1",
    sun: "#fff5d8",
    far: "#a9baca",
    ridge: "#8eabbb",
    shadow: "#7695a9",
    forest: "#688894",
    water: "#7db7c6",
    grass: "#e7f2e8",
    edge: "#a8c8c5",
    stone: "#8099a2",
    rock: "#566c7b",
    bark: "#697471",
    pine: "#588181",
    light: "#97b6a8",
  },
};
const noise = (n) => {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};
export function makeScene(canvas) {
  const c = canvas.getContext("2d", { alpha: false });
  let W,
    H,
    S,
    cam = 0,
    cy = 0,
    p,
    prev;
  function resize() {
    const rect = canvas.getBoundingClientRect(),
      ratio = Math.min(devicePixelRatio || 1, 2);
    W = rect.width;
    H = rect.height;
    S = Math.min(H * 0.099, W * 0.054);
    canvas.width = Math.round(W * ratio);
    canvas.height = Math.round(H * ratio);
    c.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  new ResizeObserver(resize).observe(canvas);
  resize();
  function poly(color, pts) {
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(...pts[0]);
    for (let i = 1; i < pts.length; i++) c.lineTo(...pts[i]);
    c.closePath();
    c.fill();
  }
  function line(color, width, a, b) {
    c.strokeStyle = color;
    c.lineWidth = width;
    c.beginPath();
    c.moveTo(...a);
    c.lineTo(...b);
    c.stroke();
  }
  const proj = (x, y, z = 0) => [
    (x - cam + z * 0.53) * S + W * 0.3,
    H * 0.619 - (y - cy + z * 0.31) * S,
  ];
  const face = (color, pts) =>
    poly(
      color,
      pts.map((a) => proj(...a)),
    );
  function box(x, y, z, w, h, d, colors) {
    const [side, top, end] = colors;
    face(end, [
      [x + w, y, z],
      [x + w, y + h, z],
      [x + w, y + h, z + d],
      [x + w, y, z + d],
    ]);
    face(side, [
      [x, y, z],
      [x + w, y, z],
      [x + w, y + h, z],
      [x, y + h, z],
    ]);
    face(top, [
      [x, y + h, z],
      [x + w, y + h, z],
      [x + w, y + h, z + d],
      [x, y + h, z + d],
    ]);
  }
  function mountain(seed, base, height, spacing, color, shade, offset, snow) {
    const unit = Math.max(W * 0.13, H * 0.2) * spacing,
      drift = cam * S * offset;
    for (
      let i = Math.floor(drift / unit) - 2;
      i < (W + drift) / unit + 2;
      i++
    ) {
      const x = i * unit - drift,
        peak = x + unit * (0.3 + 0.38 * noise(i + seed));
      const y = H * (base - height * (0.5 + 0.56 * noise(i + seed + 17)));
      const bottom = H * base;
      poly(color, [
        [x - unit * 0.65, bottom],
        [peak, y],
        [x + unit * 1.6, bottom],
      ]);
      poly(shade, [
        [peak, y],
        [peak + unit * 0.18, y + (bottom - y) * 0.54],
        [x + unit * 0.9, bottom],
        [x + unit * 1.6, bottom],
      ]);
      if (snow) {
        const dy = (bottom - y) * 0.22,
          dl = (peak - x + unit * 0.65) * 0.22,
          dr = (x + unit * 1.6 - peak) * 0.22;
        poly("#edf0dc", [
          [peak, y],
          [peak + dr, y + dy],
          [peak + dr * 0.42, y + dy * 0.68],
          [peak + dl * 0.05, y + dy * 1.16],
          [peak - dl * 0.37, y + dy * 0.72],
          [peak - dl, y + dy],
        ]);
      }
    }
  }
  function background() {
    const grad = c.createLinearGradient(0, 0, 0, H * 0.73);
    grad.addColorStop(0, p.sky);
    grad.addColorStop(0.8, p.haze);
    grad.addColorStop(1, p.water);
    c.fillStyle = grad;
    c.fillRect(0, 0, W, H);
    const sunX = W * 0.74 - cam * S * 0.018,
      sunY = H * 0.239,
      sunR = Math.min(H * 0.09, W * 0.085);
    for (const [r, color] of [
      [1.58, "#fff0ba28"],
      [1.26, "#fff0ba48"],
      [1, p.sun],
    ]) {
      c.fillStyle = color;
      c.beginPath();
      c.arc(sunX, sunY, sunR * r, 0, Math.PI * 2);
      c.fill();
    }
    for (let i = 0; i < 5; i++) {
      const x =
          (((i * 0.234 + 0.09) * W - cam * S * 0.055 + W * 2) % (W * 1.15)) -
          W * 0.05,
        y = H * (0.13 + 0.13 * noise(i + 8)),
        u = H * 0.015;
      poly("#fff4dca6", [
        [x, y],
        [x + u, y],
        [x + 2 * u, y - u],
        [x + 4 * u, y - u],
        [x + 4.6 * u, y - 1.6 * u],
        [x + 6 * u, y - 1.6 * u],
        [x + 7.6 * u, y - 0.3 * u],
        [x + 9 * u, y - 0.3 * u],
        [x + 10 * u, y + 0.3 * u],
        [x, y + 0.3 * u],
      ]);
    }
    mountain(28, 0.552, 0.32, 1.35, p.far, p.ridge, 0.1, true);
    mountain(6, 0.59, 0.19, 1, p.ridge, p.shadow, 0.18, false);
    const horizon = H * 0.567;
    const water = c.createLinearGradient(0, horizon, 0, H);
    water.addColorStop(0, p.water);
    water.addColorStop(1, "#3e777c");
    c.fillStyle = water;
    c.fillRect(0, horizon, W, H - horizon);
    for (let i = -4; i < W / 16 + 6; i++) {
      const unit = Math.max(16, H * 0.041),
        x = i * unit - ((cam * S * 0.22) % unit),
        h =
          H * (0.017 + 0.048 * noise(i + Math.floor((cam * S * 0.22) / unit)));
      poly(p.forest, [
        [x - unit * 0.6, horizon],
        [x, horizon - h],
        [x + unit * 0.9, horizon],
      ]);
    }
    for (let i = 0; i < 65; i++) {
      const y = horizon + (H - horizon) * noise(i + 91),
        x = (noise(i + 34) * W * 2 - cam * S * 0.31) % (W + 80);
      c.fillStyle = i % 4 ? "#d3dec43a" : "#e6e6bd81";
      c.fillRect(x, y, 6 + noise(i) * W * 0.07, Math.max(1, H * 0.002));
    }
  }
  function tree(x, y, z, h) {
    const [a, b] = proj(x, y, z),
      u = h * S;
    c.fillStyle = p.bark;
    c.fillRect(a - u * 0.049, b - u * 0.3, u * 0.098, u * 0.32);
    for (const [base, top, wide] of [
      [0.14, 0.72, 0.25],
      [0.34, 0.89, 0.207],
      [0.54, 1, 0.155],
    ]) {
      poly(p.pine, [
        [a - wide * u, b - base * u],
        [a, b - top * u],
        [a + wide * u, b - base * u],
        [a + u * 0.02, b - (base - 0.045) * u],
      ]);
      poly(p.light, [
        [a - wide * u, b - base * u],
        [a, b - top * u],
        [a - u * 0.026, b - (base + 0.045) * u],
      ]);
    }
  }
  function terrain(level) {
    const left = cam - (W * 0.36) / S - 3,
      right = cam + (W * 0.74) / S + 3;
    for (const s of level.track) {
      if (
        s.end < left ||
        s.x > right ||
        s.kind === "gap" ||
        s.kind === "bridge" ||
        s.kind === "rocker"
      )
        continue;
      for (let i = Math.ceil(s.x / 3); i * 3 < s.end - 0.4; i++) {
        const x = i * 3 + 0.14;
        if (noise(i + 4) > 0.3)
          tree(x, s.y + (x - s.x) * s.slope, 1.65, 1.4 + noise(i + 14) * 1.9);
      }
    }
    for (const s of level.track) {
      if (s.end < left || s.x > right || s.kind === "gap") continue;
      const h = (x) => s.y + (x - s.x) * s.slope,
        z = -1.45,
        back = 1.45;
      const strip = (a, b, za, zb, offset = 0) => [
        [a, h(a) + offset, za],
        [b, h(b) + offset, za],
        [b, h(b) + offset, zb],
        [a, h(a) + offset, zb],
      ];
      if (s.kind === "bridge" || s.kind === "rocker") {
        if (s.kind === "rocker") {
          const middle = (s.x + s.end) / 2;
          box(middle - 0.18, -9, z + 0.15, 0.36, s.base + 8.8, 2.3, [
            "#7b6556",
            "#b89368",
            "#66594b",
          ]);
        }
        for (let x = s.x + 0.24; s.kind === "bridge" && x < s.end; x += 2.55) {
          box(x, -9, z + 0.15, 0.22, h(x) + 8.7, 0.2, [
            "#795643",
            "#ac805b",
            "#604837",
          ]);
          const b = Math.min(x + 2.55, s.end);
          line(
            "#806047",
            Math.max(2, S * 0.11),
            proj(x, h(x) - 2.6, z + 0.2),
            proj(b, h(b) - 0.32, z + 0.2),
          );
        }
        face("#6f5142", [
          [s.x, h(s.x) - 0.38, z],
          [s.end, h(s.end) - 0.38, z],
          [s.end, h(s.end), z],
          [s.x, h(s.x), z],
        ]);
        const planks = Math.ceil((s.end - s.x) / 0.45);
        for (let i = 0; i < planks; i++) {
          const a = s.x + (i * (s.end - s.x)) / planks,
            b = s.x + ((i + 1) * (s.end - s.x)) / planks;
          face(
            i % 3 === 0 ? "#bd9264" : "#d0a577",
            strip(a, b - 0.022, z, back),
          );
        }
      } else {
        const a = s.x,
          b = s.end,
          top = s.kind === "ice" ? "#d4eff1" : p.grass;
        face(p.rock, [
          [b, -12, z],
          [b, -12, back],
          [b, h(b), back],
          [b, h(b), z],
        ]);
        face(p.stone, [
          [a, -12, z],
          [b, -12, z],
          [b, h(b), z],
          [a, h(a), z],
        ]);
        for (let i = Math.floor(a / 1.5); i * 1.5 < b; i++) {
          const l = Math.max(i * 1.5, a),
            r = Math.min((i + 1) * 1.5, b),
            v = noise(i + 29);
          face(i % 3 ? "#462f2923" : "#efd69336", [
            [l, h(l) - 0.57, z],
            [r, h(r) - 0.55, z],
            [r, h(r) - 1.1 - v * 2.8, z],
          ]);
          if (r - l > 0.9)
            face("#e3b88170", [
              [l + 0.3, h(l) - 1.8, z],
              [l + 0.8, h(l) - 1.77, z],
              [l + 0.64, h(l) - 1.64, z],
              [l + 0.43, h(l) - 1.66, z],
            ]);
        }
        // A continuous darker stratum gives the exposed cliffs depth.
        const seam = (x) => h(x) - 2.85 + Math.sin(x * 0.35) * 0.29;
        const ridge = [[a, seam(a), z]];
        for (let x = Math.ceil(a / 2) * 2; x < b; x += 2)
          ridge.push([x, seam(x), z]);
        ridge.push([b, seam(b), z]);
        face("#57423430", [
          ...ridge,
          ...ridge
            .slice()
            .reverse()
            .map(([x, y, z]) => [x, y - 0.26, z]),
        ]);
        face(p.edge, [
          [a, h(a) - 0.43, z],
          [b, h(b) - 0.43, z],
          [b, h(b), z],
          [a, h(a), z],
        ]);
        face(top, strip(a, b, z, back));
        face(
          s.kind === "ice" ? "#b9e0e3" : "#e5c78b",
          strip(a, b, -0.98, 1.03, 0.005),
        );
        for (let k = Math.ceil(a / 0.9); k * 0.9 < b - 0.3; k++) {
          const x = k * 0.9,
            depth = noise(k) * 1.65 - 0.83;
          face("#80664042", strip(x, x + 0.18, depth, depth + 0.045, 0.012));
        }
      }
    }
  }
  function finish(level) {
    const x = level.finish,
      seg = level.track.at(-1),
      y = seg.top,
      z = 1.2;
    box(x, y, z, 0.1, 3.6, 0.1, ["#433f38", "#d8c8a8", "#746b55"]);
    for (let i = 0; i < 5; i++)
      for (let j = 0; j < 3; j++) {
        const a = x + 0.1 + i * 0.25,
          b = a + 0.25,
          t = y + 3.59 - j * 0.235,
          off = i * 0.018;
        face((i + j) % 2 ? "#364441" : "#f7f0d4", [
          [a, t - off, z],
          [b, t - off - 0.018, z],
          [b, t - off - 0.253, z],
          [a, t - off - 0.235, z],
        ]);
      }
  }
  function sign(x, y) {
    const z = 1.28;
    box(x, y, z, 0.115, 1.43, 0.12, ["#7e6347", "#d5b382", "#5b4d3c"]);
    face("#684f31", [
      [x - 0.48, y + 0.98, z],
      [x + 0.35, y + 0.98, z],
      [x + 0.62, y + 1.29, z],
      [x + 0.35, y + 1.59, z],
      [x - 0.48, y + 1.59, z],
    ]);
    face("#f9bd4e", [
      [x - 0.43, y + 1.04, z],
      [x + 0.32, y + 1.04, z],
      [x + 0.54, y + 1.29, z],
      [x + 0.32, y + 1.53, z],
      [x - 0.43, y + 1.53, z],
    ]);
    for (const d of [-0.22, 0.06])
      face("#4d4735", [
        [x + d, y + 1.1, z],
        [x + d + 0.13, y + 1.29, z],
        [x + d, y + 1.47, z],
        [x + d + 0.12, y + 1.47, z],
        [x + d + 0.25, y + 1.29, z],
        [x + d + 0.12, y + 1.1, z],
      ]);
  }
  function truck(car) {
    const q = (x, y, z) => {
      const v = point(car, x, y);
      return proj(v.x, v.y, z);
    };
    const shape = (color, coords, z) =>
      poly(
        color,
        coords.map(([x, y]) => q(x, y, z)),
      );
    const prism = (outline, front, top, side, z0 = -0.49, z1 = 0.49) => {
      shape(side, outline, z1);
      for (let i = 0; i < outline.length; i++) {
        const a = outline[i],
          b = outline[(i + 1) % outline.length];
        poly(b[0] >= a[0] ? top : side, [
          q(...a, z0),
          q(...b, z0),
          q(...b, z1),
          q(...a, z1),
        ]);
      }
      shape(front, outline, z0);
    };
    const rim = (x, z, r, color, rot, n = 12) => {
      const pts = Array.from({ length: n }, (_, i) => {
        const t = (i * Math.PI * 2) / n + rot;
        return q(x + Math.cos(t) * r, -0.27 + Math.sin(t) * r, z);
      });
      poly(color, pts);
    };
    function wheel(x, z) {
      rim(x, z + 0.27, radius, "#172b30", -car.roll);
      for (let i = 0; i < 12; i++) {
        const t = (i * Math.PI) / 6 - car.roll,
          a = [x + Math.cos(t) * radius, -0.27 + Math.sin(t) * radius],
          b = [
            x + Math.cos(t + 0.43) * radius,
            -0.27 + Math.sin(t + 0.43) * radius,
          ];
        poly(i % 2 ? "#425052" : "#334348", [
          q(...a, z),
          q(...b, z),
          q(...b, z + 0.27),
          q(...a, z + 0.27),
        ]);
      }
      rim(x, z, radius, "#24363a", -car.roll);
      rim(x, z, 0.405, "#49534e", -car.roll);
      rim(x, z, 0.3, "#e7a933", -car.roll, 8);
      rim(x, z, 0.19, "#936933", -car.roll, 8);
      rim(x, z, 0.1, "#ecd292", -car.roll, 6);
    }
    for (const x of wheels) wheel(x, 0.32);
    prism(
      [
        [-1.43, 0.1],
        [-1.46, 0.32],
        [1.45, 0.32],
        [1.42, -0.04],
        [-1.24, -0.07],
      ],
      "#354246",
      "#69706a",
      "#25373b",
    );
    prism(
      [
        [-1.48, 0.34],
        [-1.4, 0.58],
        [-0.68, 0.59],
        [-0.4, 1.01],
        [0.4, 1.01],
        [0.72, 0.61],
        [1.43, 0.51],
        [1.5, 0.31],
        [1.31, 0.18],
        [-1.27, 0.18],
      ],
      "#e8a21e",
      "#ffda68",
      "#b87a28",
    );
    shape(
      "#273e45",
      [
        [-0.56, 0.62],
        [-0.32, 0.935],
        [0.32, 0.935],
        [0.58, 0.62],
      ],
      -0.501,
    );
    shape(
      "#8eb5b4",
      [
        [-0.48, 0.65],
        [-0.29, 0.89],
        [-0.08, 0.89],
        [-0.08, 0.65],
      ],
      -0.502,
    );
    shape(
      "#649299",
      [
        [0.0, 0.65],
        [0.0, 0.89],
        [0.29, 0.89],
        [0.49, 0.65],
      ],
      -0.502,
    );
    poly("#7ca5a5", [
      q(0.4, 1.005, -0.42),
      q(0.67, 0.635, -0.42),
      q(0.67, 0.635, 0.43),
      q(0.4, 1.005, 0.43),
    ]);
    shape(
      "#ffe085",
      [
        [-1.36, 0.48],
        [-0.65, 0.51],
        [-0.69, 0.56],
        [-1.33, 0.55],
      ],
      -0.501,
    );
    shape(
      "#b77b2a",
      [
        [-0.53, 0.57],
        [0.57, 0.57],
        [0.46, 0.24],
        [-0.5, 0.24],
      ],
      -0.505,
    );
    shape(
      "#f4b12d",
      [
        [-0.49, 0.55],
        [0.51, 0.55],
        [0.43, 0.28],
        [-0.46, 0.28],
      ],
      -0.508,
    );
    shape(
      "#3c4540",
      [
        [0.23, 0.49],
        [0.38, 0.49],
        [0.37, 0.44],
        [0.22, 0.44],
      ],
      -0.51,
    );
    prism(
      [
        [-0.5, 1.0],
        [-0.49, 1.08],
        [0.44, 1.08],
        [0.46, 1.0],
      ],
      "#414a46",
      "#65716a",
      "#343d38",
      -0.55,
      0.55,
    );
    shape(
      "#fff1ba",
      [
        [1.21, 0.47],
        [1.44, 0.46],
        [1.44, 0.36],
        [1.2, 0.36],
      ],
      -0.51,
    );
    shape(
      "#b7422a",
      [
        [-1.43, 0.45],
        [-1.27, 0.46],
        [-1.27, 0.35],
        [-1.46, 0.35],
      ],
      -0.51,
    );
    for (const x of wheels) wheel(x, -0.7);
  }
  function render(level, car, dt) {
    p = palettes[level.theme];
    if (prev !== car) {
      cam = car.x;
      cy = car.y - 0.85;
      prev = car;
    }
    const blend = 1 - Math.exp(-5 * dt);
    cam += (car.x + clamp(car.vx * 0.07, -0.8, 0.9) - cam) * blend;
    cy += (clamp(car.y - 0.85, -2.5, 5.5) - cy) * blend;
    background();
    terrain(level);
    sign(-1.6, 0);
    finish(level);
    truck(car);
  }
  return render;
}
