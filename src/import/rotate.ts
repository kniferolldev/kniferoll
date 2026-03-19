/**
 * Pure JS image rotation using jpeg-js.
 * No native dependencies — works in Cloudflare Workers, Node, and Bun.
 */

import { decode, encode } from "jpeg-js";
import type { RotationAngle } from "./rotation-prompt";

export type { RotationAngle };

/**
 * Rotate a JPEG image by the specified angle (clockwise).
 * Returns the rotated JPEG as an ArrayBuffer.
 */
export function rotateImage(data: ArrayBuffer, angle: RotationAngle): ArrayBuffer {
  if (angle === 0) return data;

  const image = decode(new Uint8Array(data));
  const { width, height, data: pixels } = image;

  const swap = angle === 90 || angle === 270;
  const newWidth = swap ? height : width;
  const newHeight = swap ? width : height;
  const newPixels = new Uint8Array(newWidth * newHeight * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      let dstX: number, dstY: number;
      if (angle === 90) { dstX = height - 1 - y; dstY = x; }
      else if (angle === 180) { dstX = width - 1 - x; dstY = height - 1 - y; }
      else { dstX = y; dstY = width - 1 - x; } // 270
      const dstIdx = (dstY * newWidth + dstX) * 4;
      newPixels[dstIdx] = pixels[srcIdx]!;
      newPixels[dstIdx + 1] = pixels[srcIdx + 1]!;
      newPixels[dstIdx + 2] = pixels[srcIdx + 2]!;
      newPixels[dstIdx + 3] = pixels[srcIdx + 3]!;
    }
  }

  const encoded = encode({ data: newPixels, width: newWidth, height: newHeight }, 80);
  return (encoded.data.buffer as ArrayBuffer).slice(
    encoded.data.byteOffset,
    encoded.data.byteOffset + encoded.data.byteLength,
  );
}
