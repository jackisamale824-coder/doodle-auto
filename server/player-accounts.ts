import {
  randomBytes,
  randomUUID,
  createHash,
  scrypt,
  timingSafeEqual,
} from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { GoogleAuth } from "./google-auth.ts";
import {
  executePlayerCommand,
  schema,
  type PlayerSql,
  type PlayerStore,
  type StoreResult,
} from "./player-store.ts";

export async function openPlayerStore(): Promise<PlayerStore> {
  const endpoint = process.env.PLAYER_STORE_URL;
  if (endpoint)
    return async (command) => {
      const response = await fetch(endpoint, {
        method: "POST",
        body: JSON.stringify(command),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw Error("Player database unavailable");
      return (await response.json()) as StoreResult<typeof command>;
    };
  const { DatabaseSync } = await import("node:sqlite");
  const filename =
    process.env.PLAYER_DB ||
    path.join(homedir(), ".doodle-auto", "players.sqlite");
  mkdirSync(path.dirname(filename), { recursive: true });
  const sqlite = new DatabaseSync(filename);
  sqlite.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000");
  for (const statement of schema) sqlite.exec(statement);
  const db: PlayerSql = {
    rows<T>(query: string, ...args: (string | number | null)[]) {
      return sqlite.prepare(query).all(...args) as T[];
    },
    atomic(fn) {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const value = fn();
        sqlite.exec("COMMIT");
        return value;
      } catch (err) {
        sqlite.exec("ROLLBACK");
        throw err;
      }
    },
  };
  return async (command) =>
    executePlayerCommand(db, command) as StoreResult<typeof command>;
}

const lifetime = 30 * 24 * 3600;
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const tokenFrom = (req: IncomingMessage) =>
  req.headers.cookie?.match(
    /(?:^|;\s*)doodle_session=([a-f0-9]{64})(?:;|$)/,
  )?.[1];
function derive(password: string, salt: string) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(
      password,
      Buffer.from(salt, "hex"),
      32,
      { N: 65536, r: 8, p: 1, maxmem: 96 * 1024 * 1024 },
      (err, key) => (err ? reject(err) : resolve(key)),
    ),
  );
}
export class PlayerAccounts {
  private attempts = new Map<string, { count: number; until: number }>();
  private hashing = 0;
  constructor(
    private store: PlayerStore,
    private google = process.env.GOOGLE_CLIENT_ID
      ? new GoogleAuth(process.env.GOOGLE_CLIENT_ID)
      : undefined,
  ) {}
  async identity(req: IncomingMessage) {
    const token = tokenFrom(req);
    return token ? this.store({ op: "identity", token: digest(token) }) : null;
  }
  private allow(ip: string) {
    const now = Date.now();
    for (const [key, bucket] of this.attempts)
      if (bucket.until <= now) this.attempts.delete(key);
    const bucket = this.attempts.get(ip) ?? {
      count: 0,
      until: now + 10 * 60_000,
    };
    this.attempts.set(ip, bucket);
    return ++bucket.count <= 20 && this.hashing < 4;
  }
  async handle(req: IncomingMessage, res: ServerResponse) {
    const action = req.url?.split("?")[0];
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");
    const reply = (status: number, body: unknown) => {
      res.writeHead(status);
      res.end(JSON.stringify(body));
    };
    const fail = (code: number, error: string) => reply(code, { error });
    try {
      if (req.method === "GET" && action === "/api/player/profile") {
        const player = await this.identity(req);
        return reply(200, {
          googleEnabled: !!this.google,
          profile: player
            ? await this.store({ op: "profile", player: player.id })
            : null,
        });
      }
      if (
        ![
          "/api/player/login",
          "/api/player/register",
          "/api/player/logout",
          "/api/player/google/challenge",
          "/api/player/google",
        ].includes(action ?? "")
      )
        return fail(404, "Unknown player option.");
      if (req.method !== "POST") return fail(405, "Use POST.");
      const cloud = !!process.env.PLAYER_STORE_URL;
      const host = cloud
        ? req.headers["x-doodle-public-host"]
        : req.headers.host;
      const origin = req.headers.origin;
      if (
        origin &&
        origin !== "https://" + host &&
        (cloud || origin !== "http://" + host)
      )
        return fail(403, "Open the game to manage your account.");
      if (req.headers["content-type"]?.split(";")[0] !== "application/json")
        return fail(415, "Send a JSON request.");
      const secure =
        cloud || process.env.NODE_ENV === "production" ? "; Secure" : "";
      const cookie = (token: string, age: number) =>
        res.setHeader(
          "Set-Cookie",
          `doodle_session=${token}; Max-Age=${age}; Path=/; HttpOnly; SameSite=Lax${secure}`,
        );
      if (action === "/api/player/logout") {
        const token = tokenFrom(req);
        if (token) await this.store({ op: "logout", token: digest(token) });
        cookie("", 0);
        return reply(200, { ok: true });
      }
      const ip = String(
        (cloud && req.headers["x-doodle-client-ip"]) ||
          req.socket.remoteAddress ||
          "local",
      );
      const googleRequest = action?.startsWith("/api/player/google");
      if (googleRequest && !this.google)
        return fail(503, "Google sign-in is unavailable.");
      if (googleRequest && !origin)
        return fail(403, "Open the game to use Google sign-in.");
      let size = 0;
      const parts: Buffer[] = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > (googleRequest ? 16384 : 2048))
          return fail(413, "Account details are too long.");
        parts.push(chunk);
      }
      let data;
      try {
        data = JSON.parse(Buffer.concat(parts).toString("utf8"));
      } catch {
        return fail(400, "Invalid account details.");
      }
      if (googleRequest && this.google) {
        const user = await this.identity(req);
        const linking = data?.intent === "link";
        if ((!linking && data?.intent !== "login") || linking !== !!user)
          return fail(
            409,
            "Your login changed. Reopen Player account to continue.",
          );
        const expected = (secret: string) =>
          digest(secret + ":" + (user?.id ?? "guest"));
        if (action === "/api/player/google/challenge") {
          const secret = randomBytes(32).toString("hex");
          res.setHeader(
            "Set-Cookie",
            `doodle_google=${secret}; Max-Age=600; Path=/api/player/google; HttpOnly; SameSite=Strict${secure}`,
          );
          return reply(200, {
            clientId: this.google.clientId,
            nonce: expected(secret),
          });
        }
        const secret = req.headers.cookie?.match(
          /(?:^|;\s*)doodle_google=([a-f0-9]{64})(?:;|$)/,
        )?.[1];
        if (!secret || typeof data.credential !== "string")
          return fail(401, "Restart Google sign-in and try again.");
        if (!this.allow(ip))
          return fail(429, "Too many attempts. Try again later.");
        const nonce = expected(secret);
        let subject: string;
        try {
          subject = await this.google.subject(data.credential, nonce);
        } catch {
          return fail(
            401,
            "Google sign-in could not be verified. Reopen Player account to try again.",
          );
        }
        const token = randomBytes(32).toString("hex");
        const outcome = await this.store({
          op: "google",
          subject,
          nonce,
          linkToken: user ? digest(tokenFrom(req)!) : null,
          token: digest(token),
          expires: Date.now() + lifetime * 1000,
        });
        if (outcome === "conflict")
          return fail(
            409,
            "This Google account or player profile is already linked.",
          );
        if (outcome !== "ok")
          return fail(
            401,
            "Google sign-in expired. Reopen Player account to try again.",
          );
        cookie(token, lifetime);
        res.appendHeader(
          "Set-Cookie",
          `doodle_google=; Max-Age=0; Path=/api/player/google; HttpOnly; SameSite=Strict${secure}`,
        );
        return reply(200, { ok: true });
      }
      const name = typeof data?.name === "string" ? data.name.trim() : "",
        password = data?.password;
      if (
        !/^[a-z0-9_]{3,16}$/i.test(name) ||
        typeof password !== "string" ||
        password.length < 10 ||
        password.length > 128
      )
        return fail(
          400,
          "Use a 3–16 character username (letters, numbers or underscores) and a 10–128 character password.",
        );
      if (!this.allow(ip))
        return fail(429, "Too many attempts. Try again later.");
      this.hashing++;
      try {
        const token = randomBytes(32).toString("hex"),
          session = {
            token: digest(token),
            expires: Date.now() + lifetime * 1000,
          };
        if (action === "/api/player/register") {
          const salt = randomBytes(16).toString("hex"),
            hash = (await derive(password, salt)).toString("hex");
          if (
            !(await this.store({
              op: "create",
              account: { id: randomUUID(), name, salt, hash },
              ...session,
            }))
          )
            return fail(409, "That username is already taken.");
        } else {
          const user = await this.store({ op: "credential", name });
          const hash = await derive(password, user?.salt ?? "00".repeat(16));
          if (!user || !timingSafeEqual(hash, Buffer.from(user.hash, "hex")))
            return fail(401, "Username or password is incorrect.");
          await this.store({ op: "login", player: user.id, ...session });
        }
        cookie(token, lifetime);
        return reply(200, { ok: true });
      } finally {
        this.hashing--;
      }
    } catch {
      return fail(503, "Player accounts are temporarily unavailable.");
    }
  }
}
