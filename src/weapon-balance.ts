import { FISTS, PUNCHES } from "./fists.ts";

// Weapon IDs are also used by saved multiplayer sessions and map pickups.
export const BURST_AR = 5,
  HEAVY_AR = 6,
  CARBINE = 7,
  SMG = 8,
  MAMMOTH = 9,
  KNIFE = 10,
  FLASH = 11,
  SMOKE = 12,
  FRAG = 13,
  ROCKET = 14;

function weapon(
  name: string,
  tag: string,
  model: number,
  mag: number,
  interval: number,
  damage: number,
  reload: number,
  spread: number,
  pellets = 1,
) {
  return { name, tag, model, mag, interval, damage, reload, spread, pellets };
}
export const WEAPONS = [
  weapon("Ink AR", "Automatic", 0, 30, 0.11, 25, 1, 0.008),
  weapon("Scatterpen", "Shotgun", 1, 8, 0.72, 15, 1.35, 0.085, 8),
  weapon("Pistol", "Sidearm", 2, 14, 0.25, 38, 0.75, 0.004),
  weapon("Longshot", "Sniper", 3, 5, 1.25, 90, 1.65, 0),
  weapon(
    "Fists",
    "Melee",
    FISTS,
    0,
    PUNCHES[0].duration,
    PUNCHES[0].damage,
    0,
    0,
    0,
  ),
  weapon("Burst AR", "Three-round burst", 0, 24, 0.085, 23, 1.15, 0.005),
  weapon("Heavy AR", "Heavy automatic", 0, 20, 0.19, 39, 1.4, 0.006),
  weapon("Carbine AR", "Light automatic", 0, 36, 0.085, 18, 0.9, 0.012),
  weapon("SMG", "Rapid fire", 2, 32, 0.075, 16, 0.95, 0.023),
  weapon("Mammoth Pistol", "Single shot", 2, 1, 0.45, 85, 1.35, 0.002),
  weapon("Knife", "Melee", 2, 0, 0.45, 65, 0, 0),
  weapon("Flashbang", "Throwable", 2, 1, 0.65, 0, 0, 0, 0),
  weapon("Smoke Grenade", "Throwable", 2, 1, 0.65, 0, 0, 0, 0),
  weapon("Frag Grenade", "Throwable", 2, 1, 0.7, 85, 0, 0, 0),
  weapon("Rocket Launcher", "Launcher", 0, 1, 0.9, 105, 2.25, 0, 0),
];
export function scopeMagnification(id: number) {
  if (id === 3) return 4;
  if (id === CARBINE) return 2;
  return 0;
}
export const BURST_RECOVERY = 0.34;
export const RELOAD_SECONDS = WEAPONS.map((w) => w.reload);
export const MAGAZINES = WEAPONS.map((w) => w.mag);
export const isGrenade = (id: number) =>
  id === FLASH || id === SMOKE || id === FRAG;
export const isBlastWeapon = (id: number) => id === FRAG || id === ROCKET;
export const isUtility = (id: number) => id === KNIFE || isGrenade(id);
export const loadoutSlots = [
  {
    key: "primary",
    name: "Primary",
    options: [0, BURST_AR, HEAVY_AR, CARBINE, 1, 3, ROCKET],
  },
  { key: "secondary", name: "Secondary", options: [2, SMG, MAMMOTH] },
  { key: "utility", name: "Equipment", options: [KNIFE, FLASH, SMOKE, FRAG] },
] as const;
export type Loadout = Record<(typeof loadoutSlots)[number]["key"], number>;
export const ARMORY_RADIUS = 6;
export const defaultLoadout: Loadout = {
  primary: 0,
  secondary: 2,
  utility: KNIFE,
};
export function readLoadout(value: unknown): Loadout | undefined {
  if (!value || typeof value !== "object") return;
  const kit = value as Loadout;
  if (
    !loadoutSlots.every(({ key, options }) =>
      (options as readonly number[]).includes(kit[key]),
    )
  )
    return;
  return {
    primary: kit.primary,
    secondary: kit.secondary,
    utility: kit.utility,
  };
}

export function inventory(loadout?: Loadout, county = false) {
  const owned = loadout
    ? [
        loadout.primary,
        loadout.secondary,
        county && loadout.utility === KNIFE ? FISTS : loadout.utility,
      ]
    : [0, 1, 2, 3, FISTS];
  return {
    weapon: owned[0],
    owned,
    mags: loadout
      ? MAGAZINES.map((mag, id) => (owned.includes(id) ? mag : 0))
      : MAGAZINES.slice(0, 4),
  };
}
