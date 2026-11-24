import { generateLevel } from "../src/levels.ts";
import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { loadCountyFleet } from "./county-fleet.ts";
import { Rooms } from "./rooms.ts";
import { createPoolServer } from "./pool.ts";
import { openPlayerStore, PlayerAccounts } from "./player-accounts.ts";
import { PlayMetrics } from "./play-metrics.ts";
const playerStore = await openPlayerStore();
const accounts = new PlayerAccounts(playerStore);
const metrics = new PlayMetrics(playerStore);
const checkpoint = setInterval(() => void metrics.flush(), 2000);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const production = process.env.NODE_ENV === "production";
const distRoot = path.resolve(
  process.env.STATIC_DIR || path.join(root, "dist"),
);
const vite = production
  ? null
  : await (
      await import("vite")
    ).createServer({
      root,
      configFile: path.join(root, "vite.app.config.ts"),
      server: {
        middlewareMode: true,
        hmr: { port: Number(process.env.PORT || 4173) + 20000 },
      },
      appType: "spa",
    });
const mime: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".wav": "audio/wav",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};
const server = http.createServer(async (req, res) => {
  if (req.url?.startsWith("/api/player/")) return accounts.handle(req,res);
  if (req.url?.startsWith("/internal/")) {
    const supplied = req.headers.authorization ?? "",
      expected = `Bearer ${process.env.CONTROL_SECRET ?? ""}`;
    if (
      !process.env.CONTROL_SECRET ||
      supplied.length !== expected.length ||
      !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
    ) {
      res.writeHead(403).end();
      return;
    }
    res.setHeader("Content-Type", "application/json");
    try {
      if (req.url === "/internal/status") {
        res.end(JSON.stringify({ ...rooms.status(), pid: process.pid }));
        return;
      }
      if (req.method !== "POST") {
        res.writeHead(405).end();
        return;
      }
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > 4096) throw Error("Request too large");
      }
      if (req.url === "/internal/reserve") {
        res.end(JSON.stringify(rooms.reserve(JSON.parse(raw))));
        return;
      }
      if (req.url === "/internal/retire") {
        res.end(JSON.stringify({ retired: rooms.beginRetirement() }));
        return;
      }
      res.writeHead(404).end();
    } catch (e) {
      res.writeHead(409);
      res.end(
        JSON.stringify({
          error: e instanceof Error ? e.message : "Worker request failed",
        }),
      );
    }
    return;
  }
  if (req.url?.split("?", 1)[0] === "/lobbies") {
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(JSON.stringify({ lobbies: rooms.lobbies() }));
    return;
  }
  if (req.url === "/health") {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: true,
        game: "doodlesCreed",
        level: "rust",
        rooms: rooms.rooms.size,
      }),
    );
    return;
  }
  const pathname = req.url?.split("?", 1)[0];
  if (pathname === "/pool" || pathname === "/pool/") {
    req.url = "/pool/index.html";
  }
  if (vite) {
    vite.middlewares(req, res);
    return;
  }
  try {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    const url = new URL(req.url || "/", "http://localhost");
    let file = path.resolve(distRoot, "." + decodeURIComponent(url.pathname));
    if (!file.startsWith(distRoot + path.sep) && file !== distRoot) {
      res.writeHead(403).end();
      return;
    }
    try {
      if ((await stat(file)).isDirectory())
        file = path.join(file, "index.html");
    } catch {
      if (path.extname(file)) {
        res.writeHead(404).end();
        return;
      }
      file = path.join(distRoot, "index.html");
    }
    const body = await readFile(file);
    res.setHeader(
      "Content-Type",
      mime[path.extname(file)] || "application/octet-stream",
    );
    res.setHeader(
      "Cache-Control",
      file.includes("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-cache",
    );
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
});
const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 2048,
  perMessageDeflate: false,
});
const pool = createPoolServer();
// Keep a full County room's burst independent of pool traffic. Pending account
// lookups count toward capacity until ownership transfers to the WebSocket server.
const gtaAdmissions = { credit: 32, at: Date.now(), pending: 0 };
const poolAdmissions = { credit: 24, at: Date.now(), pending: 0 };
const rooms = new Rooms(
  wss,
  generateLevel,
  process.env.RELEASE_ID
    ? {
        releaseId: process.env.RELEASE_ID,
        workerId: process.env.WORKER_ID!,
        workerEpoch: process.env.WORKER_EPOCH!,
      }
    : undefined,
  metrics,
);
if (process.env.MATCH_RECOVERY === "1" && !process.env.RELEASE_ID)
  await rooms.recover(playerStore);
const matchCheckpoint = setInterval(() => {
  void rooms.checkpoint().catch(() => console.warn("Match checkpoint pending"));
}, 5000);
rooms.vehicleModel = await loadCountyFleet(
  production ? distRoot : path.join(root, "public"),
);
server.on("upgrade", async (req, socket, head) => {
  if (["/ws", "/ws/county", "/ws/islands", "/pool/ws"].includes(req.url ?? "")) {
    const isPool = req.url === "/pool/ws";
    const now = Date.now();
    const admissions = isPool ? poolAdmissions : gtaAdmissions;
    admissions.credit = Math.min(isPool ? 24 : 32, admissions.credit + (now - admissions.at) * 0.008);
    admissions.at = now;
    // Browser origins must match this host; non-browser clients get the same game limits.
    let validOrigin = true;
    if (req.headers.origin) {
      try {
        const origin = new URL(req.headers.origin);
        const publicHost = req.headers["x-doodle-public-host"] ?? req.headers.host;
        validOrigin =
          (["http:", "https:"].includes(origin.protocol) && origin.host === publicHost) ||
          (isPool && origin.origin === "https://pool.sully6.com" && publicHost === "sully6.com");
      } catch {
        validOrigin = false;
      }
    }
    if (!validOrigin) {
      socket.end(
        "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
      );
      return;
    }
    if ((isPool ? pool : wss).clients.size + admissions.pending >= 256 || admissions.credit < 1) {
      socket.end("HTTP/1.1 429 Too Many Requests\r\nRetry-After: 1\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
      return;
    }
    admissions.credit--; // ws sets TCP_NODELAY on upgraded sockets.

    if (isPool) {
      pool.handleUpgrade(req, socket, head, ws => pool.emit("connection", ws));
      return;
    }

    admissions.pending++;
    try {
      const user = await accounts.identity(req);
      if (socket.destroyed) return;
      wss.handleUpgrade(req, socket, head, (ws) => {
        if (user) metrics.identities.set(ws,user);
        wss.emit("connection", ws, req);
      });
    } catch {
      socket.end("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
    } finally {
      admissions.pending--;
    }
  } else if (production) socket.destroy();
});
const port = Number(process.env.PORT || 4173),
  host = process.env.HOST || "0.0.0.0";
server.listen(port, host, () =>
  console.log(`doodlesCreed running on http://${host}:${(server.address() as import("node:net").AddressInfo).port}`),
);
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(matchCheckpoint);
    clearInterval(checkpoint);
    server.close();
    await rooms.checkpoint().catch(() => console.warn("Final match checkpoint unavailable"));
    rooms.dispose();
    await metrics.flush();
    wss.clients.forEach((ws) => ws.close());
    wss.close();
    pool.clients.forEach(ws => ws.close());
    pool.close();
    vite?.close();
  });
