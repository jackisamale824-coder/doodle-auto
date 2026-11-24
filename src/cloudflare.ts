import { gameShards, shardNames, type GameShard } from "./game-shards.ts";
import { fetchGameBackend } from "./game-backend.ts";
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import {
  executePlayerCommand,
  schema,
  type PlayerSql,
  type StoreCommand,
} from "../server/player-store.ts";

const PORT = 4173;
const INACTIVITY_TIMEOUT_MS = 2 * 60 * 1000;
const OCCUPIED_TIMEOUT_MS = 15 * 60 * 1000;
const OCCUPANCY_CHECK_MS = 30_000;

// Only the container's outbound intercept can invoke this entrypoint.
export class PlayerDatabase extends WorkerEntrypoint<Env> {
  async fetch(request: Request) {
    if (
      request.method === "GET" &&
      new URL(request.url).pathname === "/google-keys"
    )
      return fetch("https://www.googleapis.com/oauth2/v3/certs");
    const command = await request.json<StoreCommand>();
    const shard = new URL(request.url).pathname.slice(1);
    const matches = command.op === "open-matches" || command.op === "save-matches";
    const database = matches && shardNames.includes(shard as GameShard)
      ? "match-storage-" + shard : "player-database";
    const result = await this.ctx.exports.GameContainer.getByName(database).playerCommand(command);
    return Response.json(result);
  }
}
export class GameContainer extends DurableObject<Env> {
  private schemaReady = false;

  async playerCommand(command: StoreCommand) {
    const storage = this.ctx.storage;
    if (!this.schemaReady) {
      storage.transactionSync(() => {
        for (const statement of schema) storage.sql.exec(statement);
      });
      this.schemaReady = true;
    }
    const db: PlayerSql = {
      rows<T>(query: string, ...args: (string | number | null)[]) {
        return storage.sql.exec(query, ...args).toArray() as T[];
      },
      atomic: (fn) => storage.transactionSync(fn),
    };
    return executePlayerCommand(db, command);
  }
  private starting: Promise<void> | undefined;
  private ready = false;

  async fetch(request: Request): Promise<Response> {
    this.starting ??= this.startAndWaitForPort().finally(() => {
      this.starting = undefined;
    });
    await this.starting;

    const url = new URL(request.url);
    url.protocol = "http:";
    url.host = "container";
    const forwarded = new Request(url, request);
    forwarded.headers.set("x-doodle-public-host", new URL(request.url).host);
    forwarded.headers.set(
      "x-doodle-client-ip",
      request.headers.get("cf-connecting-ip") || "unknown",
    );
    forwarded.headers.delete("host");
    try {
      const response = await this.ctx.container!.getTcpPort(PORT).fetch(forwarded);
      if (response.status === 101 && (await this.ctx.storage.getAlarm()) === null) {
        await this.ctx.container!.setInactivityTimeout(OCCUPIED_TIMEOUT_MS);
        await this.ctx.storage.setAlarm(Date.now() + OCCUPANCY_CHECK_MS);
      }
      if ([502, 503, 504].includes(response.status)) this.ready = false;
      return response;
    } catch (error) {
      this.ready = false;
      throw error;
    }
  }

