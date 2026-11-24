import * as T from "three";

// Both reflex windows sit on the same optical axis in viewmodel space.
export const REFLEX_HEIGHT = 0.195;

export function reflexSight() {
  const sight = new T.Group();
  sight.name = "reflex-sight";
  sight.position.set(0, REFLEX_HEIGHT, 0.024);
  const frame = new T.MeshLambertMaterial({ color: 0x253540 });
  const rim = new T.Shape();
  rim.moveTo(-0.096, -0.06);
  rim.lineTo(-0.096, 0.04);
  rim.lineTo(-0.072, 0.069);
  rim.lineTo(0.072, 0.069);
  rim.lineTo(0.096, 0.04);
  rim.lineTo(0.096, -0.06);
  rim.closePath();
  const window = new T.Path();
  window.moveTo(-0.084, -0.047);
  window.lineTo(0.084, -0.047);
  window.lineTo(0.084, 0.034);
  window.lineTo(0.064, 0.057);
  window.lineTo(-0.064, 0.057);
  window.lineTo(-0.084, 0.034);
  window.closePath();
  rim.holes.push(window);
  const housing = new T.Mesh(
    new T.ExtrudeGeometry(rim, { depth: 0.024, bevelEnabled: false }),
    frame,
  );
  const glass = new T.Mesh(
    new T.ShapeGeometry(new T.Shape(window.getPoints())),
    new T.MeshBasicMaterial({
      color: 0x83bfae,
      opacity: 0.1,
      transparent: true,
      depthWrite: false,
      side: T.DoubleSide,
    }),
  );
  glass.position.z = 0.012;
  const mount = new T.Mesh(new T.BoxGeometry(0.073, 0.088, 0.1), frame);
  mount.position.y = -0.099;
  sight.add(housing, glass, mount);
  return sight;
}

export function launcherRound() {
  const round = new T.Group();
  round.name = "reload-round";
  const body = new T.Mesh(
    new T.CylinderGeometry(0.068, 0.062, 0.32, 12),
    new T.MeshLambertMaterial({ color: 0x778654 }),
  );
  const band = new T.Mesh(
    new T.CylinderGeometry(0.069, 0.069, 0.047, 12),
    new T.MeshLambertMaterial({ color: 0xe5b355 }),
  );
  const tip = new T.Mesh(
    new T.ConeGeometry(0.069, 0.13, 12),
    new T.MeshLambertMaterial({ color: 0xc96645 }),
  );
  for (const mesh of [body, band, tip]) mesh.rotation.x = -Math.PI / 2;
  band.position.z = -0.09;
  tip.position.z = -0.224;
  round.add(body, band, tip);
  round.visible = false;
  return round;
}
