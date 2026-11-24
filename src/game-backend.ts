// Each attempt obtains a fresh Durable Object stub. A disconnected stub stays broken.
export async function fetchGameBackend(
  request: Request,
  forward: (request: Request) => Promise<Response>,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  const retry =
    request.method === "GET" &&
    request.body === null &&
    ["/lobbies", "/api/player/profile", "/health", "/ws", "/ws/county", "/ws/islands", "/pool/ws"].includes(
      path,
    );
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await forward(request);
      if (
        !retry ||
        attempt > 0 ||
        ![500, 502, 503, 504].includes(response.status)
      )
        return response;
      await response.body?.cancel();
    } catch (error) {
      console.warn(
        "Game backend unavailable",
        request.method,
        path,
        error instanceof Error ? error.message : "transport failure",
      );
      if (
        !retry ||
        attempt > 0 ||
        (error as { overloaded?: boolean } | null)?.overloaded
      )
        return new Response("Game server temporarily unavailable", {
          status: 503,
          headers: { "Retry-After": "2", "Cache-Control": "no-store" },
        });
    }
    await new Promise((resolve) =>
      setTimeout(resolve, 250 + Math.random() * 250),
    );
  }
}
