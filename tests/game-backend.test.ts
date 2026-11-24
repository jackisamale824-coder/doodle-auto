import test from "node:test";
import assert from "node:assert/strict";
import { fetchGameBackend } from "../src/game-backend.ts";

const origin = "https://gta.sully6.com";

test("connection reads and upgrades recover from a single failed backend attempt", async () => {
  await Promise.all(
    ["/lobbies", "/api/player/profile", "/ws"].map(async (path) => {
      const request = new Request(origin + path, {
        headers:
          path === "/ws"
            ? { Upgrade: "websocket", Origin: origin }
            : { Cookie: "session=test" },
      });
      const success = new Response("connected");
      let calls = 0;
      const result = await fetchGameBackend(request, async (received) => {
        assert.equal(received, request);
        if (++calls === 1) {
          if (path === "/ws") throw Error("Connection lost");
          return new Response(null, { status: 500 });
        }
        return success;
      });
      assert.equal(result, success);
      assert.equal(calls, 2);
    }),
  );
});

test("account writes, rejected upgrades and overloaded objects are never replayed", async () => {
  const cases = [
    { path: "/api/player/profile", method: "POST", status: 500 },
    { path: "/ws", method: "GET", status: 403 },
    { path: "/lobbies", method: "GET", status: 503, overloaded: true },
  ];
  for (const item of cases) {
    let calls = 0;
    const result = await fetchGameBackend(
      new Request(origin + item.path, { method: item.method }),
      async () => {
        calls++;
        if (item.overloaded)
          throw Object.assign(Error("busy"), { overloaded: true });
        return new Response(null, { status: item.status });
      },
    );
    assert.equal(result.status, item.status);
    assert.equal(calls, 1);
  }
});

test("a persistent transport outage returns a bounded retryable error", async () => {
  let calls = 0;
  const result = await fetchGameBackend(
    new Request(origin + "/lobbies"),
    async () => {
      calls++;
      throw Error("not ready");
    },
  );
  assert.equal(calls, 2);
  assert.equal(result.status, 503);
  assert.ok(result.headers.has("Retry-After"));
});
