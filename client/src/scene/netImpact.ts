/**
 * NET IMPACT — one-shot channel telling the net the ball just went through it.
 * ShotArc raises it at the moment the ball crosses the rim plane inside the ring;
 * <Net/> consumes it and runs its swing. Same pattern as focusTracker.
 */
export const netImpact = {
  pending: false,
};
