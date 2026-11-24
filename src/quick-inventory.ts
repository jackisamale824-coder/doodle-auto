import { FISTS } from "./fists.ts";
import { KNIFE, WEAPONS } from "./weapon-balance.ts";

export class QuickInventory {
  private slots: number[] = [];
  private x = 0;
  private y = 0;
  private selected = -1;

  constructor(private panel: HTMLElement) {}
  get open() {
    return !this.panel.hidden;
  }

  show(owned: number[], current: number, county: boolean) {
    this.slots = [...owned];
    this.x = this.y = 0;
    this.selected = -1;
    this.panel.replaceChildren();
    for (const [slot, id] of owned.entries()) {
      const angle = (slot * 2 * Math.PI) / owned.length;
      const tile = document.createElement("span");
      tile.className = "quick-slot";
      tile.style.left = 50 + 34 * Math.sin(angle) + "%";
      tile.style.top = 50 - 34 * Math.cos(angle) + "%";
      const item = id === FISTS && county ? KNIFE : id;
      if (item !== FISTS) {
        const img = document.createElement("img");
        img.src = `${import.meta.env.BASE_URL}loadout/weapon-${item}.webp`;
        img.alt = "";
        tile.append(img);
      }
      tile.append(WEAPONS[item].name);
      if (id === current) tile.classList.add("equipped");
      this.panel.append(tile);
    }
    this.panel.hidden = false;
  }
  move(dx: number, dy: number) {
    this.x += dx;
    this.y += dy;
    const length = Math.hypot(this.x, this.y);
    const radius = 58;
    if (length > radius) {
      this.x *= radius / length;
      this.y *= radius / length;
    }
    const n = this.slots.length;
    this.selected =
      length < 10
        ? -1
        : (Math.round((Math.atan2(this.x, -this.y) * n) / (2 * Math.PI)) + n) %
          n;
    for (const [i, tile] of Array.from(this.panel.children).entries())
      tile.classList.toggle("pointed", i === this.selected);
    this.panel.style.setProperty(
      "--heading",
      ((this.selected - 0.5) * 360) / n + "deg",
    );
    this.panel.style.setProperty(
      "--arc",
      (this.selected < 0 ? 0 : 360 / n) + "deg",
    );
  }
  close() {
    const id = this.open ? this.slots[this.selected] : undefined;
    this.panel.hidden = true;
    this.panel.style.setProperty("--arc", "0deg");
    return id;
  }
}
