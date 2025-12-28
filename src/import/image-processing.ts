/**
 * Image preprocessing utilities for recipe import
 *
 * Uses sharp to preprocess images before sending to LLM APIs.
 * Goal: reduce image size and potentially improve text extraction.
 */

import sharp from "sharp";
import type { ImageProcessingOptions, LoadedImage } from "./types";

/** Model to use for rotation detection. Change this to experiment with different models. */
export const ROTATION_DETECTION_MODEL = "google/gemini-2.5-flash-lite";

/** Valid rotation angles */
export type RotationAngle = 0 | 90 | 180 | 270;

export interface ProcessedImage {
  data: ArrayBuffer;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  originalSize: number;
  processedSize: number;
}

/**
 * Process an image with the given options.
 * Returns the processed image as an ArrayBuffer.
 */
export async function processImage(
  input: ArrayBuffer,
  mimeType: string,
  options: ImageProcessingOptions
): Promise<ProcessedImage> {
  const originalSize = input.byteLength;

  let pipeline = sharp(Buffer.from(input));

  // Resize if max dimensions specified
  if (options.maxWidth || options.maxHeight) {
    pipeline = pipeline.resize({
      width: options.maxWidth,
      height: options.maxHeight,
      fit: "inside",
      withoutEnlargement: true,
    });
  }

  // Convert to grayscale
  if (options.grayscale) {
    pipeline = pipeline.grayscale();
  }

  // Adjust contrast using linear transformation
  // contrast > 1 increases contrast, < 1 decreases
  if (options.contrast && options.contrast !== 1) {
    // sharp uses linear: output = a * input + b
    // For contrast adjustment: a = contrast, b = 128 * (1 - contrast)
    const a = options.contrast;
    const b = 128 * (1 - options.contrast);
    pipeline = pipeline.linear(a, b);
  }

  // Output as JPEG with specified quality
  const quality = options.quality ?? 80;
  const outputBuffer = await pipeline
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();

  return {
    data: outputBuffer.buffer.slice(
      outputBuffer.byteOffset,
      outputBuffer.byteOffset + outputBuffer.byteLength
    ) as ArrayBuffer,
    mimeType: "image/jpeg",
    originalSize,
    processedSize: outputBuffer.byteLength,
  };
}

/**
 * Parse a preprocess options string like "grayscale,contrast=1.5,maxWidth=1024"
 */
export function parsePreprocessOptions(optionsStr: string): ImageProcessingOptions {
  const options: ImageProcessingOptions = {};

  for (const part of optionsStr.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    if (trimmed === "grayscale") {
      options.grayscale = true;
    } else if (trimmed.startsWith("contrast=")) {
      options.contrast = parseFloat(trimmed.slice(9));
    } else if (trimmed.startsWith("maxWidth=")) {
      options.maxWidth = parseInt(trimmed.slice(9), 10);
    } else if (trimmed.startsWith("maxHeight=")) {
      options.maxHeight = parseInt(trimmed.slice(10), 10);
    } else if (trimmed.startsWith("quality=")) {
      options.quality = parseInt(trimmed.slice(8), 10);
    }
  }

  return options;
}

/**
 * Rotate an image by the specified angle (clockwise).
 */
export async function rotateImage(
  input: ArrayBuffer,
  angle: RotationAngle
): Promise<ArrayBuffer> {
  if (angle === 0) {
    return input;
  }

  const buffer = await sharp(Buffer.from(input))
    .rotate(angle)
    .toBuffer();

  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  ) as ArrayBuffer;
}

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
