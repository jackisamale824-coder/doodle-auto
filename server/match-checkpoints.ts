import { randomUUID } from "node:crypto";
import type { PlayerStore } from "./player-store.ts";

// One in-flight write per simulation. Joins in the same turn share a transaction.
export class MatchCheckpoints {
  private owner = randomUUID();
  private revision = 0;
  private dirty = new Set<string>();
  private pending?: Promise<void>;
  private tail = Promise.resolve();
  constructor(
    private store: PlayerStore,
    private snapshot: (code: string) => string | null,
  ) {}
  open() {
    return this.store({ op: "open-matches", owner: this.owner });
  }
  save(codes: Iterable<string>): Promise<void> {
    for (const code of codes) this.dirty.add(code);
    if (this.pending) return this.pending;
    if (!this.dirty.size) return this.tail;
    const write = this.tail.then(async () => {
      this.pending = undefined;
      const batch = [...this.dirty];
      this.dirty.clear();
      try {
        const rooms = batch.map((code) => ({
          code,
          data: this.snapshot(code),
        }));
        await this.store({
          op: "save-matches",
          owner: this.owner,
          revision: ++this.revision,
          rooms,
        });
      } catch (error) {
        for (const code of batch) this.dirty.add(code);
        throw error;
      }
    });
    this.pending = write;
    this.tail = write.catch(() => {});
    return write;
  }
}
