/**
 * The water bottle, in rig units (metres). Origin = where the hand grips it,
 * +Y points from the bottom to the cap. Shared by the procedural generator
 * (which aims the cap at the mouth when drinking) and the runtime prop.
 * Slightly oversized on purpose: the characters have big, stylized heads.
 */
const S = 1.2;

export const BOTTLE = {
  bottom: -0.105 * S,
  radius: 0.04 * S,
  shoulderY: 0.052 * S,
  neckRadius: 0.019 * S,
  neckTop: 0.11 * S,
  capTop: 0.136 * S,
  waterBottom: -0.1 * S,
  waterTop: 0.05 * S, // water surface when full
  /** Grip point relative to the procedural rig's Hand_R bone (inward, down, forward). */
  socket: [0.028, -0.064, 0.034] as [number, number, number],
};

/** How much of a full bottle one drink empties. */
export const SIP_AMOUNT = 0.35;
