import { Mesh, Raycaster, Vector3, type Object3D } from "three";
import { VEHICLE_DIMENSIONS } from "./county-vehicle-dimensions.ts";
import type { CountyCar, VehicleKind } from "./county.ts";
import type { V3 } from "./world.ts";

export interface PanelDent {
  panel: string;
  point: V3;
  normal: V3;
}

export const MAX_ENGINE_HITS = 12;
// Bonnet height and rear edge of the engine bay in the fleet model's local space.
export const bonnet: Record<VehicleKind, { height: number; rear: number }> = {
  saloon: { height: 0.91, rear: 0.44 },
  coupe: { height: 0.75, rear: 0.39 },
  minivan: { height: 1.07, rear: 0.63 },
  delivery: { height: 1.02, rear: 0.71 },
  taxi: { height: 0.84, rear: 0.39 },
};
export const tireCorners = ["fl", "fr", "rl", "rr"] as const;

// The pane identifiers are authored per triangle and shared across detail levels.
export function vehicleSurface(near: Object3D, ray: Raycaster, car: CountyCar) {
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
    if (part >= 16 && part & (car.damage ?? 0)) continue;
    const panel = mesh.name.slice(5);
    const point = mesh.worldToLocal(hit.point.clone());
    const dent: PanelDent | undefined =
      !part && ["body_mesh", "door_mesh"].includes(panel)
        ? { panel, point: point.toArray(), normal: hit.face.normal.toArray() }
        : undefined;
    const local = near.worldToLocal(hit.point.clone());
    const [width, length] = VEHICLE_DIMENSIONS[car.kind];
    const bay = bonnet[car.kind];
    const engine =
      panel === "body_mesh" &&
      !part &&
      -local.z >= length * bay.rear &&
      Math.abs(local.x) < width * 0.92 &&
      local.y > 0.28 &&
      local.y <= bay.height + 0.23;
    return { distance: hit.distance, point: hit.point, part, dent, engine };
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
    if (hit.engine)
      car.engineHits = Math.min(MAX_ENGINE_HITS, (car.engineHits ?? 0) + 1);
    car.dents = [...(car.dents ?? []).slice(-15), hit.dent];
    car.wear = Math.min(18, (car.wear ?? 0) + 1);
    car.dentVersion = (car.dentVersion ?? 0) + 1;
  } else return false;
  return true;
}

export function enginePower(car?: CountyCar) {
  return 1 - (0.78 * (car?.engineHits ?? 0)) / MAX_ENGINE_HITS;
}

export function vehicleHandling(car?: CountyCar) {
  const mask = car?.damage ?? 0;
  const left = Number(!!(mask & 1)) + Number(!!(mask & 4));
  const right = Number(!!(mask & 2)) + Number(!!(mask & 8));
  const wear = Math.min(1, Math.max(0, ((car?.wear ?? 0) - 2) / 14));
  return {
    pull: (left - right) * 0.34,
    speed:
      [1, 0.85, 0.67, 0.47, 0.25][left + right] *
      (1 - 0.42 * wear) *
      enginePower(car),
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
    const hit = model && vehicleSurface(model, ray, car);
    if (hit) {
      ray.far = hit.distance;
      nearest = { index, hit };
    }
  }
  return nearest;
}
