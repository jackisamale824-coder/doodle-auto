import { DurableObject } from "cloudflare:workers";

interface Env {
  GAME: DurableObjectNamespace<GameContainer>;
}

const PORT = 4173;
const INACTIVITY_TIMEOUT_MS = 2 * 60 * 1000;

export class GameContainer extends DurableObject<Env> {
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
    forwarded.headers.delete("host");
    return this.ctx.container!.getTcpPort(PORT).fetch(forwarded);
  }

  private async startAndWaitForPort(): Promise<void> {
    const container = this.ctx.container!;
    if (container.running && this.ready) {
      await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
      return;
    }

    if (!container.running) {
      container.start({
        image: container.images.base,
        instance: "lite",
        enableInternet: false,
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
        if (!response.ok) throw new Error(`Health check returned ${response.status}`);
        this.ready = true;
        return;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    }

    throw new Error("Game container did not become ready", { cause: lastError });
  }
}

export default {
  fetch(_request: Request, env: Env): Promise<Response> {
    return env.GAME.getByName("shared-game-server").fetch(_request);
  },
} satisfies ExportedHandler<Env>;
