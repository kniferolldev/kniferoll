/** Model to use for rotation detection. */
export const ROTATION_DETECTION_MODEL = "google/gemini-2.5-flash-lite";

/** Valid rotation angles */
export type RotationAngle = 0 | 90 | 180 | 270;

/**
 * Build the prompt for rotation detection.
 */
export function buildRotationDetectionPrompt(): string {
  return `Look at this image of a recipe or document. Is the text rotated or sideways?

Reply with ONLY a single number:
- 0 if text is already upright (readable normally)
- 90 if text needs to be rotated 90 degrees clockwise to be upright
- 180 if text is upside down
- 270 if text needs to be rotated 270 degrees clockwise (or 90 counter-clockwise) to be upright

Just the number, nothing else.`;
}
