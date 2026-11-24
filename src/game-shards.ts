// Existing five-digit hexadecimal room codes belong to the original server.
export const gameShards = {
  shared: { name: "shared-game-server", prefix: "", socket: "/ws" },
  county: { name: "county-game-server", prefix: "G", socket: "/ws/county" },
  islands: { name: "islands-game-server", prefix: "T", socket: "/ws/islands" },
} as const;
export type GameShard = keyof typeof gameShards;
export const shardNames = Object.keys(gameShards) as GameShard[];
export function shardForSeed(seed: string): GameShard {
  if (seed === "switchback-county") return "county";
  if (seed === "four-tides" || seed.startsWith("city:")) return "islands";
  return "shared";
}
export function shardForCode(code: string): GameShard {
  const prefix = code.trim().toUpperCase().charAt(0);
  return (
    shardNames.find((key) => gameShards[key].prefix === prefix) ?? "shared"
  );
}
