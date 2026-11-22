import http from "node:http";
import path from "node:path";
import os from "node:os";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { Directory } from "./directory.ts";
import { Gateway } from "./gateway.ts";
import { ReleaseManager } from "./releases.ts";
const root =
  process.env.CONTROL_ROOT ??
  path.join(os.homedir(), ".local/share/doodlescreed");
mkdirSync(root, { recursive: true });
const secretFile = path.join(root, "control.secret");
if (!existsSync(secretFile))
  writeFileSync(secretFile, randomBytes(32).toString("hex"), { mode: 0o600 });
const secret =
  process.env.CONTROL_SECRET ?? readFileSync(secretFile, "utf8").trim();
const port = Number(process.env.CONTROL_PORT ?? 4180);
const releases = process.env.RELEASE_ROOT ?? path.join(root, "releases");
const db = new Directory(path.join(root, "directory.sqlite"));
const gateway = new Gateway(
  root,
  releases,
  Number(process.env.GATEWAY_PORT ?? 4173),
  port,
  process.env.NGINX_BIN ??
    path.join(os.homedir(), ".local/lib/doodlescreed-nginx/usr/sbin/nginx"),
);
const manager = new ReleaseManager(
  db,
  gateway,
  root,
  releases,
  secret,
  process.env.SUPERVISOR ?? "systemd",
);
const respond = (res: http.ServerResponse, status: number, value: unknown) => {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(value));
};
const same = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
async function body(req: http.IncomingMessage) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 4096) throw Error("Request too large");
  }
  return JSON.parse(raw || "{}");
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (url.pathname.startsWith("/internal/")) {
      if (!same(req.headers.authorization ?? "", `Bearer ${secret}`)) {
        respond(res, 403, { error: "Forbidden" });
        return;
      }
      if (url.pathname === "/internal/status") {
        respond(res, 200, manager.status());
        return;
      }
      if (req.method !== "POST") {
        respond(res, 405, { error: "POST required" });
        return;
      }
      const data = await body(req);
      let result: unknown;
      switch (url.pathname) {
        case "/internal/prepare":
          result = await manager.prepare(String(data.releaseId));
          break;
        case "/internal/validate":
          result = await manager.validate(
            String(data.releaseId),
            String(data.workerId),
            data.report,
          );
          break;
        case "/internal/promote":
          result = await manager.promote(
            String(data.releaseId),
            data.expectedCurrent ?? null,
            String(data.deploymentId),
          );
          break;
        case "/internal/allocate":
          result = await manager.allocate(data, String(data.workerId));
          break;
        case "/internal/retire": {
          const w = db.worker(String(data.workerId));
          if (!w) throw Error("Unknown worker");
          result = { retired: await manager.retire(w) };
          break;
        }
        case "/internal/gc":
          result = { removed: await manager.gc() };
          break;
        default:
          respond(res, 404, { error: "Not found" });
          return;
      }
      respond(res, 200, result);
      return;
    }
    if (req.method === "POST") {
      if (
        req.headers.origin &&
        new URL(req.headers.origin).host !== req.headers.host
      ) {
        respond(res, 403, { error: "Origin mismatch" });
        return;
      }
      if (url.pathname === "/api/matches") {
        respond(res, 200, await manager.allocate(await body(req)));
        return;
      }
    }
    if (url.pathname === "/health") {
      const workers = db.workers().filter((w) => w.state === "RUNNING");
      respond(res, 200, {
        ok: workers.some(
          (w) => w.releaseId === db.current() && Date.now() - w.seen < 30000,
        ),
        game: "doodlesCreed",
        level: "rust",
        releaseId: db.current(),
        rooms: (
          db.db.prepare("SELECT count(*) AS n FROM rooms").get() as {
            n: number;
          }
        ).n,
        workers: workers.length,
      });
      return;
    }
    if (url.pathname === "/api/release") {
      respond(res, 200, {
        releaseId: db.current(),
        clientUrl: db.current() ? `/releases/${db.current()}/` : null,
      });
      return;
    }
    if (url.pathname === "/lobbies" || url.pathname === "/api/lobbies") {
      const rows = db.db.prepare("SELECT * FROM rooms").all() as any[];
      respond(res, 200, {
        lobbies: rows
          .map((r) => ({
            ...JSON.parse(r.metadata),
            code: r.code,
            releaseId: r.releaseId,
            mode: JSON.parse(r.metadata).duel ? "duel" : "play",
          }))
          .filter((r) => r.public || r.duel),
      });
      return;
    }
    if (url.pathname.startsWith("/api/matches/")) {
      const code = decodeURIComponent(
        url.pathname.slice("/api/matches/".length),
      ).toUpperCase();
      const r = db.db
        .prepare("SELECT * FROM rooms WHERE code=?")
        .get(code) as any;
      if (!r) {
        respond(res, 404, { error: "That match has ended" });
        return;
      }
      respond(res, 200, {
        ...JSON.parse(r.metadata),
        roomId: r.id,
        code: r.code,
        releaseId: r.releaseId,
        clientUrl: `/releases/${r.releaseId}/`,
        wsUrl: `/ws/${r.workerId}`,
      });
      return;
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const id = db.current();
      if (!id) {
        respond(res, 503, { error: "No release is ready" });
        return;
      }
      res.writeHead(302, {
        Location: `/releases/${id}/${url.search}`,
        "Cache-Control": "no-store",
      });
      res.end();
      return;
    }
    respond(res, 404, { error: "Not found" });
  } catch (e) {
    respond(res, 400, {
      error: e instanceof Error ? e.message : "Request failed",
    });
  }
});
// Reconcile before opening allocation endpoints after restart.
for (const w of db.workers().filter((w) => w.state === "RUNNING")) {
  try {
    await manager.refresh(w);
  } catch {
    if (manager.isGone(w)) {
      db.db.prepare("UPDATE workers SET state='LOST' WHERE id=?").run(w.id);
      db.db.prepare("DELETE FROM rooms WHERE workerId=?").run(w.id);
    }
  }
}
// A host reboot loses old sessions, but may start a fresh worker for the last validated current release.
const current = db.current();
if (
  current &&
  !db.workers().some((w) => w.releaseId === current && w.state === "RUNNING")
) {
  await manager
    .prepare(current)
    .catch((e) => console.error("Current worker recovery failed:", e.message));
}
gateway.update(db.workers());
server.listen(port, "127.0.0.1", () =>
  console.log(`Release control on ${port}`),
);
const timer = setInterval(
  () =>
    manager
      .sweep()
      .catch((e) => console.error("Release reconciliation:", e.message)),
  5000,
);
for (const sig of ["SIGINT", "SIGTERM"] as const)
  process.on(sig, () => {
    clearInterval(timer);
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
