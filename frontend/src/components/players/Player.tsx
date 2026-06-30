import * as THREE from "three";
import type { Player as PlayerT, ShotTypeId } from "@/lib/types";
import { POSES, type PoseKey } from "@/lib/poses";

const SKIN = ["#e3b78e", "#cd9e72", "#b07e54", "#8a5d3b", "#69432a"];
const HAIR = "#1b1610";
const REF_H = 6.5; // reference build height (ft)

// reference proportions (feet)
const HIP_Y = 3.35;
const HIP_X = 0.3;
const THIGH_LEN = 1.5;
const SHIN_LEN = 1.4;
const SHOULDER_X = 0.66;
const SHOULDER_RY = 1.6; // shoulder height relative to the pelvis pivot
const UPPER_LEN = 1.2;
const FORE_LEN = 1.05;

type V3 = [number, number, number];

interface PlayerProps {
  player: PlayerT;
  position: [number, number];
  facing?: number;
  highlight?: boolean;
  defender?: boolean;
  shotType?: ShotTypeId;
  holdsBall?: boolean;
}

/** Two-segment arm with deltoid, elbow and wrist joints for smooth connections. */
function Arm({
  origin, skin, jersey, shoulder, elbow,
}: {
  origin: V3; skin: string; jersey: string; shoulder: V3; elbow: V3;
}) {
  return (
    <group position={origin} rotation={shoulder}>
      {/* deltoid cap (jersey sleeve edge) */}
      <mesh position={[0, 0, 0]} castShadow>
        <sphereGeometry args={[0.19, 16, 14]} />
        <meshStandardMaterial color={jersey} roughness={0.5} />
      </mesh>
      <mesh position={[0, -UPPER_LEN / 2, 0]} castShadow>
        <capsuleGeometry args={[0.145, UPPER_LEN - 0.3, 10, 16]} />
        <meshStandardMaterial color={skin} roughness={0.58} />
      </mesh>
      {/* elbow joint */}
      <mesh position={[0, -UPPER_LEN, 0]} castShadow>
        <sphereGeometry args={[0.145, 14, 14]} />
        <meshStandardMaterial color={skin} roughness={0.58} />
      </mesh>
      <group position={[0, -UPPER_LEN, 0]} rotation={elbow}>
        <mesh position={[0, -FORE_LEN / 2, 0]} castShadow>
          <capsuleGeometry args={[0.125, FORE_LEN - 0.25, 10, 16]} />
          <meshStandardMaterial color={skin} roughness={0.58} />
        </mesh>
        {/* hand */}
        <mesh position={[0, -FORE_LEN - 0.02, 0.04]} scale={[1, 1.2, 0.72]} castShadow>
          <sphereGeometry args={[0.19, 16, 16]} />
          <meshStandardMaterial color={skin} roughness={0.58} />
        </mesh>
      </group>
    </group>
  );
}

/** Two-segment leg with posable hip + knee. */
function Leg({
  side, skin, shoe, hip, knee,
}: { side: 1 | -1; skin: string; shoe: string; hip: V3; knee: number }) {
  return (
    <group position={[side * HIP_X, HIP_Y, 0]} rotation={hip}>
      <mesh position={[0, -THIGH_LEN / 2, 0]} castShadow>
        <capsuleGeometry args={[0.22, THIGH_LEN - 0.3, 10, 16]} />
        <meshStandardMaterial color={skin} roughness={0.6} />
      </mesh>
      {/* knee joint */}
      <mesh position={[0, -THIGH_LEN, 0]} castShadow>
        <sphereGeometry args={[0.2, 14, 14]} />
        <meshStandardMaterial color={skin} roughness={0.6} />
      </mesh>
      <group position={[0, -THIGH_LEN, 0]} rotation={[knee, 0, 0]}>
        <mesh position={[0, -SHIN_LEN / 2, 0]} castShadow>
          <capsuleGeometry args={[0.17, SHIN_LEN - 0.25, 10, 16]} />
          <meshStandardMaterial color={skin} roughness={0.6} />
        </mesh>
        <mesh position={[0, -SHIN_LEN + 0.02, 0.16]} castShadow>
          <boxGeometry args={[0.42, 0.3, 0.95]} />
          <meshStandardMaterial color={shoe} roughness={0.45} />
        </mesh>
      </group>
    </group>
  );
}

