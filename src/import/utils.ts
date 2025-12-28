/**
 * Utility functions for recipe import
 */

import type { ImageSource, LoadedImage, ResolvedInput, InferenceInput, ImageProcessingOptions } from "./types";
import { processImage } from "./image-processing";

/**
 * Infer MIME type from file extension
 */
function getMimeType(path: string): "image/jpeg" | "image/png" | "image/webp" {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    case "jpg":
    case "jpeg":
    default:
      return "image/jpeg";
  }
}

/**
 * Load a lazy image from disk (CLI environment only)
 *
 * Uses Bun.file() for efficient file reading.
 */
async function loadLazyImage(path: string): Promise<LoadedImage> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`Image file not found: ${path}`);
  }

  const data = await file.arrayBuffer();
  const mimeType = getMimeType(path);

  return { kind: "loaded", data, mimeType };
}

/**
 * Resolve an ImageSource to a LoadedImage
 *
 * If already loaded, returns as-is. If lazy, loads from disk.
 */
export async function resolveImage(source: ImageSource): Promise<LoadedImage> {
  if (source.kind === "loaded") {
    return source;
  }
  return loadLazyImage(source.path);
}

/**
 * Resolve all images in an InferenceInput to loaded form
 *
 * This normalizes the input so providers don't need to handle
 * both loaded and lazy images.
 *
 * @param input - The inference input with text and/or images
 * @param preprocessOptions - Optional image preprocessing options
 */
export async function resolveInput(
  input: InferenceInput,
  preprocessOptions?: ImageProcessingOptions
): Promise<ResolvedInput> {
  const resolved: ResolvedInput = {};

  if (input.text) {
    resolved.text = input.text;
  }

  if (input.images && input.images.length > 0) {
    const loadedImages = await Promise.all(input.images.map(resolveImage));

    if (preprocessOptions && Object.keys(preprocessOptions).length > 0) {
      // Apply preprocessing to each image
      const processedImages = await Promise.all(
        loadedImages.map(async (img) => {
          const processed = await processImage(img.data, img.mimeType, preprocessOptions);
          return {
            data: processed.data,
            mimeType: processed.mimeType,
          };
        })
      );
      resolved.images = processedImages;
    } else {
      resolved.images = loadedImages.map((img) => ({
        data: img.data,
        mimeType: img.mimeType,
      }));
    }
  }

  return resolved;
}

/**
 * Convert an ArrayBuffer to base64 string
 *
 * Works in both browser and Node.js environments.
 */
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  // In Node.js/Bun environment
  if (typeof Buffer !== "undefined") {
    return Buffer.from(buffer).toString("base64");
  }

  // In browser environment
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

/**
 * Convert a Blob to a LoadedImage
 *
 * Useful for browser environments where images come as Blobs.
 */
export async function blobToLoadedImage(blob: Blob): Promise<LoadedImage> {
  const data = await blob.arrayBuffer();
  const mimeType = (blob.type || "image/jpeg") as LoadedImage["mimeType"];
  return { kind: "loaded", data, mimeType };
}
