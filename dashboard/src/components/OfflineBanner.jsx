import { useEffect, useState } from "react";
import { onConnectionChange } from "../api";

/**
 * Shown whenever any API call has fallen back to mock data.
 *
 * The fallback exists so the UI always renders, but it once hid a wrong URL for
 * weeks: the Daily Challenge served a fixed 41.2% and nothing looked broken.
 * A mock result must never be mistakable for a model output, so this sits above
 * the page content rather than as a subtle badge.
 */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);
  useEffect(() => onConnectionChange(setOffline), []);

  if (!offline) return null;
  return (
    <div
      role="status"
      className="mb-4 rounded-lg border border-accent-amber/50 bg-accent-amber/10 px-4 py-2.5
                 text-sm text-accent-amber flex items-center gap-2"
    >
      <span className="font-semibold">Running in offline mode</span>
      <span className="text-txt-secondary">— predictions are illustrative only.</span>
    </div>
  );
}
