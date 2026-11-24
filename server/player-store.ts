export interface Identity {
  id: string;
  name: string;
  rating: number;
}
export interface PlaySession {
  id: string;
  player: string;
  mode: string;
  map: string;
  started: number;
  seen: number;
  kills: number;
  deaths: number;
}
export interface DuelResult {
  room: string;
  winner: string;
  loser: string;
}
export interface MetricsBatch {
  sessions: PlaySession[];
  results: DuelResult[];
}
type SessionRatings = Record<string, number>;
export interface Totals {
  sessions: number;
  kills: number;
  deaths: number;
  seconds: number;
}
export interface Profile {
  googleLinked: boolean;
  name: string;
  rating: number;
  wins: number;
  losses: number;
  lifetime: Totals;
  global: Totals;
  recent: (PlaySession & { delta: number | null })[];
}
type Credential = Pick<Identity, "id" | "name"> & {
  salt: string;
  hash: string;
};
export type StoreCommand =
  | { op: "create"; account: Credential; token: string; expires: number }
  | { op: "credential"; name: string }
  | {
      op: "google";
      subject: string;
      nonce: string;
      linkToken: string | null;
      token: string;
      expires: number;
    }
  | { op: "login"; player: string; token: string; expires: number }
  | { op: "logout" | "identity"; token: string }
  | { op: "profile"; player: string }
  | { op: "metrics"; batch: MetricsBatch };
export type StoreResult<C extends StoreCommand> = C["op"] extends "google"
  ? "ok" | "conflict" | "expired"
  : C["op"] extends "metrics"
    ? SessionRatings | null
    : C["op"] extends "credential"
      ? Credential | null
      : C["op"] extends "identity"
        ? Identity | null
        : C["op"] extends "profile"
          ? Profile
          : C["op"] extends "create"
            ? boolean
            : null;
export type PlayerStore = <C extends StoreCommand>(
  command: C,
) => Promise<StoreResult<C>>;
type Value = string | number | null;
export interface PlayerSql {
  rows<T>(query: string, ...args: Value[]): T[];
  atomic<T>(fn: () => T): T;
}
export const schema = [
  `CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY, name TEXT COLLATE NOCASE UNIQUE NOT NULL,
    salt TEXT NOT NULL, hash TEXT NOT NULL, rating INTEGER NOT NULL DEFAULT 1000,
    wins INTEGER NOT NULL DEFAULT 0, losses INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS logins (token TEXT PRIMARY KEY, player TEXT NOT NULL REFERENCES players(id), expires INTEGER NOT NULL)`,
  "CREATE INDEX IF NOT EXISTS login_expiry ON logins(expires)",
  "CREATE TABLE IF NOT EXISTS google_identities (subject TEXT PRIMARY KEY, player TEXT UNIQUE NOT NULL REFERENCES players(id))",
  "CREATE TABLE IF NOT EXISTS google_nonces (nonce TEXT PRIMARY KEY, expires INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS google_nonce_expiry ON google_nonces(expires)",
  `CREATE TABLE IF NOT EXISTS play_sessions (
    id TEXT PRIMARY KEY, player TEXT NOT NULL REFERENCES players(id), mode TEXT NOT NULL, map TEXT NOT NULL,
    started INTEGER NOT NULL, seen INTEGER NOT NULL, kills INTEGER NOT NULL, deaths INTEGER NOT NULL, delta INTEGER)`,
  "CREATE INDEX IF NOT EXISTS player_history ON play_sessions(player, started DESC)",
  "CREATE TABLE IF NOT EXISTS rated_duels (room TEXT PRIMARY KEY, winner TEXT NOT NULL REFERENCES play_sessions(id), loser TEXT NOT NULL REFERENCES play_sessions(id), delta INTEGER NOT NULL)",
];
const totals = `SELECT count(*) AS sessions, coalesce(sum(kills),0) AS kills,
  coalesce(sum(deaths),0) AS deaths, CAST(coalesce(sum(seen-started),0)/1000 AS INTEGER) AS seconds FROM play_sessions`;

function rate(db: PlayerSql, match: DuelResult) {
  if (db.rows("SELECT 1 FROM rated_duels WHERE room=?", match.room).length)
    return;
  const entrant = (id: string) =>
    db.rows<{ player: string; rating: number }>(
      "SELECT s.player,p.rating FROM play_sessions s JOIN players p ON p.id=s.player WHERE s.id=? AND s.mode='duel'",
      id,
    )[0];
  const winner = entrant(match.winner),
    loser = entrant(match.loser);
  if (!winner || !loser) throw Error("Duel session missing");
  if (winner.player === loser.player) return;
  const expected = 1 / (1 + 10 ** ((loser.rating - winner.rating) / 400));
  const delta = Math.round(32 * (1 - expected));
  db.rows(
    "INSERT INTO rated_duels VALUES (?,?,?,?)",
    match.room,
    match.winner,
    match.loser,
    delta,
  );
  db.rows(
    "UPDATE players SET rating=rating+?, wins=wins+1 WHERE id=?",
    delta,
    winner.player,
  );
  db.rows(
    "UPDATE players SET rating=rating-?, losses=losses+1 WHERE id=?",
    delta,
    loser.player,
  );
  db.rows("UPDATE play_sessions SET delta=? WHERE id=?", delta, match.winner);
  db.rows("UPDATE play_sessions SET delta=? WHERE id=?", -delta, match.loser);
}

