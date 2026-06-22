import sharp from "sharp";
import { MediaProcessingError } from "./errors";
import { readBoundedInt, readPositiveInt } from "./env";
import type { ProcessedMediaBase } from "./types";

const SUPPORTED_FORMATS = new Set(["jpeg", "png", "gif", "webp"]);

export type ProcessedImage = ProcessedMediaBase & {
  kind: "image";
  mimeType: "image/webp";
  extension: "webp";
  animated: boolean;
  pages: number;
};

export type ImageOptions = {
  maxInputBytes: number;
  maxOutputBytes: number;
  maxPixels: number;
  maxPages: number;
  timeoutSeconds: number;
  webpQuality: number;
  webpEffort: number;
};

export const imageDefaults: ImageOptions = {
  maxInputBytes: readPositiveInt("MAX_INPUT_BYTES", 10 * 1024 * 1024),
  maxOutputBytes: readPositiveInt("MAX_OUTPUT_BYTES", 10 * 1024 * 1024),
  maxPixels: readPositiveInt("MAX_PIXELS", 32_000_000),
  maxPages: readPositiveInt("MAX_PAGES", 300),
  timeoutSeconds: readPositiveInt("PROCESSING_TIMEOUT_SECONDS", 20),
  webpQuality: readBoundedInt("WEBP_QUALITY", 85, 1, 100),
  webpEffort: readBoundedInt("WEBP_EFFORT", 4, 0, 6),
};

export async function processImage(
  input: Buffer,
  options = imageDefaults,
): Promise<ProcessedImage> {
  if (input.length === 0) {
    throw new MediaProcessingError(400, "empty_file", "Empty file");
  }

  if (input.length > options.maxInputBytes) {
    throw new MediaProcessingError(
      413,
      "input_too_large",
      "Input file is too large",
    );
  }

  const source = createInputImage(input, options);

  const metadata = await source.metadata().catch((error: unknown) => {
    throw normalizeSharpError(error, {
      fallbackStatus: 400,
      fallbackCode: "invalid_image",
      fallbackMessage: "Cannot read image metadata",
    });
  });

  if (!metadata.format || !SUPPORTED_FORMATS.has(metadata.format)) {
    throw new MediaProcessingError(
      415,
      "unsupported_format",
      `Unsupported image format: ${metadata.format ?? "unknown"}`,
    );
  }

  const pages = metadata.pages ?? 1;
  if (pages > options.maxPages) {
    throw new MediaProcessingError(
      413,
      "too_many_frames",
      "Animated image has too many frames",
    );
  }

  // Read source metadata only to preserve animation behavior and validate limits.
  // Sharp's default output behavior strips source EXIF/ICC metadata.
  const output = await createInputImage(input, options)
    .rotate()
    .webp({
      quality: options.webpQuality,
      effort: options.webpEffort,
      loop: metadata.loop,
      delay: metadata.delay,
      force: true,
    })
    .timeout({ seconds: options.timeoutSeconds })
    .toBuffer({ resolveWithObject: true })
    .catch((error: unknown) => {
      throw normalizeSharpError(error, {
        fallbackStatus: 422,
        fallbackCode: "processing_failed",
        fallbackMessage: "Failed to process image",
      });
    });

  if (output.data.length > options.maxOutputBytes) {
    throw new MediaProcessingError(
      413,
      "output_too_large",
      "Processed image is too large",
    );
  }

  const outputPages = output.info.pages ?? pages;
  const animated = outputPages > 1;

  return {
    kind: "image",
    bytes: output.data,
    mimeType: "image/webp",
    extension: "webp",
    width: output.info.width,
    height: output.info.pageHeight ?? output.info.height,
    size: output.data.length,
    animated,
    pages: outputPages,
  };
}

type SharpErrorFallback = {
  fallbackStatus: number;
  fallbackCode: string;
  fallbackMessage: string;
};

function normalizeSharpError(
  error: unknown,
  fallback: SharpErrorFallback,
): MediaProcessingError {
  if (error instanceof MediaProcessingError) {
    return error;
  }

  if (isSharpPixelLimitError(error)) {
    return new MediaProcessingError(
      413,
      "too_many_pixels",
      "Image exceeds the maximum pixel limit",
    );
  }

  if (isSharpTimeoutError(error)) {
    return new MediaProcessingError(
      408,
      "processing_timeout",
      "Image processing timed out",
    );
  }

  return new MediaProcessingError(
    fallback.fallbackStatus,
    fallback.fallbackCode,
    fallback.fallbackMessage,
  );
}

function isSharpPixelLimitError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.toLowerCase().includes("pixel limit")
  );
}

function isSharpTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error && error.message.toLowerCase().includes("timeout")
  );
}

function createInputImage(input: Buffer, options: ImageOptions): sharp.Sharp {
  return sharp(input, {
    animated: true,
    pages: -1,
    limitInputPixels: options.maxPixels,
  });
}
