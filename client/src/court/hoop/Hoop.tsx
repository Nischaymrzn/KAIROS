import * as D from "../../constants/dimensions";
import { Backboard } from "./Backboard";
import { Rim } from "./Rim";
import { Net } from "./Net";
import { Stanchion } from "./Stanchion";

/**
 * HOOP — composes the four sub-layers (backboard, rim, net, stanchion) into one
 * assembly. Each piece is built in the hoop-local frame (rim centre at the origin)
 * and this group is placed at the basket, so everything stays aligned by
 * construction. Add a second <Hoop end={1}/> later for a full court.
 */
export function Hoop({ end = -1 }: { end?: -1 | 1 }) {
  return (
    <group name="hoop" position={[D.basketX(end), 0, 0]}>
      <Stanchion end={end} />
      <Backboard end={end} />
      <Rim end={end} />
      <Net />
    </group>
  );
}