/** Rigged player whose whole body posture reacts to the shot type. */
export function Player({
  player, position, facing = 0, highlight, defender, shotType,
}: PlayerProps) {
  const heightFt = player.heightIn / 12;
  const scale = heightFt / REF_H;
  const jersey = defender ? "#b51e34" : player.jerseyColor;
  const shortsCol = defender ? "#ece5da" : "#eef2f8";
  const skin = SKIN[player.id % SKIN.length];
  const shoe = "#15171c";

  const key: PoseKey = defender ? "defend" : shotType ? shotType : "idle";
  const p = POSES[key];

  return (
    <group position={[position[0], 0, position[1]]} rotation={[0, facing, 0]}>
      <group scale={scale}>
        <group position={[0, p.lift, 0]}>
          {/* legs */}
          <Leg side={-1} skin={skin} shoe={shoe} hip={p.lHip} knee={p.lKnee} />
          <Leg side={1} skin={skin} shoe={shoe} hip={p.rHip} knee={p.rKnee} />

          {/* pelvis + shorts */}
          <mesh position={[0, HIP_Y, 0]} scale={[1, 0.7, 0.85]} castShadow>
            <sphereGeometry args={[0.46, 18, 14]} />
            <meshStandardMaterial color={shortsCol} roughness={0.55} />
          </mesh>
          <mesh position={[0, HIP_Y + 0.05, 0]} castShadow>
            <cylinderGeometry args={[0.47, 0.44, 0.95, 20]} />
            <meshStandardMaterial color={shortsCol} roughness={0.55} />
          </mesh>

          {/* torso pivot — leans with the spine */}
          <group position={[0, HIP_Y, 0]} rotation={p.spine}>
            <mesh position={[0, 0.8, 0]} castShadow>
              <cylinderGeometry args={[0.49, 0.4, 1.7, 22]} />
              <meshStandardMaterial color={jersey} roughness={0.5} />
            </mesh>
            <mesh position={[0, SHOULDER_RY, 0]} scale={[1.35, 0.8, 0.95]} castShadow>
              <sphereGeometry args={[0.5, 20, 16]} />
              <meshStandardMaterial color={jersey} roughness={0.5} />
            </mesh>

            <Arm origin={[-SHOULDER_X, SHOULDER_RY, 0]} skin={skin} jersey={jersey}
              shoulder={p.lShoulder} elbow={p.lElbow} />
            <Arm origin={[SHOULDER_X, SHOULDER_RY, 0]} skin={skin} jersey={jersey}
              shoulder={p.rShoulder} elbow={p.rElbow} />

            <mesh position={[0, 1.85, 0]} castShadow>
              <cylinderGeometry args={[0.15, 0.18, 0.4, 14]} />
              <meshStandardMaterial color={skin} roughness={0.58} />
            </mesh>
            <mesh position={[0, 2.43, 0.02]} scale={[0.92, 1, 0.95]} castShadow>
              <sphereGeometry args={[0.44, 28, 28]} />
              <meshStandardMaterial color={skin} roughness={0.52} />
            </mesh>
            <mesh position={[0, 2.55, -0.04]} scale={[0.96, 0.85, 1.0]} castShadow>
              <sphereGeometry args={[0.45, 22, 22, 0, Math.PI * 2, 0, Math.PI * 0.58]} />
              <meshStandardMaterial color={HAIR} roughness={0.85} />
            </mesh>

            {/* face (front = +Z, toward the basket) */}
            <group position={[0, 2.43, 0]}>
              {/* headband */}
              <mesh position={[0, 0.21, -0.02]} rotation={[Math.PI / 2, 0, 0]} castShadow>
                <torusGeometry args={[0.42, 0.07, 12, 28]} />
                <meshStandardMaterial color={jersey} roughness={0.55} />
              </mesh>
              {/* eyes */}
              {[-0.15, 0.15].map((x) => (
                <group key={x} position={[x, 0.04, 0.37]}>
                  <mesh>
                    <sphereGeometry args={[0.075, 14, 14]} />
                    <meshStandardMaterial color="#f4f1ec" roughness={0.35} />
                  </mesh>
                  <mesh position={[0, 0, 0.05]}>
                    <sphereGeometry args={[0.038, 12, 12]} />
                    <meshStandardMaterial color="#241a12" roughness={0.3} />
                  </mesh>
                </group>
              ))}
              {/* eyebrows */}
              {[-0.15, 0.15].map((x) => (
                <mesh key={x} position={[x, 0.16, 0.39]} rotation={[0.3, 0, 0]}>
                  <boxGeometry args={[0.15, 0.035, 0.05]} />
                  <meshStandardMaterial color={HAIR} roughness={0.8} />
                </mesh>
              ))}
              {/* nose */}
              <mesh position={[0, -0.04, 0.44]} scale={[0.7, 1, 1]}>
                <sphereGeometry args={[0.07, 12, 12]} />
                <meshStandardMaterial color={skin} roughness={0.55} />
              </mesh>
              {/* mouth */}
              <mesh position={[0, -0.18, 0.38]}>
                <boxGeometry args={[0.17, 0.035, 0.04]} />
                <meshStandardMaterial color="#6e4636" roughness={0.6} />
              </mesh>
            </group>
          </group>
        </group>
      </group>

      {/* contact shadow (stays on the floor; fades as the player rises) */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.05, 0]}>
        <circleGeometry args={[(0.85 - p.lift * 0.12) * scale, 28]} />
        <meshBasicMaterial color="#000" transparent opacity={Math.max(0.12, 0.32 - p.lift * 0.12)} />
      </mesh>

      {highlight && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.1, 0]}>
          <ringGeometry args={[1.0, 1.22, 48]} />
          <meshBasicMaterial color="#ff8a4c" transparent opacity={0.95} side={THREE.DoubleSide} />
        </mesh>
      )}
      {defender && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.09, 0]}>
          <ringGeometry args={[0.9, 1.08, 48]} />
          <meshBasicMaterial color="#ef4444" transparent opacity={0.85} side={THREE.DoubleSide} />
        </mesh>
      )}
    </group>
  );
}
