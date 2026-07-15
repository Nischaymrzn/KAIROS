/**
 * RIG BUILDER — constructs one player: a standard humanoid THREE.Bone hierarchy
 * (Mixamo naming convention, so future mocap clips retarget cleanly) with the
 * procedural body meshes attached to their bones.
 *
 * Design decision: body parts are BONE-ATTACHED segment meshes with sphere joints
 * rather than a weighted SkinnedMesh. Procedurally-authored skin weights are the
 * classic source of shoulder/hip deformation artifacts; bone-attached segments are
 * guaranteed clean from every camera angle, animate identically (animation = bone
 * rotations), and keep a SkinnedMesh upgrade path open (same bones, same names).
 *
 * Frame: player-local, Y up, feet on y = 0, facing +Z. Every measurement comes
 * from the BodyPlan (config/anthropometry.ts) — no body math in this file.
 */
import * as THREE from "three";
import { PlayerConfig } from "../config/PlayerConfig";
import { solveBody, BodyPlan } from "../config/anthropometry";
import {
  RADIAL, ball, taperedCapsule, smoothLathe,
} from "./geometry";
import { buildHand } from "./hand";
import { buildShoe } from "./shoe";
import { buildSkinnedGeometry, type Node } from "./skinnedBody";
import {
  skinMaterial,
  fabricMaterial,
  shoeMaterial,
  hairMaterial,
  resolveKit,
  numberTexture,
  wordmarkTexture,
} from "../materials/playerMaterials";

export type BoneName =
  | "Hips"
  | "Spine"
  | "Spine1"
  | "Spine2"
  | "Neck"
  | "Head"
  | "LeftShoulder"
  | "LeftArm"
  | "LeftForeArm"
  | "LeftHand"
  | "RightShoulder"
  | "RightArm"
  | "RightForeArm"
  | "RightHand"
  | "LeftUpLeg"
  | "LeftLeg"
  | "LeftFoot"
  | "RightUpLeg"
  | "RightLeg"
  | "RightFoot";

export interface PlayerRig {
  root: THREE.Group;
  bones: Record<BoneName, THREE.Bone>;
  plan: BodyPlan;
  dispose(): void;
  /** GLB characters only: per-bone rest quaternions (harvested from the file's
   *  own idle clip) that poses are composed ON TOP of — fixes T-pose rest. */
  restQuat?: Partial<Record<BoneName, THREE.Quaternion>>;
}

// ---------------------------------------------------------------- geometry utils
//
// The shape vocabulary lives in ./geometry, so mesh density and joint blending
// are tuned in one place rather than per body part. `taperedLimb` keeps its name
// and signature but now runs the authored profile through a curve, which is what
// removes the visible bands down an arm.

function bone(name: BoneName, x: number, y: number, z: number, parent: THREE.Object3D): THREE.Bone {
  const b = new THREE.Bone();
  b.name = name;
  b.position.set(x, y, z);
  parent.add(b);
  return b;
}

