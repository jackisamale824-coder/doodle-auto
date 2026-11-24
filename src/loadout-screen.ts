import "./loadout-screen.css";
import {
  FLASH,
  FRAG,
  ROCKET,
  KNIFE,
  SMOKE,
  WEAPONS,
  loadoutSlots,
  type Loadout,
} from "./weapon-balance.ts";

const icon = (id: number) =>
  `${import.meta.env.BASE_URL}loadout/weapon-${id}.webp`;

export function loadoutScreen(kit: Loadout, action: string) {
  const columns = loadoutSlots
    .map(
      ({ key, name, options }, slot) =>
        `<fieldset class="armory-column" data-category="${key}"><legend><b>0${slot + 1}</b> ${name}</legend>
      ${options
        .map(
          (id, row) => `<label class="armory-card">
        <input type="radio" name="${key}" value="${id}" ${kit[key] === id ? "checked" : ""}>
        <span class="item-face"><small class="item-key" aria-hidden="true">${row + 1}</small><span class="item-name">${WEAPONS[id].name}</span><i aria-hidden="true">✓</i>
          <img alt="" src="${icon(id)}" draggable="false"></span></label>`,
        )
        .join("")}
    </fieldset>`,
    )
    .join("");
  return `<form id="kit-form" class="armory">
    <div class="armory-header"><h2>Weapon loadout</h2></div>
    <div class="armory-body">
      <div class="armory-rack">${columns}
        <div class="kit-feedback"><output id="kit-choice" aria-live="polite">Choose equipment</output>
        <span id="kit-hint">1–3 category · then item number</span></div>
      </div>
      <aside class="armory-inspect" aria-label="Equipment preview">
        <div class="inspect-portrait"><img id="inspect-icon" alt=""></div>
        <div class="inspect-info"><span id="inspect-kind"></span><h3 id="inspect-name"></h3>
          <div class="inspect-spec"><span id="inspect-stat"></span></div>
        </div>
      </aside>
    </div>
    <footer class="armory-footer"><button type="button" id="kit-back">Back</button>
      <button type="submit" id="equip-kit" class="armory-equip"><kbd>B</kbd> ${action} <span aria-hidden="true">→</span></button></footer>
  </form>`;
}

export function bindLoadoutPreview(
  form: HTMLFormElement,
  back: () => void,
  onChoose: (slot: keyof Loadout) => void,
) {
  const radios = [
    ...form.querySelectorAll<HTMLInputElement>("input[type=radio]"),
  ];
  let category: keyof Loadout | undefined;
  const hint = form.querySelector<HTMLElement>("#kit-hint")!;
  const choice = form.querySelector<HTMLOutputElement>("#kit-choice")!;
  function setCategory(key?: keyof Loadout) {
    category = key;
    form
      .querySelectorAll<HTMLElement>("[data-category]")
      .forEach((col) =>
        col.classList.toggle("key-active", col.dataset.category === key),
      );
    const selected = loadoutSlots.find((s) => s.key === key);
    hint.textContent = selected
      ? `${selected.name}: 1–${selected.options.length} to select · 0 back`
      : "1–3 category · then item number";
  }
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
      id === FRAG
        ? "One throw · area damage"
        : id === ROCKET
          ? "One rocket per reload · impact blast"
          : id === KNIFE
            ? "Close range"
            : id === FLASH
              ? "Blinds nearby players"
              : id === SMOKE
                ? "Blocks sightlines"
                : `${weapon.mag} ${weapon.mag === 1 ? "round" : "rounds"} per magazine`;
  }
  for (const input of radios) {
    input.labels?.[0].addEventListener("pointerenter", () => inspect(input));
    input.onfocus = () => inspect(input);
    input.onclick = () => {
      inspect(input);
      setCategory();
      choice.value = WEAPONS[Number(input.value)].name + " selected";
      onChoose(input.name as keyof Loadout);
    };
  }
  form.onkeydown = (event) => {
    if (event.altKey || event.metaKey || event.ctrlKey) return;
    const digit = /^(?:Digit|Numpad)([0-9])$/.exec(event.code);
    if (digit) {
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      const n = Number(digit[1]);
      if (!n) {
        setCategory();
        return;
      }
      if (!category) {
        const slot = loadoutSlots[n - 1];
        if (slot) setCategory(slot.key);
      } else {
        const input = radios.filter((r) => r.name === category)[n - 1];
        if (input) {
          input.focus();
          input.click();
          setCategory();
        }
      }
    } else if (
      event.code === "KeyB" ||
      (event.key === "Enter" && !(event.target instanceof HTMLButtonElement))
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat)
        form.querySelector<HTMLButtonElement>("#equip-kit")!.click();
    }
  };
  form.querySelector<HTMLButtonElement>("#kit-back")!.onclick = back;
  inspect(radios.find((r) => r.checked)!);
}
