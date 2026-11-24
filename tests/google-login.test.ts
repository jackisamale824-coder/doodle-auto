import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { generateKeyPair, SignJWT } from "jose";
import { GoogleAuth } from "../server/google-auth.ts";
import { openPlayerStore, PlayerAccounts } from "../server/player-accounts.ts";

test("verified Google identities create, return to, and explicitly link player profiles", async () => {
  process.env.PLAYER_DB = ":memory:";
  const keys = await generateKeyPair("RS256");
  const audience = "example.apps.googleusercontent.com";
  const store = await openPlayerStore();
  const accounts = new PlayerAccounts(
    store,
    new GoogleAuth(audience, async () => keys.publicKey),
  );
  const server = createServer((req, res) => void accounts.handle(req, res));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const addr = server.address();
  assert.ok(addr && typeof addr === "object");
  const base = "http://127.0.0.1:" + addr.port;
  const post = (route: string, data: object, cookie = "") =>
    fetch(base + "/api/player/" + route, {
      method: "POST",
      headers: { origin: base, "content-type": "application/json", cookie },
      body: JSON.stringify(data),
    });
  const profile = async (cookie: string) =>
    (
      await (
        await fetch(base + "/api/player/profile", { headers: { cookie } })
      ).json()
    ).profile;
  const cookieOf = (response: Response) =>
    response.headers.getSetCookie()[0].split(";")[0];
  async function challenge(cookie = "") {
    const intent = cookie ? "link" : "login";
    const response = await post("google/challenge", { intent }, cookie);
    assert.equal(response.status, 200);
    const { nonce, clientId } = await response.json();
    assert.equal(clientId, audience);
    return {
      intent,
      nonce,
      cookie: [cookie, cookieOf(response)].filter(Boolean).join("; "),
    };
  }
  async function credential(
    subject: string,
    nonce: string,
    aud = audience,
    key = keys.privateKey,
  ) {
    return new SignJWT({ nonce })
      .setProtectedHeader({ alg: "RS256" })
      .setSubject(subject)
      .setAudience(aud)
      .setIssuer("https://accounts.google.com")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(key);
  }
  async function google(subject: string, cookie = "") {
    const c = await challenge(cookie);
    return post(
      "google",
      { intent: c.intent, credential: await credential(subject, c.nonce) },
      c.cookie,
    );
  }
  try {
    const c = await challenge();
    const submit = (token: string) =>
      post("google", { intent: "login", credential: token }, c.cookie);
    assert.equal(
      (await submit(await credential("alpha", c.nonce, "other-app"))).status,
      401,
    );
    assert.equal(
      (await submit(await credential("alpha", "other-browser"))).status,
      401,
    );
    const wrongKey = await generateKeyPair("RS256");
    assert.equal(
      (
        await submit(
          await credential("alpha", c.nonce, audience, wrongKey.privateKey),
        )
      ).status,
      401,
    );
    const token = await credential("alpha", c.nonce);
    const first = await submit(token);
    assert.equal(first.status, 200);
    assert.equal((await submit(token)).status, 401);
    const p = await profile(cookieOf(first));
    assert.equal(p.googleLinked, true);
    assert.equal(p.rating, 1000);
    const returning = await google("alpha");
    assert.equal((await profile(cookieOf(returning))).name, p.name);
    const password = "local test password";
    const registered = await post("register", { name: "InkRunner", password });
    const local = cookieOf(registered);
    const player = await store({ op: "credential", name: "InkRunner" });
    assert.ok(player);
    await store({
      op: "metrics",
      batch: {
        sessions: [
          {
            id: "demo",
            player: player.id,
            map: "rust",
            mode: "public",
            started: 1000,
            seen: 4000,
            kills: 2,
            deaths: 1,
          },
        ],
        results: [],
      },
    });
    assert.equal((await google("alpha", local)).status, 409);
    const linked = await google("bravo", local);
    assert.equal(linked.status, 200);
    const signedIn = await google("bravo");
    const same = await profile(cookieOf(signedIn));
    assert.equal(same.name, "InkRunner");
    assert.equal(same.lifetime.kills, 2);
    assert.equal((await google("charlie", local)).status, 409);
    assert.equal(
      (await post("login", { name: "InkRunner", password })).status,
      200,
    );
    assert.equal(
      (await post("google/challenge", { intent: "link" })).status,
      409,
    );
  } finally {
    server.close();
    server.closeAllConnections();
  }
});
