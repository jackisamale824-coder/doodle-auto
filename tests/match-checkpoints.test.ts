import assert from "node:assert/strict";
import test from "node:test";
import { openPlayerStore } from "../server/player-accounts.ts";
import { MatchCheckpoints } from "../server/match-checkpoints.ts";
import { gameShards, shardForCode, shardForSeed } from "../src/game-shards.ts";

test("replacement server fences old saves and explicit removal survives a restart", async () => {
  process.env.PLAYER_DB = ":memory:";
  const store = await openPlayerStore();
  let state: string | null = "first";
  const writer = () => new MatchCheckpoints(store, () => state);
  const old = writer();
  assert.deepEqual(await old.open(), []);
  await old.save(["G1234"]);
  const current = writer();
  assert.deepEqual(
    (await current.open()).map((row) => row.data),
    ["first"],
  );
  state = "stale";
  await assert.rejects(old.save(["G1234"]), /superseded/);
  state = null;
  await current.save(["G1234"]);
  assert.deepEqual(await writer().open(), []);
});

test("room and invite routing agree across maps, including legacy room codes", () => {
  for (const [seed, code] of [
    ["switchback-county", "G12AB"],
    ["four-tides", "t1234"],
    ["city:legacy", "TBA98"],
    ["rust", "ABCDE"],
  ]) {
    assert.equal(
      gameShards[shardForSeed(seed)].socket,
      gameShards[shardForCode(code)].socket,
    );
  }
  assert.equal(shardForCode("F0123"), "shared");
});
