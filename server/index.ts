import { generateLevel } from "../src/levels.ts";
import { timingSafeEqual } from "node:crypto";
import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { Rooms } from "./rooms.ts";
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
};
const server = http.createServer(async (req, res) => {
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
  if (req.url === "/lobbies") {
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
let admissionCredit = 24,
  admissionAt = Date.now();
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
);
server.on("upgrade", (req, socket, head) => {
  if (req.url === "/ws") {
    const now = Date.now();
    admissionCredit = Math.min(
      24,
      admissionCredit + (now - admissionAt) * 0.008,
    );
    admissionAt = now;
    // Browser origins must match this host; non-browser clients get the same game limits.
    let validOrigin = true;
    if (req.headers.origin) {
      try {
        const origin = new URL(req.headers.origin);
        validOrigin =
          ["http:", "https:"].includes(origin.protocol) &&
          origin.host === req.headers.host;
      } catch {
        validOrigin = false;
      }
    }
    if (!validOrigin || wss.clients.size >= 256 || admissionCredit < 1) {
      socket.end(
        "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
      );
      return;
    }
    admissionCredit--; // ws sets TCP_NODELAY on upgraded sockets.

    wss.handleUpgrade(req, socket, head, (ws) =>
      wss.emit("connection", ws, req),
    );
  } else if (production) socket.destroy();
});
const port = Number(process.env.PORT || 4173),
  host = process.env.HOST || "0.0.0.0";
server.listen(port, host, () =>
  console.log(`doodlesCreed running on http://${host}:${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    rooms.dispose();
    wss.clients.forEach((ws) => ws.close());
    wss.close();
    server.close();
    vite?.close();
  });