  // Forwarded WebSocket frames bypass the owning object's fetch handler.
  // Renew its activity while the simulation has open transports, including pool.
  async alarm() {
    const container = this.ctx.container!;
    if (!container.running) return;
    const response = await container.getTcpPort(PORT).fetch("http://container/health", {
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw Error("Unable to check game server occupancy");
    const {connections, rooms} = await response.json<{connections?: number; rooms: number}>();
    const occupied = (connections ?? rooms) > 0;
    await container.setInactivityTimeout(occupied ? OCCUPIED_TIMEOUT_MS : INACTIVITY_TIMEOUT_MS);
    if (occupied) await this.ctx.storage.setAlarm(Date.now() + OCCUPANCY_CHECK_MS);
  }

  private async startAndWaitForPort(): Promise<void> {
    const container = this.ctx.container!;
    if (container.running && this.ready) return;

    this.ready = false;
    await container.interceptOutboundHttp(
      "players.internal",
      this.ctx.exports.PlayerDatabase,
    );
    if (!container.running) {
      const shard = shardNames.find(key =>
        this.ctx.id.equals(this.ctx.exports.GameContainer.idFromName(gameShards[key].name))) ?? "shared";
      container.start({
        image: container.images.base,
        instance: "basic",
        enableInternet: false,
        env: {
          MATCH_RECOVERY: "1",
          ROOM_CODE_PREFIX: gameShards[shard].prefix,
          PLAYER_STORE_URL: "http://players.internal/" + shard,
          GOOGLE_CLIENT_ID: this.env.GOOGLE_CLIENT_ID,
        },
      });
      await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
    }

    const deadline = Date.now() + 15000;
    let lastError: unknown;

    while (container.running && Date.now() < deadline) {
      try {
        const response = await container.getTcpPort(PORT).fetch("http://container/health", {
          signal: AbortSignal.timeout(1000),
        });
        await response.body?.cancel();
        if (!response.ok)
          throw new Error(`Health check returned ${response.status}`);
        this.ready = true;
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    throw new Error("Game container did not become ready", {
      cause: lastError,
    });
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const oldGame = /^\/(pool|drive-mad)(?:\/index\.html|\/)?$/.exec(url.pathname);
    if (oldGame) {
      return Response.redirect(`https://${oldGame[1]}.sully6.com/${url.search}`, 302);
    }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      if (["room", "mode", "level"].some(key => url.searchParams.has(key))) {
        return Response.redirect("https://doodle-auto.sully6.com/" + url.search, 302);
      }
      url.pathname = "/arcade/";
      return env.ASSETS.fetch(new Request(url, request));
    }

    // The Pages game host forwards to this prefix. Restore the public origin
    // before handing account requests or WebSocket upgrades to the game.
    if (url.pathname.startsWith("/play/")) {
      const gamePath = /^\/play\/(doodle-auto|gta|pool|drive-mad)(\/.*)$/.exec(url.pathname);
      if (!gamePath) return new Response("Unknown game", { status: 404 });
      const [, game, path] = gamePath;
      url.hostname = game + ".sully6.com";
      url.pathname = path;
      // Move bookmarks and invites while existing tabs finish their game sessions.
      if (game === "gta" && ["GET", "HEAD"].includes(request.method) &&
          (path === "/" || path === "/index.html" || request.headers.get("Accept")?.includes("text/html"))) {
        url.hostname = "doodle-auto.sully6.com";
        return Response.redirect(url.href, 308);
      }
      if (game === "drive-mad") {
        url.pathname = "/" + game + path;
        return env.ASSETS.fetch(new Request(url, request));
      }
      if (game === "pool" && path === "/") url.pathname = "/pool/";
      request = new Request(url, request);
      const dynamic = path.startsWith("/api/") ||
        ["/ws", "/ws/county", "/ws/islands", "/pool/ws", "/lobbies", "/health"].includes(path);
      if (!dynamic) return env.ASSETS.fetch(request);
    }
    const forward = (shard: GameShard, req: Request) =>
      fetchGameBackend(req, (attempt) =>
        ctx.exports.GameContainer.getByName(gameShards[shard].name).fetch(
          attempt,
        ),
      );
    if (url.pathname === "/lobbies" && request.method === "GET") {
      const selected = url.searchParams.get("shard");
      url.search = "";
      const lobbyRequest = new Request(url, request);
      if (shardNames.includes(selected as GameShard))
        return forward(selected as GameShard, lobbyRequest);
      // Old clients request the combined directory. A map-specific menu only wakes its own server.
      const lists = await Promise.all(
        shardNames.map(async (shard) => {
          const response = await forward(shard, new Request(lobbyRequest));
          if (!response.ok) {
            await response.body?.cancel();
            return null;
          }
          const data = await response
            .json<{ lobbies: unknown[] }>()
            .catch(() => null);
          return Array.isArray(data?.lobbies) ? data.lobbies : null;
        }),
      );
      if (lists.every((list) => list === null))
        return new Response("Lobby directory unavailable", { status: 503 });
      return Response.json(
        { lobbies: lists.flatMap((list) => list ?? []) },
        { headers: { "Cache-Control": "no-store" } },
      );
    }
    const shard =
      shardNames.find((key) => gameShards[key].socket === url.pathname) ??
      "shared";
    return forward(shard, request);
  },
} satisfies ExportedHandler<Env>;
