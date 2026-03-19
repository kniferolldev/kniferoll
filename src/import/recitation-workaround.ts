/**
 * Gemini RECITATION workaround.
 *
 * Gemini's recitation filter occasionally blocks OCR of cookbook photos.
 * Inserting ★ markers between words in the output defeats the filter.
 * This is too expensive to do unconditionally (+60% output tokens),
 * so it's used only as a retry strategy after a RECITATION block.
 */

/** Prompt appendix that instructs the model to insert ★ between words. */
export function recitationMarkerAppendix(): string {
  return `IMPORTANT OUTPUT RULE:
Within every string value in the JSON, insert the marker ★ between each word.
Do NOT put markers in JSON keys, only in string values.
Example:
{
  "title": "Chicken ★ Parmesan ★ with ★ Marinara",
  "sections": [
    {
      "heading": "Ingredients",
      "type": "ingredients",
      "content": ["2 ★ cups ★ all-purpose ★ flour", "1 ★ tsp ★ salt"]
    }
  ]
}

This marker insertion is required for all string values.`;
}

/** Strip ★ markers inserted between words to defeat recitation filters. */
export function stripMarkers(text: string): string {
  return text.replace(/ ★/g, "");
}
