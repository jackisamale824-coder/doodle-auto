import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// Rings follow each anatomical contour from the wrist towards the fingertips.
// The guide vector fixes the broad axis so the fingers keep their oval section
// as they curl under the palm.
type Ring = [x: number, y: number, z: number, width: number, depth: number];
function sculptHand(detail: number) {
  const positions: number[] = [],
    indices: number[] = [];
  function loft(rings: Ring[], guide = new T.Vector3(1, 0, 0)) {
    const base = positions.length / 3;
    const centers = rings.map(([x, y, z]) => new T.Vector3(x, y, z));
    rings.forEach((ring, i) => {
      const tangent = centers[Math.min(i + 1, rings.length - 1)]
        .clone()
        .sub(centers[Math.max(0, i - 1)])
        .normalize();
      const normal = new T.Vector3().crossVectors(tangent, guide).normalize();
      const broad = new T.Vector3().crossVectors(normal, tangent);
      for (let j = 0; j < detail; j++) {
        const angle = (2 * Math.PI * j) / detail;
        const p = centers[i]
          .clone()
          .addScaledVector(broad, ring[3] * Math.cos(angle))
          .addScaledVector(normal, ring[4] * Math.sin(angle));
        positions.push(p.x, p.y, p.z);
        if (i) {
          const a = base + (i - 1) * detail + j,
            b = base + (i - 1) * detail + ((j + 1) % detail);
          indices.push(a, b, a + detail, b, b + detail, a + detail);
        }
      }
    });
    for (let j = 1; j < detail - 1; j++) {
      indices.push(base, base + j + 1, base + j);
      const end = base + (rings.length - 1) * detail;
      indices.push(end, end + j, end + j + 1);
    }
  }
  loft([
    [0, -0.008, 0.114, 0.04, 0.029],
    [0, -0.006, 0.072, 0.044, 0.033],
    [-0.003, -0.002, 0.035, 0.054, 0.042],
    [0, 0.003, -0.006, 0.067, 0.045],
    [0.002, 0.008, -0.039, 0.065, 0.04],
    [0.002, 0.011, -0.056, 0.055, 0.029],
  ]);
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * 0.031,
      y = 0.033 - 0.0025 * i,
      z = -0.06 + 0.008 * i;
    const r = [0.017, 0.018, 0.017, 0.014][i];
    loft([
      [x * 0.7, 0.029, 0.025, r * 0.7, 0.013],
      [x * 0.91, y, -0.02, r * 0.93, 0.015],
      [x, y, z, r * 1.05, 0.019],
      [x, y - 0.011, z - 0.014, r, 0.017],
      [x, y - 0.032, z - 0.02, r * 0.9, 0.014],
      [x - 0.002, y - 0.051, z - 0.016, r * 0.94, 0.015],
      [x - 0.003, y - 0.062, z + 0.002, r * 0.84, 0.013],
      [x - 0.004, y - 0.062, z + 0.02, r * 0.74, 0.011],
      [x - 0.004, y - 0.053, z + 0.03, r * 0.48, 0.008],
    ]);
  }
  // Opposed thumb, with the pad crossing the curled index and middle fingers.
  loft(
    [
      [-0.034, -0.01, 0.035, 0.026, 0.026],
      [-0.051, -0.015, 0.018, 0.025, 0.024],
      [-0.067, -0.021, -0.004, 0.022, 0.021],
      [-0.073, -0.025, -0.026, 0.021, 0.02],
      [-0.066, -0.033, -0.047, 0.02, 0.018],
      [-0.051, -0.041, -0.055, 0.019, 0.016],
      [-0.033, -0.044, -0.057, 0.017, 0.014],
      [-0.023, -0.044, -0.057, 0.009, 0.009],
    ],
    new T.Vector3(0, 1, 0),
  );
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}
// Fine folds on the knuckles and wrist make the flexed joints readable in
// the same two-tone light as the city. Batch them into one close-up mesh.
function skinFolds() {
  const strokes: T.BufferGeometry[] = [];
  function crease(points: [number, number, number][], radius: number) {
    const path = new T.CatmullRomCurve3(points.map((p) => new T.Vector3(...p)));
    strokes.push(new T.TubeGeometry(path, 8, radius, 4, false));
  }
  for (let i = 0; i < 4; i++) {
    const x = (i - 1.5) * 0.031,
      y = 0.033 - 0.0025 * i,
      z = -0.06 + 0.008 * i;
    crease(
      [
        [x - 0.011, y + 0.013, z + 0.002],
        [x - 0.003, y + 0.019, z + 0.004],
        [x + 0.007, y + 0.016, z + 0.005],
        [x + 0.011, y + 0.012, z + 0.008],
      ],
      0.00095,
    );
    crease(
      [
        [x - 0.009, y + 0.01, z - 0.009],
        [x, y + 0.015, z - 0.008],
        [x + 0.008, y + 0.011, z - 0.006],
      ],
      0.0008,
    );
  }
  crease(
    [
      [-0.034, 0.015, 0.075],
      [-0.016, 0.025, 0.068],
      [0.005, 0.028, 0.065],
      [0.024, 0.024, 0.061],
    ],
    0.00085,
  );
  crease(
    [
      [-0.056, 0.001, 0.013],
      [-0.066, 0.001, -0.001],
      [-0.07, -0.005, -0.015],
    ],
    0.0011,
  );
  const result = mergeGeometries(strokes);
  for (const stroke of strokes) stroke.dispose();
  return result;
}
let foldTemplate: T.BufferGeometry | undefined;
const templates = new Map<number, T.BufferGeometry>();
export function handMesh(side: number, material: T.Material, closeUp = false) {
  const detail = closeUp ? 16 : 8;
  if (!templates.has(detail)) templates.set(detail, sculptHand(detail));
  // Each actor owns its GPU resource and can be disposed independently.
  const mesh = new T.Mesh(templates.get(detail)!.clone(), material);
  mesh.scale.x = side;
  if (closeUp) {
    foldTemplate ??= skinFolds();
    mesh.add(
      new T.Mesh(
        foldTemplate.clone(),
        new T.MeshBasicMaterial({ color: "#9799c7" }),
      ),
    );
  }
  return mesh;
}
