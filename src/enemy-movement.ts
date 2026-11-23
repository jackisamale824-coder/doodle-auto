// Enemies alternate a committed sidestep and a short planted beat. Offsetting
// the cycle by actor keeps a wave from changing direction in unison.
export function combatStep(
  id: number,
  time: number,
  range: number,
  hp: number,
  reach: number,
) {
  const beat = time / (1.8 + (id % 4) * 0.23) + id * 0.71;
  const lateral =
    (Math.floor(beat) % 2 ? 1 : -1) *
    Math.min(1, (beat % 1) * 8, Math.max(0, (0.84 - (beat % 1)) * 8));
  const preferred = hp < 40 ? reach + 5 : reach;
  return {
    forward: Math.max(-0.85, Math.min(1, (range - preferred) / 5)),
    side: lateral * 0.8,
  };
}
export function shotDelay(shots: number, wave: number, interval: number) {
  return shots % (wave >= 3 ? 3 : 2) === 0 ? interval : 0.24;
}
