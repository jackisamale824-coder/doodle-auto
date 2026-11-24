// The engine and radio are synthesized locally, so neither needs an audio download.
export class CoastSound {
  private context?: AudioContext;
  private motor?: OscillatorNode;
  private volume?: GainNode;
  private beat = 0;
  private nextBeat = 0;
  enabled = true;
  start() {
    if (!window.AudioContext || !this.enabled) return;
    if (!this.context) {
      this.context = new AudioContext();
      this.motor = this.context.createOscillator();
      this.motor.type = "triangle";
      this.volume = this.context.createGain();
      this.volume.gain.value = 0;
      this.motor.connect(this.volume).connect(this.context.destination);
      this.motor.start();
    }
    void this.context.resume().catch(() => {});
  }
  pause() {
    if (this.context) void this.context.suspend().catch(() => {});
  }
  update(speed: number, driving: boolean, wanted: boolean) {
    const ctx = this.context;
    if (!ctx || !this.enabled || ctx.state !== "running") return;
    const t = ctx.currentTime;
    this.motor!.frequency.setTargetAtTime(
      33 + ((Math.abs(speed) * 2.5) % 48),
      t,
      0.09,
    );
    this.volume!.gain.setTargetAtTime(driving ? 0.055 : 0, t, 0.09);
    if (!driving || t < this.nextBeat) return;
    this.nextBeat = t + 0.245;
    const notes = [130.81, 155.56, 196, 233.08, 174.61, 207.65, 261.63, 233.08];
    const note = ctx.createOscillator(),
      gain = ctx.createGain();
    const i = this.beat++ % 16;
    note.type = wanted ? "sine" : "triangle";
    note.frequency.value = wanted
      ? i % 2
        ? 560
        : 435
      : notes[Math.floor(i / 2)] * (i % 2 ? 2 : 0.5);
    gain.gain.setValueAtTime(0.001, t);
    gain.gain.exponentialRampToValueAtTime(wanted ? 0.045 : 0.032, t + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.23);
    note.connect(gain).connect(ctx.destination);
    note.start(t);
    note.stop(t + 0.24);
    note.onended = () => {
      note.disconnect();
      gain.disconnect();
    };
  }
}