export function executePlayerCommand(db: PlayerSql, c: StoreCommand) {
  return db.atomic(() => {
    switch (c.op) {
      case "credential":
        return (
          db.rows<Credential>(
            "SELECT id,name,salt,hash FROM players WHERE name=? AND hash<>''",
            c.name,
          )[0] ?? null
        );
      case "identity":
        return (
          db.rows<Identity>(
            "SELECT p.id,p.name,p.rating FROM logins l JOIN players p ON p.id=l.player WHERE l.token=? AND l.expires>?",
            c.token,
            Date.now(),
          )[0] ?? null
        );
      case "create":
      case "login": {
        const id = c.op === "create" ? c.account.id : c.player;
        if (c.op === "create") {
          const a = c.account;
          if (
            !db.rows(
              "INSERT INTO players (id,name,salt,hash) VALUES (?,?,?,?) ON CONFLICT(name) DO NOTHING RETURNING id",
              id,
              a.name,
              a.salt,
              a.hash,
            ).length
          )
            return false;
        }
        db.rows("DELETE FROM logins WHERE expires<=?", Date.now());
        db.rows("INSERT INTO logins VALUES (?,?,?)", c.token, id, c.expires);
        return c.op === "create" ? true : null;
      }
      case "google": {
        const now = Date.now();
        db.rows("DELETE FROM google_nonces WHERE expires<=?", now);
        if (
          !db.rows(
            "INSERT INTO google_nonces VALUES (?,?) ON CONFLICT DO NOTHING RETURNING nonce",
            c.nonce,
            now + 600_000,
          ).length
        )
          return "expired";
        const existing = db.rows<{ player: string }>(
          "SELECT player FROM google_identities WHERE subject=?",
          c.subject,
        )[0];
        let player = existing?.player;
        if (c.linkToken) {
          const session = db.rows<{ player: string }>(
            "SELECT player FROM logins WHERE token=? AND expires>?",
            c.linkToken,
            now,
          )[0];
          if (!session) return "expired";
          if (
            (existing && player !== session.player) ||
            (!existing &&
              db.rows(
                "SELECT 1 FROM google_identities WHERE player=?",
                session.player,
              ).length)
          )
            return "conflict";
          player = session.player;
        }
        if (!player) {
          // The hyphen reserves these public aliases for Google-created profiles.
          do {
            player = crypto.randomUUID();
          } while (
            !db.rows(
              "INSERT INTO players (id,name,salt,hash) VALUES (?,?,'','') ON CONFLICT DO NOTHING RETURNING id",
              player,
              "Racer-" + player.replaceAll("-", "").slice(0, 10),
            ).length
          );
        }
        if (!existing)
          db.rows(
            "INSERT INTO google_identities VALUES (?,?)",
            c.subject,
            player,
          );
        db.rows("DELETE FROM logins WHERE expires<=?", now);
        db.rows(
          "INSERT INTO logins VALUES (?,?,?)",
          c.token,
          player,
          c.expires,
        );
        return "ok";
      }
      case "logout":
        db.rows("DELETE FROM logins WHERE token=?", c.token);
        return null;
      case "metrics":
        for (const s of c.batch.sessions) {
          db.rows(
            `INSERT INTO play_sessions (id,player,mode,map,started,seen,kills,deaths) VALUES (?,?,?,?,?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET seen=max(seen,excluded.seen),kills=max(kills,excluded.kills),deaths=max(deaths,excluded.deaths)`,
            s.id,
            s.player,
            s.mode,
            s.map,
            s.started,
            s.seen,
            s.kills,
            s.deaths,
          );
        }
        if (!c.batch.results.length) return null;
        const ratings: SessionRatings = {};
        for (const result of c.batch.results) {
          rate(db, result);
          for (const row of db.rows<{ id: string; rating: number }>(
            "SELECT s.id,p.rating FROM play_sessions s JOIN players p ON p.id=s.player WHERE s.id IN (?,?)",
            result.winner,
            result.loser,
          ))
            ratings[row.id] = row.rating;
        }
        return ratings;
      case "profile": {
        const player = db.rows<
          Pick<Profile, "name" | "rating" | "wins" | "losses">
        >(
          "SELECT name,rating,wins,losses FROM players WHERE id=?",
          c.player,
        )[0];
        if (!player) throw Error("Unknown player");
        return {
          ...player,
          googleLinked: !!db.rows(
            "SELECT 1 FROM google_identities WHERE player=?",
            c.player,
          ).length,
          lifetime: db.rows<Totals>(totals + " WHERE player=?", c.player)[0],
          global: db.rows<Totals>(totals)[0],
          recent: db.rows<Profile["recent"][number]>(
            "SELECT * FROM play_sessions WHERE player=? ORDER BY started DESC LIMIT 10",
            c.player,
          ),
        } satisfies Profile;
      }
    }
  });
}
