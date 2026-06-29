import { CourtFloor } from "./CourtFloor";
import { Hoop } from "./Hoop";

/** Half court: hardwood floor with markings + the attacking hoop. */
export function Court() {
  return (
    <group>
      <CourtFloor />
      <Hoop end={-1} />
    </group>
  );
}
