// One clock drives every gameplay cue, including the grace period before a glance.
export class Court {
  constructor(random = Math.random) {
    this.random = random;
    this.phase = "title";
    this.reign = 0;
    this.charge = 0;
    this.elapsed = 0;
    this.look = 0;
    this.held = false;
    this.visitor = 0;
    this.trust = 2;
    this.cue = "walk";
  }
  between(low, high) {
    return low + this.random() * (high - low);
  }
  start() {
    this.phase = "plot";
    this.reign = this.visitor = this.charge = this.elapsed = this.look = 0;
    this.trust = 2;
    this.held = false;
    this.cue = "walk";
    this.remaining = this.between(0.7, 1.15);
    this.result = "";
  }
  finish(result) {
    this.phase = "ending";
    this.result = result;
    this.held = false;
  }
  nextVisitor() {
    this.phase = "rule";
    this.visitor++;
    this.cue = "approach";
    this.remaining = this.between(0.95, 2.05);
    this.duration = this.remaining;
    // A herald and a plotter always appear in the first three audiences.
    this.hostile =
      this.visitor === 1 || (this.visitor > 2 && this.random() < 0.67);
    this.look = 0;
  }
  resolve(message) {
    this.cue = "depart";
    this.remaining = this.duration = 0.95;
    this.message = message;
    this.reign++;
  }
  press() {
    if (this.held) return;
    this.held = true;
    if (this.phase !== "rule" || this.look > 0 || this.cue === "depart") return;
    this.look = 0.62;
    if (this.cue !== "raise") return;
    if (this.hostile) this.resolve("Plot foiled");
    else if (--this.trust === 0) this.finish("revolt");
    else this.resolve("Wrong arrest · the court doubts you");
  }
  release() {
    this.held = false;
  }
  step(dt) {
    this.elapsed += dt;
    if (this.phase === "plot") {
      this.remaining -= dt;
      if (this.remaining <= 0) {
        if (this.cue === "walk") {
          this.cue = "tell";
          this.remaining = 0.49;
        } else if (this.cue === "tell") {
          this.cue = "watch";
          this.remaining = this.between(0.52, 0.95);
        } else {
          this.cue = "walk";
          this.remaining = this.between(1.05, 2.28);
        }
      }
      if (this.held && this.cue === "watch") {
        this.finish("dungeon");
        return;
      }
      this.charge = Math.min(
        1,
        Math.max(0, this.charge + dt * (this.held ? 0.67 : -0.23)),
      );
      if (this.charge >= 1) {
        this.phase = "crown";
        this.remaining = 1.35;
        this.held = false;
      }
    } else if (this.phase === "crown") {
      this.remaining -= dt;
      if (this.remaining <= 0) this.nextVisitor();
    } else if (this.phase === "rule") {
      this.look = Math.max(0, this.look - dt);
      this.remaining -= dt;
      if (this.remaining > 0) return;
      if (this.cue === "approach") {
        if (this.look > 0) {
          this.remaining = 0.12;
          return;
        }
        this.cue = "raise";
        this.remaining = this.duration = Math.max(
          0.82,
          1.45 - this.visitor * 0.055,
        );
      } else if (this.cue === "raise") {
        if (this.hostile) this.finish("usurped");
        else this.resolve("A rose for the crown");
      } else if (this.reign >= 8) this.finish("jubilee");
      else this.nextVisitor();
    }
  }
}
