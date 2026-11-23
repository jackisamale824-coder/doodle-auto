import type { VehicleKind } from "./county.ts";

// Half width, half length, roof height and axle separation from the fleet models.
export const VEHICLE_DIMENSIONS: Record<
  VehicleKind,
  [number, number, number, number]
> = {
  saloon: [1.05, 2.49, 1.45, 2.84],
  coupe: [1, 2.33, 1.3, 2.62],
  minivan: [1.12, 2.58, 1.74, 3],
  delivery: [0.89, 1.7, 2.03, 2.45],
  taxi: [0.87, 2.35, 1.73, 2.68],
};