// ------------------------------------------------------------------- the builder
export function buildRig(config: PlayerConfig): PlayerRig {
  const plan = solveBody(config.physical);
  const P = plan;
  const kit = resolveKit(config.uniform);

  // ---- materials (owned by this rig; disposed together) ----
  const skin = skinMaterial(config.appearance.skinTone);
  const jersey = fabricMaterial(kit.body, 0.35);
  const trimFab = fabricMaterial(kit.trim, 0.3);
  const shorts = fabricMaterial(kit.body, 0.3);
  const accent = fabricMaterial(config.uniform.accentColor, 0.2);
  const sock = fabricMaterial(config.uniform.sockColor, 0.1);
  const shoe = shoeMaterial(config.uniform.shoeColor);
  const sole = shoeMaterial("#d8dade");
  const hair = hairMaterial(config.appearance.hairColor);
  const beardM = hairMaterial(config.appearance.beardColor);
  const eyeM = new THREE.MeshStandardMaterial({ color: "#1a1512", roughness: 0.25 });
  const numTex = numberTexture(config.uniform.number, kit.trim, kit.body);
  const markTex = wordmarkTexture(config.uniform.teamName, kit.trim);
  const markM = new THREE.MeshBasicMaterial({
    map: markTex, transparent: true, depthWrite: false, toneMapped: false,
  });
  const numM = new THREE.MeshBasicMaterial({ map: numTex, transparent: true, depthWrite: false });
  const owned: (THREE.Material | THREE.Texture)[] = [
    skin, jersey, trimFab, shorts, accent, sock, shoe, sole, hair, beardM, eyeM, numM, numTex,
    markM, markTex,
  ];

  // ---- skeleton (standard humanoid; positions relative to parent) ----
  const root = new THREE.Group();
  root.name = `player:${config.id}`;

  const spine2Y = (P.chestY + P.shoulderY) / 2;
  const hips = bone("Hips", 0, P.hipsY, 0, root);
  const spine = bone("Spine", 0, P.waistY - P.hipsY, 0, hips);
  const spine1 = bone("Spine1", 0, P.chestY - P.waistY, 0, spine);
  const spine2 = bone("Spine2", 0, spine2Y - P.chestY, 0, spine1);
  const neck = bone("Neck", 0, P.neckBaseY - spine2Y, 0, spine2);
  const head = bone("Head", 0, P.headCenterY - P.neckBaseY, 0, neck);

  const armChain = (side: 1 | -1) => {
    const s = side === -1 ? "Left" : "Right";
    const shoulder = bone(`${s}Shoulder` as BoneName, side * P.shoulderHalf * 0.35, P.shoulderY - spine2Y, 0, spine2);
    const arm = bone(`${s}Arm` as BoneName, side * P.shoulderHalf * 0.65, 0, 0, shoulder);
    const fore = bone(`${s}ForeArm` as BoneName, 0, -P.upperArmLen, 0, arm);
    const hand = bone(`${s}Hand` as BoneName, 0, -P.foreArmLen, 0, fore);
    return { shoulder, arm, fore, hand };
  };
  const L = armChain(-1);
  const R = armChain(1);

  const legChain = (side: 1 | -1) => {
    const s = side === -1 ? "Left" : "Right";
    const up = bone(`${s}UpLeg` as BoneName, side * P.hipHalf, 0, 0, hips);
    const low = bone(`${s}Leg` as BoneName, 0, P.kneeY - P.hipsY, 0, up);
    const foot = bone(`${s}Foot` as BoneName, 0, P.ankleY - P.kneeY, 0, low);
    return { up, low, foot };
  };
  const LL = legChain(-1);
  const RL = legChain(1);

  const bones: Record<BoneName, THREE.Bone> = {
    Hips: hips, Spine: spine, Spine1: spine1, Spine2: spine2, Neck: neck, Head: head,
    LeftShoulder: L.shoulder, LeftArm: L.arm, LeftForeArm: L.fore, LeftHand: L.hand,
    RightShoulder: R.shoulder, RightArm: R.arm, RightForeArm: R.fore, RightHand: R.hand,
    LeftUpLeg: LL.up, LeftLeg: LL.low, LeftFoot: LL.foot,
    RightUpLeg: RL.up, RightLeg: RL.low, RightFoot: RL.foot,
  };

  // ---- torso and jersey ----------------------------------------------------
  //
  // A basketball jersey is a TANK. The old torso was one lathe running from the
  // waist to the neck, which is a t-shirt shape: no armholes, no straps, no
  // collar, no hem. The body is now skin from the shoulders down, with the
  // jersey built over it as the garment it actually is, so the armholes read as
  // armholes and the deltoids are bare the way they should be.
  {
    const H0 = 0; // Spine bone origin = waist
    const rise = P.shoulderY - P.waistY;

    // the torso itself, in skin, so anything the jersey does not cover is body
    const bodyProfile: [number, number][] = [
      [P.torsoBotR * 1.02, -0.55],
      [P.torsoBotR, 0],
      [P.torsoTopR * 0.9, 0.5],
      [P.torsoTopR, 0.8],
      [P.torsoTopR * 0.8, 0.98],
      [P.neckR * 1.9, 1.06],
    ];
    const torsoSkin = new THREE.Mesh(
      new THREE.LatheGeometry(
        new THREE.CatmullRomCurve3(
          bodyProfile.map(([r, f]) => new THREE.Vector3(r, H0 + f * rise, 0)),
        ).getPoints(30).map((v) => new THREE.Vector2(Math.max(v.x, 0.001), v.y)),
        RADIAL,
      ),
      skin,
    );
    torsoSkin.scale.z = 0.7; // a chest is an oval, not a circle
    torsoSkin.castShadow = true;
    spine.add(torsoSkin);

    // the jersey shell, slightly proud of the body, stopping at the armholes
    const shellProfile: [number, number][] = [
      [P.torsoBotR * 1.08, -1.05],
      [P.torsoBotR * 1.06, -0.35],
      [P.torsoTopR * 1.02, 0.5],
      [P.torsoTopR * 1.04, 0.8],
      [P.torsoTopR * 0.95, 0.96],
    ];
    const shell = new THREE.Mesh(
      new THREE.LatheGeometry(
        new THREE.CatmullRomCurve3(
          shellProfile.map(([r, f]) => new THREE.Vector3(r, H0 + f * rise, 0)),
        ).getPoints(30).map((v) => new THREE.Vector2(Math.max(v.x, 0.001), v.y)),
        RADIAL,
      ),
      jersey,
    );
    shell.scale.z = 0.76;
    shell.castShadow = true;
    spine.add(shell);

    // shoulder straps, over the trapezius on each side
    for (const sx of [-1, 1]) {
      const strap = taperedCapsule(rise * 0.28, P.torsoTopR * 0.17, P.torsoTopR * 0.2, jersey);
      strap.position.set(sx * P.torsoTopR * 0.72, H0 + rise * 1.06, 0);
      strap.rotation.z = sx * 0.5;
      strap.scale.z = 0.72;
      spine.add(strap);
    }

    // collar and hem, the two rings that make a garment look sewn
    const collar = new THREE.Mesh(
      new THREE.TorusGeometry(P.neckR * 1.5, P.neckR * 0.1, 10, 26), trimFab,
    );
    collar.rotation.x = Math.PI / 2;
    collar.scale.z = 0.8;
    collar.position.y = H0 + rise * 1.02;
    collar.castShadow = true;
    spine.add(collar);

    const hem = new THREE.Mesh(
      new THREE.TorusGeometry(P.torsoBotR * 1.06, P.torsoBotR * 0.055, 8, 30), trimFab,
    );
    hem.rotation.x = Math.PI / 2;
    hem.scale.z = 0.8;
    hem.position.y = H0 - rise * 1.05;
    hem.castShadow = true;
    spine.add(hem);

    // side panel stripe, the trim every kit carries down the ribs
    for (const sx of [-1, 1]) {
      const stripe = taperedCapsule(rise * 1.95, P.torsoBotR * 0.07, P.torsoBotR * 0.055, trimFab);
      stripe.position.set(sx * P.torsoTopR * 0.95, H0 + rise * 0.88, 0);
      stripe.scale.z = 0.5;
      spine.add(stripe);
    }

    // number decals, front and back
    const mkNum = (z: number, size: number, flip: boolean) => {
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(size, size), numM);
      plane.position.set(0, H0 + rise * 0.6, z);
      if (flip) plane.rotation.y = Math.PI;
      spine.add(plane);
    };
    mkNum(P.torsoTopR * 0.8 * 1.05 + 0.03, 0.56, false);
    mkNum(-(P.torsoTopR * 0.8 * 1.05 + 0.03), 0.7, true);

    // Arched team wordmark above the front number. Without it a tank reads as a
    // training bib; this is the one detail that identifies whose jersey it is.
    {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.24), markM);
      w.position.set(0, H0 + rise * 0.83, P.torsoTopR * 0.8 * 1.05 + 0.031);
      spine.add(w);
    }

    // athletic forms under the shell, subtle rather than cartoonish
    for (const sx of [-1, 1]) {
      const pec = ball(P.torsoTopR * 0.4, jersey, 1.05, 0.7, 0.5);
      pec.position.set(sx * P.torsoTopR * 0.34, H0 + rise * 0.7, P.torsoTopR * 0.44);
      spine.add(pec);
    }
    const back = ball(P.torsoTopR * 0.5, jersey, 1.2, 0.9, 0.34);
    back.position.set(0, H0 + rise * 0.55, -P.torsoTopR * 0.36);
    spine.add(back);
    // trapezius wedges, the neck to shoulder slope, in SKIN because the jersey
    // does not reach there on a tank
    for (const sx of [-1, 1]) {
      const trap = ball(P.neckR * 1.05, skin, 1.8, 0.5, 0.8);
      trap.position.set(sx * P.shoulderHalf * 0.36, H0 + rise * 0.95, -0.03);
      trap.rotation.z = sx * 0.25;
      spine.add(trap);
    }
  }

  // ---- pelvis and shorts ---------------------------------------------------
  //
  // The shorts were a cone from the hips to a wide hem, which is a skirt. NBA
  // shorts are a fitted waistband with two distinct legs, cut to just above the
  // knee, and the gap between the legs is most of what reads as shorts rather
  // than a dress.
  {
    const pelvis = ball(P.hipsR, skin, 1.12, 0.85, 0.92);
    pelvis.position.y = -0.06;
    hips.add(pelvis);

    // A straight cylinder here is a bucket with a hard rim at both ends, and at
    // any close range that is exactly what it looked like. Real shorts are fitted
    // at the waist, carry the widest point over the hip bone, and tuck back in
    // before the legs split.
    const seat = smoothLathe(P.shortsLen * 0.62, [
      [P.hipsR * 0.94, 0.0],
      [P.hipsR * 1.06, 0.34],
      [P.hipsR * 1.08, 0.62],
      [P.hipsR * 1.0, 1.0],
    ], shorts);
    seat.position.y = P.shortsLen * 0.04;
    seat.scale.z = 0.92;
    hips.add(seat);

    // waistband, the ring that makes it a garment
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(P.hipsR * 0.95, P.hipsR * 0.065, 10, 30), trimFab,
    );
    band.rotation.x = Math.PI / 2;
    band.scale.z = 0.92;
    band.position.y = P.shortsLen * 0.045;
    band.castShadow = true;
    hips.add(band);
  }

  // ---- neck + head (neck grows UP from its bone, unlike the -Y limb segments) ----
  {
    const neckLen = (P.headCenterY - P.headRadius * 0.9) - P.neckBaseY;
    const nm = new THREE.Mesh(
      new THREE.CylinderGeometry(P.neckR, P.neckR * 1.15, Math.max(neckLen, 0.12), RADIAL),
      skin
    );
    nm.position.y = neckLen / 2;
    nm.castShadow = true;
    neck.add(nm);

    const R = P.headRadius;
    const skull = ball(R, skin, 0.86, 1.04, 0.94);
    head.add(skull);

    // A head reads as a ball until it has a brow and a jaw line. The eyes sat ON
    // the surface like beads before this; recessing them under a brow ridge is
    // what turns a sphere into a face at the distance this is actually viewed
    // from, and it costs four primitives.
    const jaw = ball(R * 0.56, skin, 0.8, 0.7, 0.7);
    jaw.position.set(0, -R * 0.5, R * 0.26);
    head.add(jaw);

    const chin = ball(R * 0.26, skin, 0.72, 0.62, 0.7);
    chin.position.set(0, -R * 0.76, R * 0.42);
    head.add(chin);

    // brow ridge, one shallow bar across both sockets
    const brow = ball(R * 0.42, skin, 1.5, 0.3, 0.42);
    brow.position.set(0, R * 0.24, R * 0.72);
    head.add(brow);

    // cheekbones
    for (const sx of [-1, 1]) {
      const cheek = ball(R * 0.3, skin, 0.72, 0.56, 0.6);
      cheek.position.set(sx * R * 0.46, -R * 0.14, R * 0.56);
      head.add(cheek);

      const ear = ball(R * 0.2, skin, 0.42, 1.05, 0.72);
      ear.position.set(sx * R * 0.86, -R * 0.04, -R * 0.02);
      head.add(ear);

      // the eye sits IN a socket, not on the surface
      const socket = ball(R * 0.19, skin, 1.0, 0.72, 0.5);
      socket.position.set(sx * R * 0.33, R * 0.04, R * 0.7);
      head.add(socket);
      const eye = ball(R * 0.072, eyeM, 1, 0.82, 1);
      eye.position.set(sx * R * 0.33, R * 0.03, R * 0.78);
      head.add(eye);
    }

    // nose: bridge plus tip, rather than one blob
    const bridge = ball(R * 0.12, skin, 0.62, 1.5, 0.8);
    bridge.position.set(0, R * 0.04, R * 0.85);
    head.add(bridge);
    const nose = ball(R * 0.15, skin, 0.72, 0.8, 0.9);
    nose.position.set(0, -R * 0.18, R * 0.9);
    head.add(nose);

    // mouth, a shallow recess rather than a drawn line
    const mouth = ball(R * 0.2, skin, 1.05, 0.28, 0.36);
    mouth.position.set(0, -R * 0.48, R * 0.74);
    head.add(mouth);
    // hair
    const style = config.appearance.hairStyle;
    if (style !== "bald") {
      const r = style === "curly" ? P.headRadius * 1.1 : P.headRadius * 1.02;
      const cap = new THREE.Mesh(
        new THREE.SphereGeometry(r, RADIAL, 12, 0, Math.PI * 2, 0, Math.PI * (style === "short" ? 0.42 : 0.5)),
        hair
      );
      cap.scale.set(0.88, style === "highTop" ? 1.28 : 1.02, 0.95);
      cap.position.y = P.headRadius * (style === "highTop" ? 0.22 : 0.08);
      cap.castShadow = true;
      head.add(cap);
    }
    // beard
    const beard = config.appearance.beard;
    if (beard !== "none") {
      const b = ball(P.headRadius * (beard === "full" ? 0.6 : 0.5), beardM, 0.82, beard === "goatee" ? 0.5 : 0.68, 0.62);
      b.position.set(0, -P.headRadius * 0.55, P.headRadius * 0.3);
      if (beard === "stubble") {
        beardM.transparent = true;
        beardM.opacity = 0.45;
      }
      head.add(b);
    }
    if (config.uniform.headband) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(P.headRadius * 0.92, P.headRadius * 0.92, 0.09, RADIAL), accent);
      band.position.y = P.headRadius * 0.32;
      band.castShadow = true;
      head.add(band);
    }
  }

  // ---- arms ----
  const buildArm = (side: 1 | -1, chain: { arm: THREE.Bone; fore: THREE.Bone; hand: THREE.Bone }) => {
    const s = side === -1 ? "left" : "right";
    const sleeved =
      config.uniform.armSleeve === "both" || config.uniform.armSleeve === (s as "left" | "right");

    // The deltoid ball, the two limb tubes and the elbow ball that used to be
    // built here are now part of the single skinned surface below. They were
    // rigid pieces meeting at a rotating joint, which is what read as a robot.
    void sleeved;
    if (config.uniform.wristbands) {
      const wb = new THREE.Mesh(new THREE.CylinderGeometry(P.wristR * 1.5, P.wristR * 1.5, 0.14, RADIAL), accent);
      wb.position.y = -P.foreArmLen + 0.1;
      wb.castShadow = true;
      chain.fore.add(wb);
    }

    // hand: four fingers of real lengths, three phalanges each, opposed thumb.
    // This was a slab for the palm and a second slab for all four fingers, which
    // on a shooter is the most damaging simplification in the body: the hands are
    // what the eye follows through a release and a follow-through.
    chain.hand.add(buildHand(side, P.handLen, P.wristR, skin, 0.26));

    // wrist joint, blending the forearm into the hand
    const wristBall = ball(P.wristR * 1.02, skin, 1, 0.85, 0.95);
    chain.hand.add(wristBall);
  };
  buildArm(-1, L);
  buildArm(1, R);

  // The deltoid alone bridges the torso to the arm. This briefly had a second
  // shoulder cap here as well, which with the trapezius wedge made three
  // overlapping spheres meeting at one joint and read as a lump rather than a
  // shoulder. One form, sized and placed to span the gap, is the whole job.

  // ---- legs ----
  const buildLeg = (side: 1 | -1, chain: { up: THREE.Bone; low: THREE.Bone; foot: THREE.Bone }) => {
    const s = side === -1 ? "left" : "right";
    const sleeved =
      config.uniform.legSleeve === "both" || config.uniform.legSleeve === (s as "left" | "right");
    void sleeved;   // sleeves ride the skinned surface, see the body build below
    // shorts leg, cut to just above the knee with a trim stripe down the seam
    // Loose at the top where it hangs off the hip, drawn in slightly at the hem,
    // with the hem itself rolled rather than cut flat. A cylinder gave a hard
    // ring at the bottom edge that read as plastic.
    const shortLeg = smoothLathe(P.shortsLen * 1.2, [
      [P.quadR * 1.2, 0.0],
      [P.quadR * 1.26, 0.3],
      [P.quadR * 1.22, 0.72],
      [P.quadR * 1.16, 0.94],
      [P.quadR * 1.02, 1.0],
    ], shorts);
    shortLeg.position.y = 0.05;
    chain.up.add(shortLeg);

    const legHem = new THREE.Mesh(
      new THREE.TorusGeometry(P.quadR * 1.09, P.quadR * 0.045, 8, 26), trimFab,
    );
    legHem.rotation.x = Math.PI / 2;
    legHem.position.y = 0.05 - P.shortsLen * 1.16;
    chain.up.add(legHem);

    const seam = taperedCapsule(P.shortsLen * 1.12, P.quadR * 0.07, P.quadR * 0.055, trimFab);
    seam.position.set(side * P.quadR * 1.2, 0.03, 0);
    seam.scale.z = 0.5;
    chain.up.add(seam);

    // sock (ankle collar) + shoe
    const sockM = new THREE.Mesh(new THREE.CylinderGeometry(P.ankleR * 1.5, P.ankleR * 1.6, 0.5, RADIAL), sock);
    sockM.position.y = 0.18;
    sockM.castShadow = true;
    chain.foot.add(sockM);

    // a real sneaker: outsole, midsole wedge, sculpted upper, and the high collar
    // that is what makes a basketball shoe recognisable at a glance
    chain.foot.add(
      buildShoe(P.footLen, P.footH * 2.1, P.ankleR, -P.ankleY, shoe, sole, accent),
    );
  };
  buildLeg(-1, LL);
  buildLeg(1, RL);

  // ---- the skinned body ------------------------------------------------------
  //
  // Arms and legs as ONE continuous surface weighted to the skeleton, replacing
  // the tube-plus-ball assembly that used to sit on each bone. A rigid tube per
  // segment cannot bend: at the elbow two solids rotated past each other and the
  // covering sphere slid out of the crease, which is visible as a bearing at
  // every joint the moment the camera comes closer than a wide court shot.
  //
  // Built in REST WORLD space and bound afterwards, so the inverse bind matrices
  // are taken from the same pose the rings were swept in.
  {
    root.updateMatrixWorld(true);
    const skeletonBones = Object.values(bones);
    const boneIndex: Record<string, number> = {};
    skeletonBones.forEach((b, i) => { boneIndex[b.name] = i; });

    const wp = (b: THREE.Bone) => b.getWorldPosition(new THREE.Vector3());
    /** point a fraction of the way from a to b */
    const lerpP = (a: THREE.Vector3, b: THREE.Vector3, k: number) =>
      a.clone().lerp(b, k);

    const chains: { nodes: Node[]; capStart?: boolean; capEnd?: boolean }[] = [];

    for (const [side, chain] of [[-1, L], [1, R]] as const) {
      const s = side === -1 ? "Left" : "Right";
      const sleeved = config.uniform.armSleeve === "both"
        || config.uniform.armSleeve === (side === -1 ? "left" : "right");
      const m = sleeved ? 1 : 0;
      const shoulder = wp(chain.arm);
      const elbow = wp(chain.fore);
      const wrist = wp(chain.hand);
      const A = `${s}Arm` as BoneName, F = `${s}ForeArm` as BoneName;
      // The deltoid has to START INSIDE the torso, not at the joint. The arm bone
      // sits a full shoulder-half out from the centreline, which is wider than the
      // chest, so a chain beginning exactly there leaves daylight between body and
      // arm. Pulling the first ring inboard and up buries it in the torso and the
      // shoulder reads continuous.
      const root0 = shoulder.clone();
      root0.x -= side * P.upperArmR * 0.85;
      root0.y += P.upperArmR * 0.5;
      chains.push({
        capStart: true, capEnd: true,
        nodes: [
          { p: root0, rx: P.upperArmR * 1.05, rz: P.upperArmR * 1.1, bone: A, mat: m },
          // deltoid, wider than the arm below it but nothing like a shoulder pad
          { p: lerpP(shoulder, elbow, -0.05), rx: P.upperArmR * 1.24, rz: P.upperArmR * 1.2, bone: A, mat: m },
          { p: lerpP(shoulder, elbow, 0.12), rx: P.upperArmR * 1.06, rz: P.upperArmR, bone: A, mat: m },
          { p: lerpP(shoulder, elbow, 0.4), rx: P.bicepR, rz: P.bicepR * 0.95, bone: A, mat: m },
          { p: lerpP(shoulder, elbow, 0.75), rx: P.bicepR * 0.88, rz: P.bicepR * 0.84, bone: A, mat: m },
          { p: elbow, rx: P.elbowR, rz: P.elbowR * 0.94, bone: F, mat: m },
          { p: lerpP(elbow, wrist, 0.26), rx: P.forePeakR, rz: P.forePeakR * 0.92, bone: F, mat: m },
          { p: lerpP(elbow, wrist, 0.68), rx: P.foreArmR * 0.86, rz: P.foreArmR * 0.8, bone: F, mat: m },
          { p: wrist, rx: P.wristR, rz: P.wristR * 0.82, bone: F, mat: m },
        ],
      });
    }

    for (const [side, chain] of [[-1, LL], [1, RL]] as const) {
      const s = side === -1 ? "Left" : "Right";
      const sleeved = config.uniform.legSleeve === "both"
        || config.uniform.legSleeve === (side === -1 ? "left" : "right");
      const m = sleeved ? 1 : 0;
      const hip = wp(chain.up);
      const knee = wp(chain.low);
      const ankle = wp(chain.foot);
      const U = `${s}UpLeg` as BoneName, K = `${s}Leg` as BoneName;
      chains.push({
        capStart: true, capEnd: true,
        nodes: [
          { p: lerpP(hip, knee, -0.04), rx: P.quadR * 1.02, rz: P.quadR * 1.02, bone: U, mat: m },
          { p: lerpP(hip, knee, 0.3), rx: P.quadR, rz: P.quadR * 0.96, bone: U, mat: m },
          { p: lerpP(hip, knee, 0.68), rx: P.thighR * 0.9, rz: P.thighR * 0.88, bone: U, mat: m },
          { p: knee, rx: P.kneePtR, rz: P.kneePtR * 0.95, bone: K, mat: m },
          { p: lerpP(knee, ankle, 0.26), rx: P.calfPeakR, rz: P.calfPeakR * 1.02, bone: K, mat: m },
          { p: lerpP(knee, ankle, 0.66), rx: P.calfR * 0.8, rz: P.calfR * 0.84, bone: K, mat: m },
          { p: ankle, rx: P.ankleR, rz: P.ankleR * 0.94, bone: K, mat: m },
        ],
      });
    }

    const geo = buildSkinnedGeometry(chains, boneIndex);
    const body = new THREE.SkinnedMesh(geo, [skin, accent]);
    body.name = "body";
    body.castShadow = true;
    body.receiveShadow = true;
    // The bones already hang under `root`; a SkinnedMesh must not re-parent them,
    // so it is added alongside and bound to the existing hierarchy.
    body.add(bones.Hips);
    body.bind(new THREE.Skeleton(skeletonBones));
    root.add(body);
    // geometry is released by the dispose() traverse below, which covers every
    // mesh under root and a SkinnedMesh is one.
  }

  // ---- height ↔ court parity (dev guard) ----
  // The court, rim (10 ft) and player share ONE unit system: config.height in feet
  // must equal the built head-top. headCenterY = H − headRadius·1.05 and the skull
  // scales y by 1.04, so this holds by construction — the guard catches regressions.
  const headTop = P.headCenterY + P.headRadius * 1.04;
  if (Math.abs(headTop - P.height) > 0.05) {
    console.warn(
      `[player] height parity broken: config ${P.height.toFixed(2)} ft vs built ${headTop.toFixed(2)} ft`
    );
  }

  // ---- lifecycle ----
  const dispose = () => {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.geometry?.dispose();
    });
    for (const m of owned) m.dispose();
  };

  return { root, bones, plan, dispose };
}

/**
 * AI / ML HOOK — world position of every joint, in COURT FEET. This is the bridge
 * to the KAIROS models and future AI: e.g. the RightHand/Head heights at release
 * feed the shot-quality features, defender joints give contest geometry, and an
 * AI controller can read (and later drive) the same skeleton it observes.
 */
export function getJointWorldPositions(rig: PlayerRig): Record<BoneName, [number, number, number]> {
  rig.root.updateWorldMatrix(true, true);
  const v = new THREE.Vector3();
  const out = {} as Record<BoneName, [number, number, number]>;
  for (const [name, b] of Object.entries(rig.bones) as [BoneName, THREE.Bone][]) {
    b.getWorldPosition(v);
    out[name] = [v.x, v.y, v.z];
  }
  return out;
}
