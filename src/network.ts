import type { V3 } from "./world.ts";
export interface RemoteState {
  id: string;
  name: string;
  p: V3;
  yaw: number;
  pitch: number;
  hp: number;
  kills: number;
  deaths: number;
  weapon: number;
  height: number;
  anchor: V3 | null;
}
export class Network {
  socket: WebSocket | null = null;
  id = "";
  code = "";
  active = false;
  players: RemoteState[] = [];
  onMessage: (m: any) => void = () => {};
  async connect(
    type: "create" | "join",
    name: string,
    seed: string,
    code: string,
  ) {
    this.disconnect();
    return new Promise<any>((resolve, reject) => {
      const ws = new WebSocket(
        `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`,
      );
      this.socket = ws;
      let done = false;
      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          ws.close();
          reject(
            Error("Connection timed out. Check the server and try again."),
          );
        }
      }, 10000);
      ws.onopen = () => ws.send(JSON.stringify({ type, name, seed, code }));
      ws.onerror = () => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          reject(Error("Could not reach the multiplayer server."));
        }
      };
      ws.onmessage = (e) => {
        let m;
        try {
          m = JSON.parse(e.data);
        } catch {
          return;
        }
        if (m.type === "welcome") {
          done = true;
          clearTimeout(timer);
          this.id = m.id;
          this.code = m.code;
          this.active = true;
          resolve(m);
        } else if (m.type === "error" && !done) {
          done = true;
          clearTimeout(timer);
          ws.close();
          reject(Error(m.message));
        } else if (m.type === "snapshot") this.players = m.players;
        this.onMessage(m);
      };
      ws.onclose = () => {
        clearTimeout(timer);
        if (!done) {
          done = true;
          reject(Error("Connection closed before joining."));
        }
        if (this.socket === ws) {
          this.active = false;
          this.onMessage({ type: "disconnected" });
        }
      };
    });
  }
  send(message: unknown) {
    if (this.socket?.readyState === WebSocket.OPEN)
      this.socket.send(JSON.stringify(message));
  }
  disconnect() {
    const old = this.socket;
    this.socket = null;
    this.active = false;
    this.players = [];
    old?.close();
  }
}
