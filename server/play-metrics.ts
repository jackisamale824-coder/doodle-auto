import type { PlayerState } from "./rooms.ts";
import type {
  Identity,
  PlaySession,
  DuelResult,
  PlayerStore,
} from "./player-store.ts";
export class PlayMetrics {
  readonly identities = new WeakMap<object, Identity>();
  private sessions = new WeakMap<PlayerState, PlaySession>();
  private pending = new Map<string, PlaySession>();
  private results = new Map<
    string,
    { result: DuelResult; rated: (ratings: Record<string, number>) => void }
  >();
  private flushing?: Promise<void>;
  constructor(private store: PlayerStore) {}
  join(socket: object, player: PlayerState, mode: string, map: string) {
    const user = this.identities.get(socket);
    if (!user) return;
    const now = Date.now();
    this.sessions.set(player, {
      id: player.id,
      player: user.id,
      mode,
      map,
      started: now,
      seen: now,
      kills: 0,
      deaths: 0,
    });
    this.record(player);
  }
  record(player: PlayerState) {
    const session = this.sessions.get(player);
    if (!session) return;
    Object.assign(session, {
      seen: Math.max(session.seen, Date.now()),
      kills: player.kills,
      deaths: player.deaths,
    });
    this.pending.set(session.id, { ...session });
  }
  finish(
    room: string,
    winner: PlayerState,
    loser: PlayerState,
    refreshRoster: () => void,
  ) {
    const a = this.sessions.get(winner),
      b = this.sessions.get(loser);
    if (!a || !b || a.player === b.player) return;
    this.record(winner);
    this.record(loser);
    this.results.set(room, {
      result: { room, winner: a.id, loser: b.id },
      rated: (ratings) => {
        winner.rating = ratings[a.id];
        loser.rating = ratings[b.id];
        refreshRoster();
      },
    });
  }
  flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = this.drain().finally(() => {
      this.flushing = undefined;
    });
    return this.flushing;
  }
  private async drain() {
    while (this.pending.size || this.results.size) {
      const sessions = [...this.pending.values()],
        results = [...this.results.values()];
      try {
        const ratings = await this.store({
          op: "metrics",
          batch: { sessions, results: results.map((r) => r.result) },
        });
        if (ratings) for (const r of results) r.rated(ratings);
      } catch {
        console.error("Player metrics checkpoint failed; will retry.");
        return;
      }
      for (const s of sessions)
        if (this.pending.get(s.id) === s) this.pending.delete(s.id);
      for (const r of results) this.results.delete(r.result.room);
    }
  }
}
