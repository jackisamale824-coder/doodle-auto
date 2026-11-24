import { WebSocket } from "ws";

export function nextPacket(ws, type, matches = () => true) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => finish(Error("Timed out waiting for " + type)),
      20000,
    );
    function finish(error, packet) {
      clearTimeout(timer);
      ws.off("message", read);
      ws.off("close", closed);
      ws.off("error", closed);
      if (error) reject(error);
      else resolve(packet);
    }
    function closed() {
      finish(Error("Socket closed waiting for " + type));
    }
    function read(data) {
      const packet = JSON.parse(data);
      if (packet.type === "error") finish(Error(packet.message));
      else if (packet.type === type && matches(packet)) finish(null, packet);
    }
    ws.on("message", read).once("close", closed).once("error", closed);
  });
}
export async function openPlayer(origin, path, message) {
  const url = new URL(path, origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(url, { origin, handshakeTimeout: 18000 });
  ws.once("open", () =>
    ws.send(
      JSON.stringify({
        mapScale: 1.21,
        ...message,
        resume: 1,
        compact: true,
        spatialSnapshots: 1,
      }),
    ),
  );
  try {
    const welcome = await nextPacket(
      ws,
      message.type === "resume" ? "resumed" : "welcome",
    );
    return { ws, welcome };
  } catch (error) {
    ws.terminate();
    throw error;
  }
}
export function resumeMessage(welcome) {
  return {
    type: "resume",
    sessionId: welcome.sessionId,
    secret: welcome.resumeSecret,
    attemptId: crypto.randomUUID(),
  };
}
export function leave(ws) {
  if (ws.readyState === WebSocket.OPEN)
    ws.send(JSON.stringify({ type: "leave" }));
  ws.close();
}
