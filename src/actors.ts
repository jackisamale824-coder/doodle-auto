import {
  WEAPONS,
  ROCKET,
  scopeMagnification,
  KNIFE,
  isGrenade,
  SMOKE,
  SMG,
  MAMMOTH,
  HEAVY_AR,
  CARBINE,
  BURST_AR,
} from "./weapon-balance.ts";
import { buildKnife, knifePose } from "./county-knife.ts";
import { reflexSight, REFLEX_HEIGHT, launcherRound } from "./weapon-attachments.ts";
import { mountWeaponModel } from "./weapon-models.ts";
import {
  characterLook,
  headGeometry,
  torsoGeometry,
  profile,
  type CharacterRole,
} from "./character-art.ts";
import { handMesh } from "./hand-model.ts";
import {
  FISTS,
  guardRaise,
  punchPose,
  reactionWeights,
  REACTION_SECONDS,
  type PunchImpact,
} from "./fists.ts";
import type { HitRegion } from "./actor-hit.ts";
import { solveArm } from "./rig-ik.ts";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import * as T from "three";
import {
  inkMaterial,
  INK,
  RED,
  stroke,
  outlinedBox,
  label,
  disposeGroup,
} from "./render.ts";
import type { CountyAction } from "./county-citizens.ts";
export class Doodle {
  group = new T.Group();
  pelvis = new T.Bone();
  spine = new T.Bone();
  head = new T.Bone();
  leftArm = new T.Bone();
  rightArm = new T.Bone();
  leftLeg = new T.Bone();
  rightLeg = new T.Bone();
  leftElbow = new T.Bone();
  rightElbow = new T.Bone();
  leftKnee = new T.Bone();
  rightKnee = new T.Bone();
  leftHand = new T.Bone();
  rightHand = new T.Bone();
  leftFoot = new T.Bone();
  rightFoot = new T.Bone();
  private recoil = 0;
  private impact = 0;
  private fallTime = 0;
  private impactRegion: HitRegion = "body";
  private impactSide = 1;
  nameLabel: T.Mesh | null = null;
  flashTime = 0;
  aimRig = new T.Group();
  private heldWeapon?: number;
  showHeldWeapon(id: number) {
    if (this.heldWeapon === id || !WEAPONS[id] || id === FISTS) return;
    this.heldWeapon = id;
    mountWeaponModel(this.aimRig, id, "actor");
  }
  private stride = 0;
  private walkSpeed = 0;
  private aimPitch = 0;
  private forwardWeight = 1;
  private sideWeight = 0;
  private ready = 0;
  private civilianAction: CountyAction = "idle";
  private gestureTime = 0;
  constructor(
    public color = RED,
    name?: string,
    readonly role: CharacterRole = "combatant",
    appearanceId = name ?? color,
  ) {
    const look = characterLook(appearanceId, role);
    const dyed = (color: number) => new T.MeshLambertMaterial({ color });
    const skin = dyed(look.skin),
      cloth = dyed(look.shirt),
      denim = dyed(look.pants);
    const leather = dyed(look.shoes),
      trim = dyed(look.tee);
    const metal = dyed(0x364047),
      dark = dyed(0x242b30);
    const colors = new T.MeshLambertMaterial({ vertexColors: true });
    this.group.add(new T.Mesh(torsoGeometry(look), colors));
    this.head.position.y = 1.55;
    this.head.add(new T.Mesh(headGeometry(look), colors));
    this.group.add(this.head);
    for (const [part, joint, end, x, y, arm] of [
      [this.leftArm, this.leftElbow, this.leftHand, -0.28, 1.24, true],
      [this.rightArm, this.rightElbow, this.rightHand, 0.28, 1.24, true],
      [this.leftLeg, this.leftKnee, this.leftFoot, -0.12, 0.7, false],
      [this.rightLeg, this.rightKnee, this.rightFoot, 0.12, 0.7, false],
    ] as const) {
      const upper = arm ? 0.28 : 0.29,
        lower = arm ? 0.27 : 0.29;
      part.position.set(x, y, 0);
      joint.position.y = -upper;
      end.position.y = -lower;
      part.add(joint);
      joint.add(end);
      if (arm) {
        const hem = look.longSleeves ? -upper : -0.16;
        part.add(
          new T.Mesh(
            profile(
              [
                [hem, 0.074],
                [hem + 0.017, 0.082],
                [-0.07, 0.09],
                [0.012, 0.09],
                [0.059, 0.063],
                [0.078, 0],
              ],
              1.06,
            ),
            cloth,
          ),
        );
        if (!look.longSleeves)
          part.add(
            new T.Mesh(
              profile(
                [
                  [-upper - 0.022, 0.06],
                  [-0.22, 0.068],
                  [hem + 0.012, 0.07],
                ],
                1,
              ),
              skin,
            ),
          );
        const wrist = look.longSleeves ? 0.052 : 0.044;
        joint.add(
          new T.Mesh(
            profile(
              [
                [-lower, wrist],
                [-0.18, wrist + 0.008],
                [-0.085, 0.069],
                [-0.022, 0.07],
                [0.027, 0.058],
                [0.04, 0],
              ],
              1.06,
            ),
            look.longSleeves ? cloth : skin,
          ),
        );
        if (look.longSleeves)
          joint.add(
            new T.Mesh(
              profile(
                [
                  [-lower - 0.006, 0.052],
                  [-lower + 0.035, 0.056],
                ],
                1.08,
              ),
              trim,
            ),
          );
        const hand = handMesh(x < 0 ? 1 : -1, skin);
        hand.rotation.x = -Math.PI / 2;
        hand.position.y = -0.045;
        end.add(hand);
      } else {
        part.add(
          new T.Mesh(
            profile(
              [
                [-upper - 0.017, 0.065],
                [-upper + 0.04, 0.081],
                [-0.13, 0.108],
                [-0.023, 0.116],
                [0.033, 0.094],
                [0.043, 0],
              ],
              1.11,
            ),
            denim,
          ),
        );
        joint.add(
          new T.Mesh(
            profile(
              [
                [-lower, 0.072],
                [-lower + 0.025, 0.078],
                [-0.13, 0.081],
                [-0.074, 0.089],
                [-0.012, 0.077],
                [0.035, 0.065],
                [0.046, 0],
              ],
              1.12,
            ),
            denim,
          ),
        );
        const shoe = new T.Mesh(
          new T.SphereGeometry(1, 14, 10).scale(0.089, 0.081, 0.149),
          leather,
        );
        shoe.position.set(0, -0.029, 0.054);
        end.add(shoe);
        const sole = new T.Mesh(
          new T.SphereGeometry(1, 14, 8).scale(0.09, 0.024, 0.15),
          dark,
        );
        sole.position.set(0, -0.085, 0.055);
        end.add(sole);
      }
      this.group.add(part);
    }
    // A dedicated aiming pivot keeps the barrel aligned with the head rather
    // than rotating it through the locomotion arm swing.
    this.aimRig.position.set(0.12, 1.16, 0.12);
    outlinedBox(
      [0.085, 0.11, 0.34],
      [0, 0, 0.13],
      metal,
      this.aimRig,
      "#30383b",
    );
    outlinedBox(
      [0.04, 0.045, 0.23],
      [0, 0.015, 0.41],
      dark,
      this.aimRig,
      "#30383b",
    );
    const muzzle = new T.Object3D();
    muzzle.name = "muzzle";
    muzzle.position.set(0, 0.015, 0.525);
    this.aimRig.add(muzzle);
    this.aimRig.visible = role === "combatant";
    if (role === "combatant") this.showHeldWeapon(0);
    this.group.add(this.aimRig);
    // Pelvis -> spine -> head/shoulders, with independent leg chains.
    this.pelvis.name = "pelvis";
    this.spine.name = "spine";
    this.head.name = "head";
    this.spine.position.y = 0.74;
    for (const child of [...this.group.children]) {
      if (child === this.leftLeg || child === this.rightLeg)
        this.pelvis.add(child);
      else {
        child.position.y -= 0.74;
        this.spine.add(child);
      }
    }
    this.pelvis.add(this.spine);
    this.group.add(this.pelvis);
    for (const [key, value] of Object.entries(this))
      if (value instanceof T.Bone && !value.name) value.name = key;
    if (name) {
      this.nameLabel = label(name, 256, color);
      this.nameLabel.scale.set(0.8, 0.8, 0.8);
      this.nameLabel.position.y = 2.2;
      this.group.add(this.nameLabel);
    }
  }
  setCivilianAction(action: CountyAction) {
    if (this.role === "combatant") return;
    if (action !== this.civilianAction) this.gestureTime = 0;
    this.civilianAction = action;
    this.aimRig.visible = this.role === "police" && action === "shoot";
    if (this.aimRig.visible) this.showHeldWeapon(2);
  }
  finishCarFall(dead: boolean) {
    this.fallTime = dead ? 1 : 0;
    if (dead) this.group.visible = false;
    this.aimRig.visible =
      this.role === "combatant" ||
      (this.role === "police" && this.civilianAction === "shoot");
  }
  react(region: HitRegion = "body", side = 1, damage = 25) {
    this.impactRegion = region;
    this.impactSide = side < 0 ? -1 : 1;
    this.impact = Math.min(
      1,
      this.impact + Math.max(0.35, Math.min(0.8, damage / 50)),
    );
  }
  private reaction?: PunchImpact;
  private reactionAge = 0;
  reactToPunch(reaction: PunchImpact, now: number) {
    if (this.reaction && this.reaction.at >= reaction.at) return;
    this.reaction = reaction;
    this.reactionAge = Math.max(0, (now - reaction.at) / 1000);
    this.impactSide = reaction.side;
  }
  private equipAge = 1;
  private fists = false;
  private fistMove = 0;
  private fistAge = 1;
  private knife?: T.Group;
  setFistPose(
    equipped: boolean,
    move: number,
    age: number,
    knifeEquipped = false,
  ) {
    if (knifeEquipped && equipped && !this.knife) {
      this.knife = buildKnife();
      mountWeaponModel(this.knife, KNIFE, "hand");
      this.knife.rotation.x = 1.35;
      this.leftHand.add(this.knife);
    }
    if (this.knife) this.knife.visible = knifeEquipped && equipped;
    if (equipped && !this.fists) this.equipAge = 0;
    this.fists = equipped;
    this.fistMove = move;
    this.fistAge = age;
    this.aimRig.visible = !equipped;
  }
  fire() {
    this.recoil = Math.min(0.07, this.recoil + 0.05);
  }
  animate(
    t: number,
    speed: number,
    camera: T.Camera,
    pitch = 0,
    dt = 1 / 60,
    dx?: number,
    dz?: number,
    engaged = false,
  ) {
    if (this.fallTime) {
      this.fallTime = 0;
      this.pelvis.rotation.z = 0;
    }
    const step = Math.min(0.1, Math.max(0, dt));
    this.walkSpeed +=
      (Math.min(speed, 12) - this.walkSpeed) * (1 - Math.exp(-step * 16));
    const blend = 1 - Math.exp(-step * 12),
      yaw = this.group.rotation.y;
    const length = Math.hypot(dx ?? 0, dz ?? 0);
    if (length > 0.00001 && dx !== undefined && dz !== undefined) {
      this.forwardWeight +=
        ((dx * Math.sin(yaw) + dz * Math.cos(yaw)) / length -
          this.forwardWeight) *
        blend;
      this.sideWeight +=
        ((dx * Math.cos(yaw) - dz * Math.sin(yaw)) / length - this.sideWeight) *
        blend;
    }
    this.ready += (Number(engaged) - this.ready) * blend;
    const weight = Math.min(this.walkSpeed / 3.5, 1);
    this.stride +=
      this.walkSpeed * step * (2.8 - 0.6 * Math.min(this.walkSpeed / 7, 1));
    const swing = Math.sin(this.stride) * weight,
      lift = Math.cos(this.stride);
    const crouch = 0.18 * this.ready;
    this.leftLeg.rotation.set(
      swing * 0.59 * this.forwardWeight - crouch,
      0,
      swing * 0.43 * this.sideWeight - 0.05 * this.ready,
    );
    this.rightLeg.rotation.set(
      -swing * 0.59 * this.forwardWeight - crouch,
      0,
      -swing * 0.43 * this.sideWeight + 0.05 * this.ready,
    );
    this.leftKnee.rotation.x = Math.max(0, lift) * 0.85 * weight + 2 * crouch;
    this.rightKnee.rotation.x = Math.max(0, -lift) * 0.85 * weight + 2 * crouch;
    this.leftFoot.rotation.set(
      -this.leftLeg.rotation.x - this.leftKnee.rotation.x + 0.18 * swing,
      0,
      -this.leftLeg.rotation.z,
    );
    this.rightFoot.rotation.set(
      -this.rightLeg.rotation.x - this.rightKnee.rotation.x - 0.18 * swing,
      0,
      -this.rightLeg.rotation.z,
    );
    this.pelvis.position.set(
      lift * weight * 0.032,
      -0.026 * weight * lift * lift - 0.032 * this.ready,
      0,
    );
    this.pelvis.rotation.y = swing * 0.12 * this.forwardWeight;
    this.spine.rotation.y = -this.pelvis.rotation.y * 0.85;
    this.spine.rotation.x =
      weight * 0.075 * this.forwardWeight +
      0.055 * this.ready -
      this.recoil * 0.8;
    this.spine.rotation.z = swing * 0.04 - this.sideWeight * weight * 0.075;
    this.recoil *= Math.exp(-step * 18);
    this.aimPitch +=
      (Math.max(-1.2, Math.min(1.2, pitch)) - this.aimPitch) *
      (1 - Math.exp(-step * 24));
    this.head.rotation.x = -this.aimPitch;
    this.head.rotation.z = 0;
    this.aimRig.rotation.x = -this.aimPitch;
    this.aimRig.position.z = 0.12 - this.recoil;
    this.aimRig.position.y =
      0.42 + Math.sin(t * 2.2) * 0.004 + 0.038 * this.ready;
    this.aimRig.updateMatrix();
    if (this.fists) {
      this.equipAge += step;
      for (const [arm, elbow, side] of [
        [this.leftArm, this.leftElbow, -1],
        [this.rightArm, this.rightElbow, 1],
      ] as const) {
        // The avatar faces local +Z, the first-person camera faces -Z.
        const pose = (this.knife?.visible ? knifePose : punchPose)(
          this.fistMove,
          this.fistAge,
          -side,
        );
        const raise = guardRaise(
          this.equipAge,
          -side,
          this.fistMove,
          this.fistAge,
        );
        const height = -0.39 + 0.54 * raise + pose.y,
          reach = 0.085 + 0.125 * raise + pose.z;
        const c = Math.cos(this.aimPitch),
          s = Math.sin(this.aimPitch);
        solveArm(
          arm,
          elbow,
          new T.Vector3(
            side * 0.21 - pose.x,
            arm.position.y + height * c + reach * s,
            reach * c - height * s,
          ),
          new T.Vector3(side * 0.6, -1, -0.2),
        );
        if (side === 1) this.spine.rotation.y += pose.twist;
      }
    } else if (this.role !== "combatant" && !this.aimRig.visible) {
      this.gestureTime += step;
      const drive = Math.sin(Math.min(1, this.gestureTime / 0.46) * Math.PI);
      const punching = this.civilianAction === "melee";
      for (const [arm, elbow, side] of [
        [this.leftArm, this.leftElbow, -1],
        [this.rightArm, this.rightElbow, 1],
      ] as const) {
        if (this.civilianAction === "calling" && side === 1) {
          arm.rotation.set(-0.8, 0, 0.28);
          elbow.rotation.set(-2.1, 0, 0);
          continue;
        }
        const reach = punching && side === 1 ? drive : 0;
        const guard = punching ? 1 : 0;
        arm.rotation.set(
          -0.13 -
            guard * 0.65 -
            reach * 0.77 -
            side * swing * (1 - guard) * 0.58,
          side * reach * 0.12,
          side * (0.1 + guard * 0.07),
        );
        elbow.rotation.set(-0.12 - guard * 0.88 + reach * 0.94, 0, 0);
      }
      this.spine.rotation.y += punching ? drive * 0.26 : 0;
      this.spine.rotation.x += drive * 0.12;
    } else {
      solveArm(
        this.rightArm,
        this.rightElbow,
        new T.Vector3(0, -0.035, 0.03).applyMatrix4(this.aimRig.matrix),
        new T.Vector3(0.45, -1, -0.25),
      );
      solveArm(
        this.leftArm,
        this.leftElbow,
        new T.Vector3(-0.025, -0.025, 0.23).applyMatrix4(this.aimRig.matrix),
        new T.Vector3(-0.5, -1, -0.2),
      );
    }
    // Add a short flinch after the normal pose solve; never alter actor position,
    // aim input, weapon cooldowns, or movement simulation.
    const hit = this.impact,
      side = this.impactSide;
    if (this.impactRegion === "head") {
      this.head.rotation.x -= hit * 0.22;
      this.head.rotation.z += hit * side * 0.17;
      this.spine.rotation.x -= hit * 0.045;
    } else if (this.impactRegion === "body") {
      this.spine.rotation.x -= hit * 0.12;
      this.spine.rotation.z += hit * side * 0.07;
    } else if (this.impactRegion === "arm") {
      const arm = side < 0 ? this.leftArm : this.rightArm;
      arm.rotateZ(hit * side * 0.2);
      this.aimRig.rotation.z = hit * side * 0.045;
    } else {
      const knee = side < 0 ? this.leftKnee : this.rightKnee;
      knee.rotation.x += hit * 0.25;
      this.pelvis.position.y -= hit * 0.025;
    }
    if (this.impactRegion !== "arm") this.aimRig.rotation.z = 0;
    this.impact *= Math.exp(-step * 17);
    if (this.reaction && this.reactionAge < REACTION_SECONDS) {
      this.reactionAge += step;
      const { move, region, lateral, forward, side } = this.reaction;
      const { snap, brace } = reactionWeights(this.reactionAge, move);
      const twist = (move === 2 ? -0.62 : 0.2 * side) + lateral * 0.28;
      const head = region === "head",
        body = region === "body";
      this.spine.rotation.x += snap * (forward * 0.31 + (body ? 0.38 : 0));
      this.spine.rotation.y += snap * twist;
      this.spine.rotation.z -= snap * (lateral * 0.34 + side * 0.12);
      this.head.rotation.x += snap * forward * (head ? 0.44 : 0.16);
      this.head.rotation.z -= snap * (head ? 0.38 : 0.14) * (lateral || side);
      this.pelvis.position.x += brace * lateral * 0.1;
      this.pelvis.position.z += brace * forward * 0.12;
      this.pelvis.position.y -= brace * (region === "leg" ? 0.12 : 0.065);
      const knee = side < 0 ? this.leftKnee : this.rightKnee;
      knee.rotation.x += brace * 0.45;
      const arm = side < 0 ? this.leftArm : this.rightArm;
      arm.rotateX(-brace * (region === "arm" ? 0.65 : 0.34));
    }
    if (this.nameLabel) this.nameLabel.quaternion.copy(camera.quaternion);
    this.group.scale.setScalar(1);
  }
  fall(dt: number) {
    this.fallTime += dt;
    const fold = T.MathUtils.smoothstep(this.fallTime, 0, 0.25);
    const land = T.MathUtils.smoothstep(this.fallTime, 0.12, 0.57);
    this.pelvis.rotation.z = this.impactSide * land * 1.42;
    this.pelvis.position.y = -0.19 * fold + 0.22 * land;
    this.spine.rotation.x = 0.27 * fold;
    this.leftKnee.rotation.x = 1.1 * fold;
    this.rightKnee.rotation.x = 0.68 * fold;
    this.aimRig.rotation.x = 0.55 * fold;
    this.group.visible = this.fallTime < 0.82;
  }
  dispose() {
    disposeGroup(this.group);
  }
}
export function buildWeapon(id: number, county = false) {
  const index = WEAPONS[id].model;
  const g = new T.Group();
  g.name = "weapon-no-hands";
  const paper = inkMaterial(INK, county ? 0.08 : 0, true),
    dark = inkMaterial(INK, county ? 0.16 : 0.45, true);
  if (county) {
    paper.uniforms.uInk.value.set("#253749");
    paper.uniforms.uPaper.value.set(
      ["#598186", "#b77e51", "#64839a", "#849064"][index],
    );
    dark.uniforms.uInk.value.set("#162734");
    dark.uniforms.uPaper.value.set("#455765");
  }
  const box = (
    size: [number, number, number],
    pos: [number, number, number],
    mat = paper,
  ) => outlinedBox(size, pos, mat, g);
  const tube = (
    radius: number,
    length: number,
    x: number,
    y: number,
    z: number,
  ) => {
    const geo = new T.CylinderGeometry(radius, radius, length, 10);
    geo.rotateX(Math.PI / 2);
    const mesh = new T.Mesh(geo, county ? dark : paper);
    mesh.position.set(x, y, z);
    mesh.add(
      new T.LineSegments(
        new T.EdgesGeometry(geo, 35),
        new T.LineBasicMaterial({ color: INK }),
      ),
    );
    g.add(mesh);
  };
  if (id === KNIFE) {
    box([0.055, 0.07, 0.2], [0, 0, 0], dark);
    box([0.12, 0.05, 0.035], [0, 0, -0.105]);
    const blade = new T.Mesh(new T.ConeGeometry(0.065, 0.33, 3), paper);
    blade.rotation.x = -Math.PI / 2;
    blade.position.z = -0.29;
    g.add(blade);
  } else if (isGrenade(id)) {
    const body = new T.Mesh(
      new T.CylinderGeometry(0.078, 0.078, 0.19, 12),
      inkMaterial(id === SMOKE ? "#789080" : "#d3ad58", 0.08),
    );
    g.add(body);
    box([0.09, 0.045, 0.09], [0, 0.11, 0], dark);
    box([0.035, 0.13, 0.04], [0.064, 0.075, 0]);
  } else if (id === ROCKET) {
    tube(0.116, 1.42, 0, -0.035, -0.19);
    box([0.07, 0.2, 0.09], [0, -0.21, 0.02], dark);
  } else if (index === 0) {
    // Slender receiver, separate handguard and barrel, angled magazine, open optic.
    box([0.075, 0.105, 0.34], [0, 0, -0.12]);
    box([0.065, 0.075, 0.34], [0, 0.006, -0.43]);
    tube(0.019, 0.3, 0, 0.018, -0.74);
    tube(0.027, 0.055, 0, 0.018, -0.89);
    box([0.055, 0.065, 0.45], [0, -0.025, 0.3]);
    box([0.062, 0.12, 0.075], [0, -0.055, 0.55]);
    box([0.044, 0.135, 0.068], [0, -0.12, 0.018], dark);
    const mag = outlinedBox([0.045, 0.18, 0.078], [0, -0.12, -0.15], paper, g);
    mag.rotation.x = -0.16;
    mag.name = "magazine";
    for (let i = 0; i < 5; i++)
      box([0.069, 0.012, 0.016], [0, 0.048, -0.32 - i * 0.048], dark);
    if (scopeMagnification(id) !== 1) {
      box([0.085, 0.012, 0.068], [0, 0.079, -0.1]);
      box([0.009, 0.083, 0.016], [-0.038, 0.12, -0.1]);
      box([0.009, 0.083, 0.016], [0.038, 0.12, -0.1]);
      box([0.085, 0.009, 0.016], [0, 0.16, -0.1]);
    }
    box([0.026, 0.012, 0.065], [0.041, 0.008, -0.055], dark).name = "action";
  } else if (index === 1) {
    box([0.084, 0.1, 0.27], [0, 0, -0.055]);
    tube(0.026, 0.74, 0, 0.023, -0.49);
    tube(0.019, 0.58, 0, -0.035, -0.42);
    box([0.085, 0.072, 0.23], [0, -0.04, -0.41]).name = "action";
    const shell = box([0.026, 0.028, 0.075], [0.045, -0.075, -0.08], dark);
    shell.name = "shell";
    shell.visible = false;
    for (let i = 0; i < 5; i++)
      box([0.089, 0.009, 0.012], [0, -0.003, -0.33 - i * 0.04], dark);
    box([0.052, 0.095, 0.48], [0, -0.035, 0.31]);
    box([0.061, 0.14, 0.045], [0, -0.055, 0.56]);
    box([0.022, 0.017, 0.019], [0, 0.06, -0.84], dark);
  } else if (index === 3) {
    box([0.085, 0.09, 0.43], [0, 0, -0.1]);
    tube(0.021, 0.82, 0, 0.015, -0.7);
    tube(0.029, 0.08, 0, 0.015, -1.14);
    box([0.075, 0.075, 0.37], [0, -0.04, -0.4]);
    box([0.06, 0.12, 0.38], [0, -0.05, 0.28]);
    box([0.075, 0.17, 0.055], [0, -0.055, 0.49]);
    box([0.055, 0.16, 0.085], [0, -0.11, 0.04], dark);
    box([0.055, 0.13, 0.12], [0, -0.11, -0.15]).name = "magazine";
    for (const z of [-0.26, -0.02])
      box([0.05, 0.075, 0.04], [0, 0.08, z], dark);
    tube(0.052, 0.38, 0, 0.14, -0.14);
    tube(0.071, 0.1, 0, 0.14, -0.37);
    tube(0.064, 0.07, 0, 0.14, 0.075);
    box([0.12, 0.025, 0.025], [0.075, 0.015, 0.02], dark).name = "action";
    box([0.035, 0.05, 0.035], [0.14, 0, 0.02], dark);
  } else {
    box([0.06, 0.072, 0.25], [0, 0.01, -0.14]).name = "action";
    box([0.042, 0.11, 0.052], [0, -0.16, -0.025], dark).name = "magazine";
    tube(0.015, 0.05, 0, 0.006, -0.28);
    const grip = outlinedBox(
      [0.051, 0.145, 0.073],
      [0, -0.087, -0.025],
      dark,
      g,
    );
    grip.rotation.x = -0.22;
    box([0.02, 0.023, 0.015], [0, 0.054, -0.25], dark);
    for (const x of [-0.024, 0.024])
      box([0.012, 0.024, 0.017], [x, 0.054, -0.035], dark);
    for (let i = 0; i < 4; i++)
      box([0.063, 0.035, 0.006], [0, 0.018, -0.055 - i * 0.016], dark);
  }
  if (id === MAMMOTH) {
    tube(0.041, 0.19, 0, 0.012, -0.31);
    tube(0.048, 0.095, 0, -0.038, -0.14);
  }
  if (id === SMG) {
    box([0.062, 0.07, 0.25], [0, -0.015, 0.12]);
    box([0.045, 0.15, 0.06], [0, -0.09, -0.19], dark);
  }
  if (id === HEAVY_AR) tube(0.041, 0.22, 0, 0.018, -0.72);
  if (id === BURST_AR) box([0.085, 0.07, 0.16], [0, 0.073, -0.13], dark);
  if (id === CARBINE) box([0.085, 0.045, 0.11], [0, -0.07, -0.39], dark);
  const muzzle = new T.Object3D();
  muzzle.name = "muzzle";
  muzzle.position.set(
    0,
    [0.018, 0.023, 0.006, 0.015][index],
    [-0.918, -0.86, -0.305, -1.18][index],
  );
  g.add(muzzle);
  // Fixed, small deviations along every edge: ink wobble, never animated jitter.
  const edges: T.LineSegments[] = [];
  g.traverse((o) => {
    if (o instanceof T.LineSegments) edges.push(o);
  });
  for (const edge of edges) {
    const attribute = edge.geometry.getAttribute("position"),
      points: number[] = [];
    for (let i = 0; i < attribute.count; i += 2) {
      const a = new T.Vector3().fromBufferAttribute(attribute, i),
        b = new T.Vector3().fromBufferAttribute(attribute, i + 1);
      const at = (t: number) =>
        a
          .clone()
          .lerp(b, t)
          .add(
            new T.Vector3(
              Math.sin(t * 19 + i),
              Math.sin(t * 23 + i * 2),
              Math.sin(t * 17 + i * 3),
            ).multiplyScalar(Math.sin(t * Math.PI) * 0.0012),
          );
      for (let j = 0; j < 8; j++)
        points.push(...at(j / 8).toArray(), ...at((j + 1) / 8).toArray());
    }
    const material = new LineMaterial({
      color: county ? "#253749" : INK,
      linewidth: county ? 1 : 2.35,
      alphaToCoverage: true,
    });
    const ink = new LineSegments2(
      new LineSegmentsGeometry().setPositions(points),
      material,
    );
    ink.computeLineDistances();
    edge.parent!.add(ink);
    edge.removeFromParent();
    edge.geometry.dispose();
    (edge.material as T.Material).dispose();
  }
  g.userData.animatedParts = [];
  g.traverse((part) => {
    if (["magazine", "action", "shell"].includes(part.name)) {
      part.userData.restPosition = part.position.clone();
      part.userData.restRotation = part.rotation.clone();
      g.userData.animatedParts.push(part);
    }
  });
  mountWeaponModel(g, id);
  if (scopeMagnification(id) === 1) {
    g.add(reflexSight());
    g.userData.sightHeight = REFLEX_HEIGHT * 0.68;
  }
  if (id === ROCKET) {
    const round = launcherRound();
    g.add(round);
    g.userData.reloadRound = round;
  }
  return g;
}
