import { Hardwood } from "./Hardwood";
import { CourtMarkings } from "./CourtMarkings";
import { Hoop } from "./hoop/Hoop";

/**
 * COURT — the foundation layer, composed of independent sub-layers:
 *   <Hardwood/>       continuous wooden gym floor
 *   <CourtMarkings/>  painted lane + lines (transparent overlay)
 *   <Hoop/>           backboard + rim + net + stanchion at the attacking basket
 *
 * Everything is positioned in the shared feet-from-centre frame (constants/
 * dimensions.ts), so future layers (ball, players, heat-map) drop in as siblings
 * of <Court/> without editing anything here. Never add features by editing a
 * sub-layer — mount a new sibling.
 */
export function Court() {
  return (
    <group name="court">
      <Hardwood />
      <CourtMarkings />
      <Hoop end={-1} />
    </group>
  );
}
