import type { Group, Object3D } from "three";
import { ROCKET, WEAPONS } from "./weapon-balance.ts";
const ease = (x: number) => {
  x = Math.max(0, Math.min(1, x));
  return x * x * (3 - 2 * x);
};
const pulse = (t: number, a: number, b: number, c: number, d: number) =>
  ease((t - a) / (b - a)) * (1 - ease((t - c) / (d - c)));
export function reloadPose(weapon: number, progress: number) {
  const t = Math.max(0, Math.min(1, progress));
  const hold = pulse(t, 0, 0.13, 0.78, 1);
  if (weapon === ROCKET) {
    const insert = ease((t - 0.54) / 0.22);
    const reach = pulse(t, 0.12, 0.42, 0.73, 0.92);
    const settle = pulse(t, 0.72, 0.76, 0.79, 0.89);
    return {
      x: 0.06 * hold,
      y: 0.12 * hold - 0.018 * settle,
      pitch: 0.27 * hold - 0.055 * settle,
      roll: -0.28 * hold,
      yaw: 0.82 * hold,
      roundGrip: reach,
      insert,
      flip: 0,
      seat: 0,
      magazine: 0,
      rack: 0,
      shell: 0,
    };
  }
  const model = WEAPONS[weapon].model;
  const seat = pulse(t, 0.55, 0.59, 0.61, 0.68);
  const flip = pulse(t, 0.18, 0.3, 0.4, 0.57);
  const magazine = pulse(t, 0.12, 0.27, 0.4, 0.59);
  const rack = pulse(t, 0.64, 0.73, 0.75, 0.84);
  const shell =
    t > 0.2 && t < 0.74 ? Math.sin(((t - 0.2) / 0.54) * Math.PI * 3) ** 2 : 0;
  return {
    x: hold * [0.06, 0.04, 0.045, 0.05][model] - seat * 0.015,
    y: -hold * [0.12, 0.1, 0.1, 0.12][model] + seat * 0.035,
    pitch: hold * [-0.25, 0.28, -0.2, -0.22][model] + rack * 0.09 - seat * 0.06,
    roll: hold * [-0.65, -0.8, -0.52, -0.55][model] - flip * 0.12 + rack * 0.1,
    yaw: 0,
    roundGrip: 0,
    insert: 0,
    flip,
    seat,
    magazine,
    rack,
    shell,
  };
}
export function animateWeaponParts(
  group: Group,
  weapon: number,
  progress: number,
  kick: number,
  loaded = true,
) {
  const pose = reloadPose(weapon, progress);
  if (weapon === ROCKET) {
    const round = group.userData.reloadRound as Object3D;
    const lift = progress > 0 ? ease((progress - 0.15) / 0.35) : 1;
    const insert = progress > 0 ? pose.insert : 1;
    round.visible = progress > 0 ? progress > 0.15 : loaded;
    round.position.set(
      -0.4 * (1 - lift),
      -0.045 - 0.52 * (1 - lift),
      -1.25 + 0.15 * (1 - lift) + 0.55 * insert,
    );
    round.rotation.z = (1 - lift) * 0.48;
    round.rotation.x = (1 - lift) * -0.35;
    return pose;
  }
  const model = WEAPONS[weapon].model;
  const parts = group.userData.animatedParts as Object3D[] | undefined;
  for (const part of parts ?? []) {
    part.position.copy(part.userData.restPosition);
    part.rotation.copy(part.userData.restRotation);
    if (part.name === "magazine") {
      part.position.y -= pose.magazine * 0.36;
      part.position.x += pose.magazine * 0.1;
      part.rotation.z += pose.flip * 0.7;
      part.rotation.x += pose.flip * 0.35;
      part.position.z += pose.flip * 0.08;
    }
    if (part.name === "action") {
      part.position.z +=
        pose.rack * (model === 1 ? 0.15 : 0.1) + Math.min(1, kick) * 0.018;
      if (model === 3) part.rotation.z -= pose.rack * 0.75;
    }
    if (part.name === "shell") {
      part.visible = pose.shell > 0.01;
      if (part.visible) {
        part.position.y -= (1 - pose.shell) * 0.14;
        part.position.z += (1 - pose.shell) * 0.06;
        part.rotation.x += (1 - pose.shell) * 0.7;
      }
    }
  }
  return pose;
}
