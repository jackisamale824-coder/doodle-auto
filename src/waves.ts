export function waveSettings(wave: number) {
  const level = Math.max(0, wave - 1);
  return {
    total: Math.min(40, 4 + level * 3),
    spawnInterval: Math.max(0.35, 1.5 - level * 0.12),
    speed: Math.min(6.5, 3 + level * 0.3),
    reaction: Math.max(220, 850 - level * 65),
    shotInterval: Math.max(550, 1800 - level * 110),
    damage: Math.min(12, 4 + level),
  };
}
export class Waves {
  number = 1;
  spawned = 4;
  nextIn = 0;
  private spawnIn = 0;
  get settings() {
    return waveSettings(this.number);
  }
  get queued() {
    return this.settings.total - this.spawned;
  }
  update(dt: number, alive: number, spawn: () => boolean | void) {
    if (this.queued === 0 && alive === 0) {
      if (this.nextIn === 0) this.nextIn = 6;
      this.nextIn = Math.max(0, this.nextIn - dt);
      if (this.nextIn === 0) {
        this.number++;
        this.spawned = 0;
        this.spawnIn = 0;
      }
      return;
    }
    this.spawnIn -= dt;
    if (this.queued > 0 && alive < 16 && this.spawnIn <= 0) {
      const success = spawn() !== false;
      if (success) this.spawned++;
      this.spawnIn = success ? this.settings.spawnInterval : 0.5;
    }
  }
  snapshot(alive: number) {
    return {
      number: this.number,
      alive,
      queued: this.queued,
      nextIn: this.nextIn,
    };
  }
}
