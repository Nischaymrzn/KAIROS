import { useMemo } from "react";
import * as THREE from "three";
import * as D from "../constants/dimensions";
import { COLORS } from "../constants/theme";

/**
 * SEATING STAND — one raked bank of the lower bowl.
 *
 * WHAT THIS REPLACED
 * Solid stepped boxes. Twenty grey slabs climbing away from the floor, which read
 * as a car park ramp rather than a stand: no seats, no aisles, no colour, and
 * nothing at the scale of a person to say how big the room was.
 *
 * WHAT IT IS NOW
 *   • a concrete riser under each row, as before, but darker so the court is the
 *     brightest thing in the building
 *   • ACTUAL SEATS — a pan and a back per seat, drawn as two instanced meshes so
 *     roughly a thousand of them cost two draw calls
 *   • vomitory aisles cut through the rows at intervals, which is most of what
 *     makes a real bowl read as a bowl
 *   • the courtside LED ribbon, and a dark upper wall to close the room
 *
 * Seat colour carries a little per-seat variation. A bank of one flat colour
 * looks printed on; real arenas read as a texture because no two seats catch the
 * light the same way.
 */
export function SeatingStand({
  length,
  rows = D.SEAT_ROWS,
}: { length: number; rows?: number }) {
  const SEAT_W = 1.75;              // ft per seat across
  const AISLE_EVERY = 14;           // seats between vomitory aisles
  const AISLE_W = 2;                // seats' worth of gap

  const { risers, pans, backs, count } = useMemo(() => {
    const risers: { top: number; z: number; even: boolean }[] = [];
    for (let i = 0; i < rows; i++) {
      risers.push({
        top: D.BARRIER_HEIGHT + (i + 1) * D.SEAT_RISE,
        z: i * D.SEAT_RUN + D.SEAT_RUN / 2,
        even: i % 2 === 0,
      });
    }

    // one transform per seat, per part
    const pans: THREE.Matrix4[] = [];
    const backs: THREE.Matrix4[] = [];
    const colours: THREE.Color[] = [];
    const across = Math.floor(length / SEAT_W);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);

    for (let r = 0; r < rows; r++) {
      const y = D.BARRIER_HEIGHT + (r + 1) * D.SEAT_RISE;
      const z = r * D.SEAT_RUN + D.SEAT_RUN * 0.34;
      for (let s = 0; s < across; s++) {
        // leave the aisles empty
        const inBlock = s % (AISLE_EVERY + AISLE_W);
        if (inBlock >= AISLE_EVERY) continue;
        const x = -length / 2 + SEAT_W * (s + 0.5);
        pans.push(m.clone().compose(new THREE.Vector3(x, y + 0.16, z), q, one));
        backs.push(
          m.clone().compose(new THREE.Vector3(x, y + 0.48, z + 0.3), q, one),
        );
        colours.push(new THREE.Color());
      }
    }
    return { risers, pans, backs, count: pans.length };
  }, [length, rows]);

  const bowlDepth = rows * D.SEAT_RUN;
  const topY = D.BARRIER_HEIGHT + rows * D.SEAT_RISE;

  /** per-seat tint so the bank reads as fabric rather than paint */
  const seatColours = useMemo(() => {
    const base = new THREE.Color(COLORS.arena.seat);
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const c = base.clone();
      // deterministic jitter — a re-render must not reshuffle the whole stand
      const n = Math.sin(i * 12.9898) * 43758.5453;
      c.offsetHSL(0, 0, ((n - Math.floor(n)) - 0.5) * 0.085);
      arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
    }
    return arr;
  }, [count]);

  return (
    <group>
      {/* concrete risers */}
      {risers.map((t, i) => (
        <mesh key={i} position={[0, t.top / 2, t.z]} receiveShadow>
          <boxGeometry args={[length, t.top, D.SEAT_RUN]} />
          <meshStandardMaterial
            color={t.even ? COLORS.arena.concrete : COLORS.arena.concreteDark}
            roughness={0.94}
            metalness={0}
          />
        </mesh>
      ))}

      {/* seat pans */}
      <instancedMesh
        args={[undefined as never, undefined as never, count]}
        castShadow
        receiveShadow
        onUpdate={(self: THREE.InstancedMesh) => {
          pans.forEach((mx, i) => self.setMatrixAt(i, mx));
          self.instanceMatrix.needsUpdate = true;
          self.geometry.setAttribute(
            "color", new THREE.InstancedBufferAttribute(seatColours, 3),
          );
        }}
      >
        <boxGeometry args={[1.45, 0.14, 1.15]} />
        <meshStandardMaterial vertexColors roughness={0.82} metalness={0.02} />
      </instancedMesh>

      {/* seat backs */}
      <instancedMesh
        args={[undefined as never, undefined as never, count]}
        castShadow
        onUpdate={(self: THREE.InstancedMesh) => {
          backs.forEach((mx, i) => self.setMatrixAt(i, mx));
          self.instanceMatrix.needsUpdate = true;
          self.geometry.setAttribute(
            "color", new THREE.InstancedBufferAttribute(seatColours, 3),
          );
        }}
      >
        <boxGeometry args={[1.45, 0.78, 0.13]} />
        <meshStandardMaterial vertexColors roughness={0.82} metalness={0.02} />
      </instancedMesh>

      {/* courtside LED ribbon */}
      <mesh position={[0, D.BARRIER_HEIGHT * 0.52, -0.06]}>
        <boxGeometry args={[length, D.BARRIER_HEIGHT * 0.6, 0.3]} />
        <meshStandardMaterial
          color={COLORS.arena.led}
          roughness={0.35}
          metalness={0.15}
          emissive={COLORS.arena.trim}
          emissiveIntensity={1.15}
        />
      </mesh>

      {/* dasher below the ribbon, so the barrier has a base */}
      <mesh position={[0, D.BARRIER_HEIGHT * 0.13, -0.05]} receiveShadow>
        <boxGeometry args={[length, D.BARRIER_HEIGHT * 0.26, 0.34]} />
        <meshStandardMaterial color={COLORS.arena.barrier} roughness={0.7} metalness={0.05} />
      </mesh>

      {/* front rail */}
      <mesh position={[0, D.BARRIER_HEIGHT + 0.55, D.SEAT_RUN * 0.05]}>
        <boxGeometry args={[length, 0.09, 0.09]} />
        <meshStandardMaterial color={COLORS.arena.rail} roughness={0.35} metalness={0.7} />
      </mesh>

      {/* upper wall closing the bowl */}
      <mesh position={[0, topY / 2 + 3, bowlDepth + 0.6]} receiveShadow>
        <boxGeometry args={[length + 2, topY + 10, 1.5]} />
        <meshStandardMaterial color={COLORS.arena.concreteDark} roughness={0.95} metalness={0} />
      </mesh>
    </group>
  );
}
