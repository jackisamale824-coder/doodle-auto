import { Mesh, Raycaster, Vector3, type Object3D } from "three";
import type { CountyCar } from "./county.ts";
import type { V3 } from "./world.ts";

export interface PanelDent {
  panel: string;
  point: V3;
  normal: V3;
}

export const tireCorners = ["fl", "fr", "rl", "rr"] as const;

// The pane identifiers are authored per triangle and shared across detail levels.
export function vehicleSurface(near: Object3D, ray: Raycaster, damage = 0) {
  near.updateWorldMatrix(true, true);
  for (const hit of ray.intersectObject(near, true)) {
    const mesh = hit.object;
    if (!(mesh instanceof Mesh) || !mesh.name.startsWith("near_") || !hit.face)
      continue;
    const corner = tireCorners.findIndex(
      (c) => mesh.name === "near_wheel_" + c + "_mesh",
    );
    const part =
      corner >= 0
        ? 1 << corner
        : (mesh.userData.paneBits?.[hit.faceIndex ?? -1] ?? 0);
    if (part >= 16 && part & damage) continue;
    const panel = mesh.name.slice(5);
    const point = mesh.worldToLocal(hit.point.clone());
    const dent: PanelDent | undefined =
      !part && ["body_mesh", "door_mesh"].includes(panel)
        ? { panel, point: point.toArray(), normal: hit.face.normal.toArray() }
        : undefined;
    return { distance: hit.distance, point: hit.point, part, dent };
  }
  return null;
}

export function damageVehicle(
  car: CountyCar,
  hit: NonNullable<ReturnType<typeof vehicleSurface>>,
) {
  if (hit.part) {
    if ((car.damage ?? 0) & hit.part) return false;
    car.damage = (car.damage ?? 0) | hit.part;
  } else if (hit.dent) {
    car.dents = [...(car.dents ?? []).slice(-15), hit.dent];
    car.wear = Math.min(18, (car.wear ?? 0) + 1);
    car.dentVersion = (car.dentVersion ?? 0) + 1;
  } else return false;
  return true;
}

export function vehicleHandling(car?: CountyCar) {
  const mask = car?.damage ?? 0;
  const left = Number(!!(mask & 1)) + Number(!!(mask & 4));
  const right = Number(!!(mask & 2)) + Number(!!(mask & 8));
  const wear = Math.min(1, Math.max(0, ((car?.wear ?? 0) - 2) / 14));
  return {
    pull: (left - right) * 0.34,
    speed: [1, 0.85, 0.67, 0.47, 0.25][left + right] * (1 - 0.42 * wear),
  };
}

export function nearestVehicleSurface(
  cars: CountyCar[],
  origin: V3,
  direction: V3,
  max: number,
  nearModel: (car: CountyCar, index: number) => Object3D | undefined,
) {
  const ray = new Raycaster(
    new Vector3(...origin),
    new Vector3(...direction),
    0,
    max,
  );
  const center = new Vector3();
  let nearest:
    | { index: number; hit: NonNullable<ReturnType<typeof vehicleSurface>> }
    | undefined;
  for (const [index, car] of cars.entries()) {
    center.fromArray(car.p).y += 1;
    if (
      center.distanceToSquared(ray.ray.origin) > (ray.far + 4) ** 2 ||
      ray.ray.distanceSqToPoint(center) > 16
    )
      continue;
    const model = nearModel(car, index);
    const hit = model && vehicleSurface(model, ray, car.damage);
    if (hit) {
      ray.far = hit.distance;
      nearest = { index, hit };
    }
  }
  return nearest;
}
