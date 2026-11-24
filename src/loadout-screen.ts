import "./loadout-screen.css";
import {
  FLASH,
  KNIFE,
  SMOKE,
  WEAPONS,
  loadoutSlots,
  type Loadout,
} from "./weapon-balance.ts";

const icon = (id: number) =>
  `${import.meta.env.BASE_URL}loadout/weapon-${id}.webp`;

export function loadoutScreen(kit: Loadout, respawning: boolean) {
  const columns = loadoutSlots
    .map(
      ({ key, name, options }, slot) =>
        `<fieldset class="armory-column"><legend><b>0${slot + 1}</b> ${name}</legend>
      ${options
        .map(
          (id) => `<label class="armory-card">
        <input type="radio" name="${key}" value="${id}" ${kit[key] === id ? "checked" : ""}>
        <span class="item-face"><span class="item-name">${WEAPONS[id].name}</span><i aria-hidden="true">✓</i>
          <img alt="" src="${icon(id)}" draggable="false"></span></label>`,
        )
        .join("")}
    </fieldset>`,
    )
    .join("");
  const wheel = loadoutSlots
    .map(
      ({ key }, slot) =>
        `<button type="button" class="wheel-slot" data-slot="${key}">
      <img alt="" src="${icon(kit[key])}"><span>${slot + 1}</span>
    </button>`,
    )
    .join("");
  return `<form id="kit-form" class="armory">
    <div class="armory-header"><h2>Loadout</h2></div>
    <div class="armory-body">
      <div class="armory-rack">${columns}
        <div class="kit-wheel" role="group" aria-label="Inspect equipped slots">${wheel}<span class="wheel-hub" aria-hidden="true">＋</span></div>
      </div>
      <aside class="armory-inspect" aria-label="Equipment preview">
        <div class="inspect-info"><span id="inspect-kind"></span><h3 id="inspect-name"></h3>
          <div class="inspect-spec"><img id="inspect-icon" alt=""><span id="inspect-stat"></span></div>
        </div>
      </aside>
    </div>
    <footer class="armory-footer"><button type="button" id="kit-back">Back</button>
      <button type="submit" id="equip-kit" class="armory-equip">${respawning ? "Equip and respawn" : "Use this loadout"} <span aria-hidden="true">→</span></button></footer>
  </form>`;
}

export function bindLoadoutPreview(form: HTMLFormElement, back: () => void) {
  const radios = [
    ...form.querySelectorAll<HTMLInputElement>("input[type=radio]"),
  ];
  const wheel = [...form.querySelectorAll<HTMLButtonElement>(".wheel-slot")];
  const title = form.querySelector<HTMLElement>("#inspect-name")!;
  const kind = form.querySelector<HTMLElement>("#inspect-kind")!;
  const stat = form.querySelector<HTMLElement>("#inspect-stat")!;
  const art = form.querySelector<HTMLImageElement>("#inspect-icon")!;
  function inspect(input: HTMLInputElement) {
    const id = Number(input.value),
      weapon = WEAPONS[id];
    const slot = loadoutSlots.find((s) => s.key === input.name)!;
    title.textContent = weapon.name;
    kind.textContent = `${slot.name} / ${weapon.tag}`;
    art.src = icon(id);
    stat.textContent =
      id === KNIFE
        ? "Close range"
        : id === FLASH
          ? "Blinds nearby players"
          : id === SMOKE
            ? "Blocks sightlines"
            : `${weapon.mag} ${weapon.mag === 1 ? "round" : "rounds"} per magazine`;
  }
  function syncWheel() {
    for (const button of wheel) {
      const input = radios.find(
        (r) => r.name === button.dataset.slot && r.checked,
      )!;
      const name = WEAPONS[Number(input.value)].name;
      button.querySelector("img")!.src = icon(Number(input.value));
      button.title = `Inspect ${name}`;
      button.setAttribute(
        "aria-label",
        `Inspect equipped ${input.name}, ${name}`,
      );
    }
  }
  for (const input of radios) {
    input.labels?.[0].addEventListener("pointerenter", () => inspect(input));
    input.onfocus = () => inspect(input);
    input.onchange = () => {
      inspect(input);
      syncWheel();
    };
  }
  for (const button of wheel)
    button.onclick = () =>
      radios.find((r) => r.checked && r.name === button.dataset.slot)?.focus();
  form.querySelector<HTMLButtonElement>("#kit-back")!.onclick = back;
  inspect(radios.find((r) => r.checked)!);
  syncWheel();
}
