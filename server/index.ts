import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { Rooms } from "./rooms.ts";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const production = process.env.NODE_ENV === "production";
const vite = production
  ? null
  : await (
      await import("vite")
    ).createServer({ root, server: { middlewareMode: true }, appType: "spa" });
const mime: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
};
const server = http.createServer(async (req, res) => {
  if (req.url === "/health") {
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        ok: true,
        game: "doodlesCreed",
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
    const url = new URL(req.url || "/", "http://localhost");
    let file = path.resolve(
      root,
      "dist",
      "." + decodeURIComponent(url.pathname),
    );
    if (
      !file.startsWith(path.join(root, "dist") + path.sep) &&
      file !== path.join(root, "dist")
    ) {
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
      file = path.join(root, "dist/index.html");
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
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
const rooms = new Rooms(wss);
server.on("upgrade", (req, socket, head) => {
  if (req.url === "/ws") {
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
