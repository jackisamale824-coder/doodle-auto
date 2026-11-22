import { randomBytes } from "node:crypto";
export interface Reservation {
  roomId: string;
  code: string;
  name: string;
  expiresAt: number;
  joinTicket: string;
}
/** Worker-local capabilities: process restarts invalidate every outstanding ticket. */
export class Admissions {
  readonly tickets = new Map<string, Reservation>();
  issue(roomId: string, code: string, name: string): Reservation {
    const reservation = {
      roomId,
      code,
      name,
      expiresAt: Date.now() + 30_000,
      joinTicket: randomBytes(32).toString("base64url"),
    };
    this.tickets.set(reservation.joinTicket, reservation);
    return reservation;
  }
  prune() {
    for (const [key, value] of this.tickets)
      if (value.expiresAt <= Date.now()) this.tickets.delete(key);
  }
  consume(ticket: unknown) {
    this.prune();
    if (typeof ticket !== "string") return;
    const value = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    return value;
  }
  count(roomId?: string) {
    this.prune();
    return [...this.tickets.values()].filter(
      (r) => !roomId || r.roomId === roomId,
    ).length;
  }
}
