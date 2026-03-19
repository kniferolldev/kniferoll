import { expect, test, describe } from "bun:test";
import { encode, decode } from "jpeg-js";
import { rotateImage } from "./rotate";

/** Create a minimal JPEG with distinct pixel colors for testing. */
function createTestJpeg(width: number, height: number): ArrayBuffer {
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      // Assign distinct colors per quadrant for easy verification
      data[idx] = x < width / 2 ? 255 : 0; // R
      data[idx + 1] = y < height / 2 ? 255 : 0; // G
      data[idx + 2] = 0; // B
      data[idx + 3] = 255; // A
    }
  }
  const encoded = encode({ data, width, height }, 100);
  return (encoded.data.buffer as ArrayBuffer).slice(
    encoded.data.byteOffset,
    encoded.data.byteOffset + encoded.data.byteLength,
  );
}

/** Decode a JPEG and return dimensions. */
function getJpegDimensions(data: ArrayBuffer): { width: number; height: number } {
  const img = decode(new Uint8Array(data));
  return { width: img.width, height: img.height };
}

describe("rotateImage", () => {
  const width = 4;
  const height = 6;

  test("0° returns identical data", () => {
    const jpeg = createTestJpeg(width, height);
    const result = rotateImage(jpeg, 0);
    expect(result).toBe(jpeg); // Same reference
  });

  test("90° swaps width and height", () => {
    const jpeg = createTestJpeg(width, height);
    const result = rotateImage(jpeg, 90);
    const dims = getJpegDimensions(result);
    expect(dims.width).toBe(height); // 6
    expect(dims.height).toBe(width); // 4
  });

  test("180° preserves dimensions", () => {
    const jpeg = createTestJpeg(width, height);
    const result = rotateImage(jpeg, 180);
    const dims = getJpegDimensions(result);
    expect(dims.width).toBe(width);
    expect(dims.height).toBe(height);
  });

  test("270° swaps width and height", () => {
    const jpeg = createTestJpeg(width, height);
    const result = rotateImage(jpeg, 270);
    const dims = getJpegDimensions(result);
    expect(dims.width).toBe(height);
    expect(dims.height).toBe(width);
  });

  test("360° rotation (90° × 4) returns original dimensions", () => {
    const jpeg = createTestJpeg(width, height);
    let result = jpeg;
    for (let i = 0; i < 4; i++) {
      result = rotateImage(result, 90);
    }
    const dims = getJpegDimensions(result);
    expect(dims.width).toBe(width);
    expect(dims.height).toBe(height);
  });
});
