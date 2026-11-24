const width = 900;
const height = 450;
const margin = 46;
const ballColors = [
  "#f1ead6",
  "#edb92c",
  "#3177c3",
  "#d74638",
  "#844f9f",
  "#e68132",
  "#399565",
  "#a83b47",
  "#242a2c",
];

type Brush = string | CanvasGradient;
type Point = readonly [number, number];

function polygon(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  fill: Brush,
) {
  ctx.beginPath();
  ctx.moveTo(...points[0]);
  for (const point of points.slice(1)) ctx.lineTo(...point);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function circle(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  fill: Brush,
) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

function rounded(
  ctx: CanvasRenderingContext2D,
  offset: number,
  radius: number,
  fill: Brush,
) {
  ctx.beginPath();
  ctx.roundRect(
    -offset,
    -offset,
    width + 2 * offset,
    height + 2 * offset,
    radius,
  );
  ctx.fillStyle = fill;
  ctx.fill();
}

function cushion(ctx: CanvasRenderingContext2D, start: number, end: number) {
  // Each rail runs along local y=0 with the playing surface below it.
  const cushionColor = ctx.createLinearGradient(0, -15, 0, 1);
  cushionColor.addColorStop(0, "#174c3b");
  cushionColor.addColorStop(0.2, "#286c50");
  cushionColor.addColorStop(0.63, "#327c5c");
  cushionColor.addColorStop(0.88, "#378764");
  cushionColor.addColorStop(1, "#194f3d");
  polygon(
    ctx,
    [
      [start - 8, -15],
      [end + 8, -15],
      [end, 0],
      [start, 0],
    ],
    cushionColor,
  );
  polygon(
    ctx,
    [
      [start - 8, -15],
      [start, 0],
      [start + 4, 0],
      [start - 3, -15],
    ],
    "#245c47",
  );
  polygon(
    ctx,
    [
      [end + 8, -15],
      [end, 0],
      [end - 4, 0],
      [end + 3, -15],
    ],
    "#235941",
  );
  ctx.fillStyle = "#9fc8a32a";
  ctx.fillRect(start + 2, -1.6, end - start - 4, 0.7);
}

function diamond(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  vertical = false,
) {
  ctx.save();
  ctx.translate(x, y);
  if (vertical) ctx.rotate(Math.PI / 2);
  polygon(
    ctx,
    [
      [0, -3.8],
      [2.6, 0],
      [0, 3.8],
      [-2.6, 0],
    ],
    "#301f1a",
  );
  polygon(
    ctx,
    [
      [0, -3],
      [1.9, 0],
      [0, 2.6],
      [-1.9, 0],
    ],
    "#ede0b6",
  );
  ctx.restore();
}

function pocket(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(x === width ? -1 : 1, y === height ? -1 : 1);
  const brass = ctx.createLinearGradient(-26, -38, 12, 8);
  brass.addColorStop(0, "#765c36");
  brass.addColorStop(0.21, "#d1b67a");
  brass.addColorStop(0.4, "#b19760");
  brass.addColorStop(0.68, "#79643f");
  brass.addColorStop(1, "#4d402d");
  ctx.fillStyle = brass;
  ctx.beginPath();
  if (x === width / 2) {
    ctx.roundRect(-29, -36, 58, 24, 4);
  } else {
    ctx.moveTo(-36, 21);
    ctx.lineTo(-36, -12);
    ctx.quadraticCurveTo(-36, -36, -12, -36);
    ctx.lineTo(21, -36);
    ctx.lineTo(21, -14);
    ctx.lineTo(-14, 21);
    ctx.closePath();
  }
  ctx.fill();
  const rivets: Point[] =
    x === width / 2
      ? [
          [-24, -29],
          [24, -29],
        ]
      : [
          [-29, 14],
          [14, -29],
        ];
  for (const [rx, ry] of rivets) {
    circle(ctx, rx, ry, 1.7, "#705a3c");
    circle(ctx, rx - 0.2, ry - 0.4, 0.9, "#d3b780");
  }
  const lip = ctx.createLinearGradient(0, -24, 0, 22);
  lip.addColorStop(0, "#453a2c");
  lip.addColorStop(0.5, "#262721");
  lip.addColorStop(1, "#4d4634");
  circle(ctx, 0, 0, 22.4, lip);
  const well = ctx.createRadialGradient(-2, -6, 1, 0, 0, 20.3);
  well.addColorStop(0, "#050a09");
  well.addColorStop(0.77, "#090e0c");
  well.addColorStop(1, "#17211a");
  circle(ctx, 0, 0, 20, well);
  ctx.restore();
}

function paintTable(ctx: CanvasRenderingContext2D) {
  ctx.save();
  ctx.shadowColor = "#090c0ad9";
  ctx.shadowBlur = 9;
  ctx.shadowOffsetY = 4;
  rounded(ctx, 38, 28, "#191611");
  ctx.restore();
  rounded(ctx, 36.8, 26, "#986f44");
  const walnut = ctx.createLinearGradient(0, -36, width * 0.28, height + 38);
  walnut.addColorStop(0, "#765036");
  walnut.addColorStop(0.35, "#60402e");
  walnut.addColorStop(0.65, "#543526");
  walnut.addColorStop(1, "#734b31");
  rounded(ctx, 35, 25, walnut);

  // Deterministic, fine grain on the long and short walnut rails.
  for (let side = 0; side < 4; side++) {
    ctx.save();
    if (side === 1) {
      ctx.translate(width, 0);
      ctx.rotate(Math.PI / 2);
    }
    if (side === 2) {
      ctx.translate(width, height);
      ctx.rotate(Math.PI);
    }
    if (side === 3) {
      ctx.translate(0, height);
      ctx.rotate(-Math.PI / 2);
    }
    const length = side % 2 ? height : width;
    for (let i = 0; i < 18; i++) {
      const y = -34 + i * 0.99;
      ctx.strokeStyle = i % 3 ? "#30201739" : "#e2b17934";
      ctx.lineWidth = i % 4 === 0 ? 0.85 : 0.45;
      ctx.beginPath();
      ctx.moveTo(12, y);
      ctx.bezierCurveTo(
        length * 0.31,
        y - 3 + (i % 5),
        length * 0.52,
        y + Math.sin(i) * 2.7,
        length - 12,
        y,
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  rounded(ctx, 16.5, 16, "#302a20");
  const felt = ctx.createRadialGradient(385, 170, 22, 450, 215, 570);
  felt.addColorStop(0, "#217c5c");
  felt.addColorStop(0.52, "#1b7054");
  felt.addColorStop(1, "#11513e");
  rounded(ctx, 14.8, 16, felt);
  // Fabric grain is painted once into the table sprite.
  let seed = 817;
  function fraction() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  for (let i = 0; i < 14500; i++) {
    ctx.fillStyle = i % 2 ? "#e4fff10b" : "#031f150d";
    ctx.fillRect(
      fraction() * width,
      fraction() * height,
      0.8 + fraction(),
      0.6,
    );
  }
  ctx.save();
  ctx.strokeStyle = "#def2cf25";
  ctx.lineWidth = 0.7;
  ctx.setLineDash([2, 6]);
  ctx.beginPath();
  ctx.moveTo(width / 4, 12);
  ctx.lineTo(width / 4, height - 12);
  ctx.stroke();
  ctx.restore();
  for (const x of [width / 4, (width * 3) / 4])
    circle(ctx, x, height / 2, 2, "#d2e2ba5c");

  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.fillStyle = "#b1d5ae27";
  ctx.textAlign = "center";
  ctx.font = 'italic bold 34px Georgia, "Times New Roman", serif';
  ctx.fillText("Side Pocket", 0, 6);
  for (const direction of [-1, 1]) {
    ctx.save();
    ctx.scale(direction, 1);
    polygon(
      ctx,
      [
        [88, -4],
        [100, -5],
        [106, -4],
        [100, -3],
      ],
      "#b1d5ae2e",
    );
    ctx.restore();
  }
  ctx.restore();

  for (let side = 0; side < 4; side++) {
    ctx.save();
    if (side === 1) {
      ctx.translate(width, 0);
      ctx.rotate(Math.PI / 2);
    }
    if (side === 2) {
      ctx.translate(width, height);
      ctx.rotate(Math.PI);
    }
    if (side === 3) {
      ctx.translate(0, height);
      ctx.rotate(-Math.PI / 2);
    }
    if (side % 2 === 0) {
      cushion(ctx, 23, width / 2 - 22);
      cushion(ctx, width / 2 + 22, width - 23);
    } else {
      cushion(ctx, 23, height - 23);
    }
    ctx.restore();
  }
  for (const x of [1, 2, 3, 5, 6, 7].map((i) => (width * i) / 8)) {
    diamond(ctx, x, -26);
    diamond(ctx, x, height + 26);
  }
  for (const y of [height / 4, height / 2, (height * 3) / 4]) {
    diamond(ctx, -26, y, true);
    diamond(ctx, width + 26, y, true);
  }
  for (const x of [0, width / 2, width]) {
    pocket(ctx, x, 0);
    pocket(ctx, x, height);
  }
}

let tableSprite: HTMLCanvasElement | undefined;

export function drawTable(ctx: CanvasRenderingContext2D) {
  if (!tableSprite) {
    tableSprite = document.createElement("canvas");
    tableSprite.width = (width + margin * 2) * 2;
    tableSprite.height = (height + margin * 2) * 2;
    const surface = tableSprite.getContext("2d")!;
    surface.scale(2, 2);
    surface.translate(margin, margin);
    paintTable(surface);
  }
  ctx.drawImage(
    tableSprite,
    -margin,
    -margin,
    width + margin * 2,
    height + margin * 2,
  );
}

export function drawBall(
  ctx: CanvasRenderingContext2D,
  id: number,
  x: number,
  y: number,
  roll: number,
  scale = 1,
) {
  if (scale <= 0) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  const shadow = ctx.createRadialGradient(1.4, 3.2, 4, 1.4, 3.2, 13);
  shadow.addColorStop(0, "#061811ba");
  shadow.addColorStop(0.7, "#06181172");
  shadow.addColorStop(1, "#06181100");
  circle(ctx, 1.4, 3.2, 13, shadow);
  const color = ballColors[id > 8 ? id - 8 : id];
  circle(ctx, 0, 0, 10, id > 8 ? "#efe9d6" : color);
  ctx.save();
  ctx.clip();
  ctx.rotate(((id * 1.73) % 0.75) - 0.36 + Math.sin(roll) * 0.82);
  if (id > 8) {
    ctx.fillStyle = color;
    ctx.fillRect(-11, -5.5 + 2.8 * Math.sin(roll), 22, 11);
  }
  if (id) {
    const numberX = 1.7 * Math.sin(roll);
    const numberY = 1.1 * Math.sin(roll * 2);
    circle(ctx, numberX, numberY, 4.5, "#f8f3dc");
    ctx.fillStyle = "#202b26";
    ctx.font = `bold ${id > 9 ? 5.5 : 7}px Arial, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(id), numberX, numberY + 0.4);
  }
  ctx.restore();
  const gloss = ctx.createRadialGradient(-3.8, -4.8, 0.9, 0, 0, 10);
  gloss.addColorStop(0, "#ffffff75");
  gloss.addColorStop(0.33, "#ffffff10");
  gloss.addColorStop(0.54, "#15291e00");
  gloss.addColorStop(0.85, "#08170e32");
  gloss.addColorStop(1, "#050e0a7a");
  circle(ctx, 0, 0, 10, gloss);
  ctx.fillStyle = "#fffcedae";
  ctx.beginPath();
  ctx.ellipse(-3.8, -5, 2.3, 1, -0.38, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
