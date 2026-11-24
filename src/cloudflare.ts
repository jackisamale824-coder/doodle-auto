import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import {
  executePlayerCommand,
  schema,
  type PlayerSql,
  type StoreCommand,
} from "../server/player-store.ts";

const PORT = 4173;
const INACTIVITY_TIMEOUT_MS = 2 * 60 * 1000;

// Only the container's outbound intercept can invoke this entrypoint.
export class PlayerDatabase extends WorkerEntrypoint<Env> {
  async fetch(request: Request) {
    if (
      request.method === "GET" &&
      new URL(request.url).pathname === "/google-keys"
    )
      return fetch("https://www.googleapis.com/oauth2/v3/certs");
    const command = await request.json<StoreCommand>();
    const result =
      await this.ctx.exports.GameContainer.getByName(
        "player-database",
      ).playerCommand(command);
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
    return this.ctx.container!.getTcpPort(PORT).fetch(forwarded);
  }

  private async startAndWaitForPort(): Promise<void> {
    const container = this.ctx.container!;
    if (container.running && this.ready) {
      await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
      return;
    }

    await container.interceptOutboundHttp(
      "players.internal",
      this.ctx.exports.PlayerDatabase,
    );
    if (!container.running) {
      container.start({
        image: container.images.base,
        instance: "lite",
        enableInternet: false,
        env: {
          PLAYER_STORE_URL: "http://players.internal",
          GOOGLE_CLIENT_ID: this.env.GOOGLE_CLIENT_ID,
        },
      });
    }

    await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
    const port = container.getTcpPort(PORT);
    let lastError: unknown;

    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const response = await port.fetch("http://container/health", {
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
  fetch(request: Request, _env: Env, ctx: ExecutionContext): Promise<Response> {
    return ctx.exports.GameContainer.getByName("shared-game-server").fetch(
      request,
    );
  },
} satisfies ExportedHandler<Env>;
