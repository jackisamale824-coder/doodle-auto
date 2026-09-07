export class AudioEngine {
  ctx: AudioContext | null = null;
  volume = 0.35;
  enabled = true;
  private lastStep = 0;
  init() {
    this.ctx ??= new AudioContext();
    void this.ctx.resume();
  }
  tone(
    freq: number,
    duration = 0.08,
    type: OscillatorType = "sine",
    gain = 0.12,
    end?: number,
  ) {
    if (!this.enabled || !this.ctx) return;
    const c = this.ctx,
      o = c.createOscillator(),
      g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, c.currentTime);
    if (end)
      o.frequency.exponentialRampToValueAtTime(end, c.currentTime + duration);
    g.gain.setValueAtTime(gain * this.volume, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
    o.connect(g).connect(c.destination);
    o.start();
    o.stop(c.currentTime + duration);
  }
  noise(duration = 0.1, gain = 0.12) {
    if (!this.enabled || !this.ctx) return;
    const c = this.ctx,
      b = c.createBuffer(1, c.sampleRate * duration, c.sampleRate),
      data = b.getChannelData(0);
    for (let i = 0; i < data.length; i++)
      data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const source = c.createBufferSource(),
      g = c.createGain(),
      filter = c.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1800;
    source.buffer = b;
    g.gain.value = gain * this.volume;
    source.connect(filter).connect(g).connect(c.destination);
    source.start();
  }
  shoot(weapon: number) {
    this.noise(weapon === 1 ? 0.18 : 0.08, 0.55);
    this.tone(weapon === 1 ? 95 : 170, 0.1, "sawtooth", 0.18, 45);
  }
  hit(kill = false) {
    this.tone(kill ? 760 : 500, 0.065, "triangle", 0.2);
    if (kill) setTimeout(() => this.tone(1100, 0.13, "sine", 0.15), 65);
  }
  step(time: number, speed: number) {
    if (
      speed > 2 &&
      time - this.lastStep > Math.max(0.18, 0.48 - speed * 0.015)
    ) {
      this.lastStep = time;
      this.noise(0.045, 0.055);
    }
  }
  collect() {
    [600, 800, 1200].forEach((f, i) =>
      setTimeout(() => this.tone(f, 0.15, "triangle", 0.18), i * 80),
    );
  }
}
