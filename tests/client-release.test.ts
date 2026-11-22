import test from "node:test";
import assert from "node:assert/strict";
Object.assign(globalThis, { __RELEASE_ID__: "test-a" });
const { Network } = await import("../src/network.ts");

class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  bufferedAmount = 0;
  sent: any[] = [];
  onopen?: () => void;
  onmessage?: (e: any) => void;
  onclose?: () => void;
  constructor(public url: string) {
    Socket.instances.push(this);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
    queueMicrotask(() => this.onclose?.());
  }
  receive(data: any) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}
const storage = new Map<string, string>();
Object.assign(globalThis, {
  WebSocket: Socket,
  location: {
    origin: "https://game.example",
    protocol: "https:",
    host: "game.example",
    search: "",
  },
  sessionStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  },
});

test("release session pins worker, retries lost acknowledgement with identical attempt, and leaves explicitly", async () => {
  const network = new Network();
  const connecting = (network as any).open("/ws/old-worker", {
    type: "admit",
    joinTicket: "ticket",
  });
  const initial = Socket.instances.at(-1)!;
  initial.onopen!();
  initial.receive({
    type: "welcome",
    id: "runner",
    code: "ABCDE",
    sessionId: "session",
    resumeSecret: "first",
  });
  await connecting;
  const events: string[] = [];
  network.onMessage = (m) => events.push(m.type);
  initial.close();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const retry = Socket.instances.at(-1)!;
  retry.onopen!();
  assert.equal(retry.url, "wss://game.example/ws/old-worker");
  assert.equal(retry.sent[0].secret, "first");
  network.send({ type: "fire" });
  assert.equal(retry.sent.length, 1, "no input sent during resume");
  retry.close();
  await new Promise((resolve) => setTimeout(resolve, 350));
  const repeated = Socket.instances.at(-1)!;
  repeated.onopen!();
  assert.deepEqual(
    repeated.sent[0],
    retry.sent[0],
    "lost acknowledgement preserves attempt and secret",
  );
  repeated.receive({
    type: "resumed",
    id: "runner",
    code: "ABCDE",
    sessionId: "session",
    resumeSecret: "rotated",
    hp: 21,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(network.active, true);
  assert.equal(JSON.parse(storage.get("dc.session")!).resumeSecret, "rotated");
  assert.ok(events.includes("reconnecting"));
  network.disconnect();
  assert.equal(repeated.sent.at(-1).type, "leave");
  assert.equal(storage.has("dc.session"), false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(network.active, false);
});

test("worker endpoints cannot select another origin or arbitrary route", async () => {
  const network = new Network();
  await assert.rejects(
    (network as any).open("https://other.example/ws/worker", {}),
    /Invalid match address/,
  );
  await assert.rejects(
    (network as any).open("/api/admin", {}),
    /Invalid match address/,
  );
});

test("new matchmaking carries admission in tab storage before exact-release navigation", async () => {
  let target = "";
  Object.assign(location, {
    replace: (url: string) => {
      target = url;
    },
  });
  Object.assign(globalThis, {
    fetch: async () => ({
      ok: true,
      json: async () => ({
        releaseId: "test-b",
        clientUrl: "/releases/test-b/",
        wsUrl: "/ws/new-worker",
        joinTicket: "private-ticket",
      }),
    }),
  });
  const before = Socket.instances.length;
  const network = new Network();
  void network.connect("public", "Runner", "", "");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(target, "https://game.example/releases/test-b/");
  assert.equal(target.includes("private-ticket"), false);
  assert.equal(
    JSON.parse(storage.get("dc.pendingAdmission")!).joinTicket,
    "private-ticket",
  );
  assert.equal(
    Socket.instances.length,
    before,
    "old build does not admit to new simulation",
  );
  storage.clear();
});

test("old-room invitation selects retained client before admission", async () => {
  let target = "";
  Object.assign(location, {
    search: "?room=ABCDE",
    replace: (url: string) => {
      target = url;
    },
  });
  Object.assign(globalThis, {
    fetch: async () => ({
      ok: true,
      json: async () => ({ releaseId: "retained-a" }),
    }),
  });
  const network = new Network();
  void network.bootstrap();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(target, "https://game.example/releases/retained-a/?room=ABCDE");
  Object.assign(location, { search: "" });
});
