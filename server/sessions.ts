import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
const hash = (secret: string) =>
  createHash("sha256").update(secret).digest("hex");
export interface Session {
  id: string;
  socket: WebSocket;
  secretHash: string;
  expiresAt: number;
  retry?: { attemptId: string; oldHash: string; secret: string; until: number };
}
export class Sessions {
  readonly records = new Map<string, Session>();
  private sockets = new WeakMap<WebSocket, Session>();
  constructor(readonly resumeMs = 90_000) {}
  create(socket: WebSocket) {
    const secret = randomBytes(32).toString("base64url");
    const session: Session = {
      id: randomUUID(),
      socket,
      secretHash: hash(secret),
      expiresAt: Infinity,
    };
    this.attach(session, socket);
    return { session, secret };
  }
  bySocket(socket: WebSocket) {
    return this.sockets.get(socket);
  }
  attach(session: Session, socket: WebSocket) {
    this.sockets.delete(session.socket);
    session.socket = socket;
    this.sockets.set(socket, session);
    this.records.set(session.id, session);
  }
  remove(socket: WebSocket) {
    const s = this.sockets.get(socket);
    if (s) this.records.delete(s.id);
    this.sockets.delete(socket);
  }
  detach(socket: WebSocket) {
    const s = this.bySocket(socket);
    if (s && s.expiresAt === Infinity) s.expiresAt = Date.now() + this.resumeMs;
  }
  resume(id: unknown, secret: unknown, attemptId: unknown) {
    if (
      typeof id !== "string" ||
      typeof secret !== "string" ||
      typeof attemptId !== "string" ||
      !attemptId ||
      attemptId.length > 128
    )
      return;
    const session = this.records.get(id);
    if (!session || session.expiresAt <= Date.now()) return;
    const digest = hash(secret),
      retry = session.retry;
    if (
      retry &&
      retry.until > Date.now() &&
      retry.attemptId === attemptId &&
      (digest === retry.oldHash || digest === session.secretHash)
    )
      return { session, secret: retry.secret };
    if (digest !== session.secretHash) return;
    const next = randomBytes(32).toString("base64url");
    session.retry = {
      attemptId,
      oldHash: digest,
      secret: next,
      until: Date.now() + 15_000,
    };
    session.secretHash = hash(next);
    return { session, secret: next };
  }
}
