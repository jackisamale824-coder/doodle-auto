// All scenery and puppets are drawn in stage coordinates. The repeating colonnade
// moves behind the actors while their feet stay on the runner.
export function palace(canvas) {
  const c = canvas.getContext("2d");
  const ink = "#302b40",
    gold = "#ecc677",
    cream = "#ffedc5";
  function poly(points, color, edge = "", width = 3) {
    c.beginPath();
    c.moveTo(points[0], points[1]);
    for (let i = 2; i < points.length; i += 2)
      c.lineTo(points[i], points[i + 1]);
    c.closePath();
    c.fillStyle = color;
    c.fill();
    if (edge) {
      c.strokeStyle = edge;
      c.lineWidth = width;
      c.stroke();
    }
  }
  function oval(x, y, rx, ry, color, edge = "") {
    c.beginPath();
    c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    c.fillStyle = color;
    c.fill();
    if (edge) {
      c.strokeStyle = edge;
      c.lineWidth = 2.5;
      c.stroke();
    }
  }
  function line(x, y, xx, yy, color, w) {
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(xx, yy);
    c.strokeStyle = color;
    c.lineWidth = w;
    c.stroke();
  }
  function rect(x, y, w, h, color) {
    c.fillStyle = color;
    c.fillRect(x, y, w, h);
  }
  function gradient(y, h, top, bottom) {
    const g = c.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, top);
    g.addColorStop(1, bottom);
    return g;
  }
  function star(x, y, r, color) {
    poly(
      [
        x,
        y - r,
        x + r * 0.19,
        y - r * 0.19,
        x + r * 0.75,
        y,
        x + r * 0.19,
        y + r * 0.18,
        x,
        y + r,
        x - r * 0.19,
        y + r * 0.18,
        x - r * 0.75,
        y,
        x - r * 0.19,
        y - r * 0.18,
      ],
      color,
    );
  }
  function arch(x, base, w, h) {
    c.beginPath();
    c.moveTo(x, base);
    c.lineTo(x, base - h * 0.56);
    c.bezierCurveTo(
      x,
      base - h * 0.84,
      x + w * 0.28,
      base - h * 0.94,
      x + w / 2,
      base - h,
    );
    c.bezierCurveTo(
      x + w * 0.72,
      base - h * 0.94,
      x + w,
      base - h * 0.84,
      x + w,
      base - h * 0.56,
    );
    c.lineTo(x + w, base);
    c.closePath();
  }
  // Paint one seamless, reusable bay of the palace.
  const backdrop = document.createElement("canvas");
  backdrop.width = 280;
  backdrop.height = 380;
  function drawBay() {
    rect(0, 0, 280, 380, gradient(0, 380, "#233044", "#527073"));
    for (let row = 0; row < 9; row++)
      for (let col = -1; col < 5; col++) {
        const x = col * 76 + (row % 2) * 38,
          y = row * 38;
        rect(
          x + 1,
          y + 1,
          74,
          35,
          (row + col) % 3 === 0 ? "#3a555f" : "#364e59",
        );
      }
    arch(44, 288, 188, 258);
    c.fillStyle = "#293541";
    c.fill();
    c.lineWidth = 12;
    c.strokeStyle = "#81908a";
    c.stroke();
    arch(53, 282, 170, 239);
    c.save();
    c.clip();
    rect(45, 30, 190, 260, gradient(30, 250, "#1d3654", "#c6807a"));
    oval(174, 123, 23, 23, "#f4d79a");
    for (let i = 0; i < 23; i++)
      star(
        56 + ((i * 71 + i * i * 3) % 164),
        54 + ((i * 43 + i * i * 7) % 120),
        i % 4 === 0 ? 2.8 : 1.3,
        "#e3cc9b",
      );
    poly(
      [
        40, 237, 74, 209, 91, 217, 122, 199, 145, 211, 186, 179, 215, 197, 237,
        186, 237, 290, 40, 290,
      ],
      "#6f7181",
    );
    for (let i = 0; i < 10; i++) {
      const x = 45 + i * 20,
        y = 211 + ((i * 17) % 24);
      rect(x, y, 21, 80, "#485666");
      poly([x - 4, y, x + 10, y - 15 - (i % 3) * 6, x + 24, y], "#3e4b5b");
      rect(x + 7, y + 7, 3, 6, "#b59c83");
    }
    for (let x = 87; x < 220; x += 45) line(x, 55, x, 290, "#65747c", 3);
    for (let y = 100; y < 285; y += 43) line(50, y, 225, y, "#65747c", 2);
    c.restore();
    rect(38, 286, 202, 9, "#95a09a");
    rect(43, 295, 190, 6, "#263a46");
    rect(0, 314, 280, 61, "#4e5054");
    for (let x = 8; x < 280; x += 55) {
      rect(x, 322, 45, 39, "#737169");
      rect(x + 3, 325, 39, 32, "#484d50");
    }
    // Ribbed stone pier and a swallowtail banner.
    rect(0, 18, 30, 304, gradient(0, 320, "#b9ad90", "#708383"));
    rect(4, 41, 4, 266, "#d1ba91");
    rect(21, 41, 4, 266, "#4e6569");
    rect(-3, 20, 39, 11, "#bdab87");
    rect(0, 31, 31, 9, "#75827c");
    rect(-3, 309, 39, 14, "#aaa38b");
    poly(
      [232, 12, 263, 12, 263, 149, 248, 134, 232, 149],
      "#743747",
      "#382f40",
      2,
    );
    line(236, 16, 236, 140, "#d6a364", 2);
    line(259, 16, 259, 140, "#d6a364", 2);
    star(247, 86, 10, gold);
    rect(0, 4, 280, 6, "#a99a80");
    rect(0, 12, 280, 5, "#617275");
  }
  // Render the bay once using the same drawing helpers.
  const savedW = canvas.width,
    savedH = canvas.height;
  canvas.width = 280;
  canvas.height = 380;
  drawBay();
  backdrop.getContext("2d").drawImage(canvas, 0, 0);
  canvas.width = savedW;
  canvas.height = savedH;
  function crown(x, y, s = 1) {
    c.save();
    c.translate(x, y);
    c.scale(s, s);
    poly(
      [-28, 4, -33, -24, -15, -14, -3, -38, 8, -13, 28, -32, 23, 4],
      gold,
      ink,
      3,
    );
    rect(-28, -1, 53, 8, "#f9d680");
    rect(-26, 5, 50, 3, "#a96645");
    oval(-3, -4, 3, 5, "#be4653");
    for (const [px, py] of [
      [-33, -25],
      [-3, -38],
      [28, -32],
    ])
      oval(px, py, 3, 3, cream);
    c.restore();
  }
  function puppet(
    x,
    base,
    t,
    king,
    look,
    raise,
    index,
    flower,
    depart,
    uncrowned = false,
  ) {
    const scale = king ? 1.1 : 1;
    const gait = Math.sin(t * 7 + (king ? 0 : 1.7)),
      bob = Math.abs(gait) * 2.4;
    oval(x, base + 3, king ? 43 : 33, 7, "#35273970");
    c.save();
    c.translate(x, base - bob);
    c.scale(scale, scale);
    c.lineJoin = "round";
    c.lineCap = "round";
    const skin = ["#e8b988", "#c88768", "#e9be92", "#bb805d"][index % 4];
    const coat = king
      ? index === 0
        ? "#39847c"
        : "#ac4858"
      : ["#3d8681", "#6579a4", "#995574", "#538576"][index % 4];
    const trim = king ? "#fae3b1" : "#e6c77e";
    for (const side of [-1, 1]) {
      const swing = gait * side * (depart ? 13 : 8);
      c.save();
      c.translate(side * 10, -41);
      c.rotate(swing * 0.023);
      line(0, 0, 3, 32, ink, 11);
      line(3, 32, 3, 39, "#c3ae8d", 7);
      poly([-4, 34, 7, 34, 10, 38, 18, 39, 18, 43, -5, 43], "#332d39", ink, 2);
      c.restore();
    }
    if (king) {
      poly(
        [-16, -114, -37, -100, -59, -28, -30, -18, 0, -40, 17, -105],
        "#70384e",
        ink,
      );
      poly([-16, -110, -35, -98, -53, -28, -48, -26, -29, -94, 0, -104], trim);
    }
    poly(
      [
        -19, -112, 13, -113, 24, -95, 28, -62, 36, -32, 3, -27, -32, -34, -22,
        -69, -30, -90,
      ],
      coat,
      ink,
    );
    poly([-15, -105, 1, -109, 4, -34, -22, -38], "#fff2bd25");
    poly([-29, -41, 31, -39, 35, -32, 2, -28, -32, -34], trim, ink, 1.5);
    for (let j = 0; j < 3; j++) {
      oval(9, -88 + j * 15, 2.8, 2.8, gold);
    }
    if (king) {
      poly(
        [-26, -109, -11, -121, 12, -118, 23, -105, 9, -88, -9, -97],
        cream,
        ink,
      );
      for (let j = 0; j < 4; j++)
        oval(-19 + j * 8, -106 + Math.sin(j) * 2, 1.7, 2.9, "#5b4a51");
      poly([-20, -87, -8, -68, 23, -75, 24, -67, -9, -60, -25, -78], "#d8b370");
      star(-9, -65, 5, gold);
    } else {
      poly(
        [-25, -105, 12, -115, 20, -108, -12, -92, -6, -78, -29, -87],
        "#e4bb77",
        ink,
        2,
      );
      poly([-23, -69, 27, -73, 27, -64, -23, -60], ink);
      rect(-2, -71, 9, 7, gold);
    }
    // The face turns independently, making the royal glance readable in silhouette.
    c.save();
    c.translate(0, -116);
    if (look) c.scale(-1, 1);
    oval(-5, -18, king ? 26 : 22, 28, skin, ink);
    poly(
      [8, -26, 16, -25, 29, -13, 17, -10, 15, 1, 1, 6, -12, 0],
      skin,
      ink,
      2.5,
    );
    oval(-19, -11, 6, 8, skin, ink);
    line(-21, -12, -18, -14, "#9f6859", 2);
    if (king) {
      poly(
        [
          -27, -23, -26, -8, -17, -8, -13, -20, -6, -28, 9, -26, 16, -33, 8,
          -45, -20, -42,
        ],
        "#644653",
        ink,
        2,
      );
      if (index !== 0)
        poly(
          [-11, -5, -2, -9, 8, -6, 21, -8, 16, 0, 6, 3, -1, 1, -10, 4, -17, -1],
          "#754a48",
          ink,
          2,
        );
      if (!uncrowned) crown(-4, -42, 0.84);
    } else {
      poly(
        [
          -28, -22, -24, -41, -8, -51, 11, -46, 17, -33, 6, -29, -8, -31, -17,
          -16,
        ],
        "#354a56",
        ink,
        2,
      );
      poly([-27, -33, 19, -38, 23, -30, -26, -24], "#4c6e75", ink, 2);
      poly(
        [-13, -39, -28, -47, -38, -68, -24, -65, -14, -52, -11, -40],
        "#e79175",
        ink,
        2,
      );
      line(-28, -58, -14, -41, gold, 1.2);
    }
    oval(9, -20, 4.6, 5.3, cream);
    oval(11, -20, 2.1, 3.1, ink);
    line(3, -27, 13, -25, ink, 2.8);
    if (!king) line(8, -4, 17, -6, ink, 1.8);
    c.restore();
    c.save();
    c.translate(king ? 9 : -4, -94);
    c.rotate(king ? -0.2 + gait * 0.13 : 0.24 + gait * 0.1 - raise * 2.55);
    poly([-9, -4, 4, -6, 13, 15, 10, 23, -2, 23, -12, 6], coat, ink);
    line(3, 22, 10, 31, trim, 7);
    oval(10, 30, 6, 6, skin, ink);
    if (king) {
      line(13, 43, 22, -11, "#795249", 5);
      line(14, 39, 22, -10, gold, 2.7);
      star(23, -15, 7, gold);
    } else if (raise > 0.08) {
      if (flower) {
        line(10, 29, 21, 51, "#56996a", 3);
        oval(23, 53, 6, 5, "#e66a83", ink);
      } else {
        poly([6, 33, 12, 29, 33, 47, 39, 61, 25, 53], "#dce6e3", ink, 2);
        line(3, 36, 15, 25, gold, 4);
      }
    }
    c.restore();
    c.restore();
  }
  return function draw(game, time, scroll) {
    const w = 960,
      h = 420;
    c.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0);
    c.clearRect(0, 0, w, h);
    let offset = scroll % 280;
    for (let x = -offset - 280; x < w; x += 280) c.drawImage(backdrop, x, 0);
    rect(0, 366, w, 54, gradient(366, 54, "#9d9181", "#685d66"));
    for (let x = (-scroll % 128) - 128; x < w + 128; x += 128)
      line(x, 366, x - 40, 420, "#514f5a", 2);
    poly([0, 374, w, 374, w, 401, 0, 401], "#a24c56");
    rect(0, 378, w, 2, "#ddaf75");
    rect(0, 397, w, 2, "#ce9f6b");
    for (let x = -scroll % 40; x < w; x += 40)
      poly([x, 387, x + 7, 383, x + 14, 387, x + 7, 391], "#d29c71");
    const title = game.phase === "title";
    const defend =
      game.phase === "rule" ||
      (game.phase === "ending" && game.result !== "dungeon");
    const x = title ? 650 : 508;
    const leaving = game.cue === "depart" && defend;
    let rival =
      x -
      110 -
      (game.cue === "approach" && defend
        ? (game.remaining / game.duration) * 125
        : 0);
    if (leaving) rival -= 150 * (1 - game.remaining / game.duration);
    const raised = defend
      ? game.cue === "raise"
        ? 0.3 + 0.7 * (1 - game.remaining / game.duration)
        : 0
      : game.held
        ? Math.min(1, 0.32 + game.charge * 0.68)
        : 0;
    puppet(
      rival,
      386,
      time,
      false,
      false,
      title ? 0.78 : raised,
      defend ? game.visitor % 4 : 0,
      defend && !game.hostile,
      leaving,
    );
    const coronation = game.phase === "crown" ? 1 - game.remaining / 1.35 : 0;
    puppet(
      x + 28 + 540 * coronation ** 2,
      385,
      time,
      true,
      game.cue === "watch" || game.look > 0.06,
      0,
      defend ? 0 : 2,
      false,
      false,
      game.phase === "crown",
    );
    if (game.cue === "tell" && game.phase === "plot") {
      c.font = "bold 33px Georgia";
      c.fillStyle = "#ffe299";
      c.fillText("?", x + 48, 183);
    }
    if (defend && game.cue === "raise") {
      const bx = rival - 20,
        by = 174;
      oval(bx, by, 18, 18, cream, ink);
      if (game.hostile) {
        poly(
          [
            bx - 7,
            by + 8,
            bx - 4,
            by,
            bx + 9,
            by - 10,
            bx + 7,
            by - 2,
            bx,
            by + 5,
          ],
          "#5b687e",
          ink,
          1.5,
        );
        line(bx - 9, by + 3, bx - 2, by + 10, "#ab8249", 3);
      } else {
        line(bx - 4, by + 10, bx + 1, by - 4, "#448467", 3);
        oval(bx + 2, by - 4, 6, 5, "#c64d70");
      }
    }
    if (game.phase === "crown") {
      const t = 1 - game.remaining / 1.35;
      crown(rival + 105 * (1 - t), 173 - Math.sin(t * Math.PI) * 63, 0.85);
      for (let i = 0; i < 11; i++)
        star(
          rival - 38 + i * 9,
          179 + Math.sin(i * 2 + t * 7) * 25,
          2 + 3 * t,
          gold,
        );
    }
    const shade = c.createLinearGradient(0, 0, w, 0);
    shade.addColorStop(0, "#171c3190");
    shade.addColorStop(0.26, "#171c3100");
    shade.addColorStop(0.78, "#171c3100");
    shade.addColorStop(1, "#171c3166");
    rect(0, 0, w, h, shade);
  };
}
