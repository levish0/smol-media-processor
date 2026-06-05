import sharp from "sharp";

const SUPPORTED_FORMATS = new Set(["jpeg", "png", "gif", "webp"]);

export type ProcessedImage = {
  bytes: Buffer;
  mimeType: "image/webp";
  extension: "webp";
  width: number;
  height: number;
  size: number;
  animated: boolean;
  pages: number;
};

export class ImageProcessingError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ImageProcessingError";
    this.status = status;
    this.code = code;
  }
}

export type ProcessorOptions = {
  maxInputBytes: number;
  maxOutputBytes: number;
  maxPixels: number;
  maxPages: number;
  timeoutSeconds: number;
  webpQuality: number;
  webpEffort: number;
};

export const defaultOptions: ProcessorOptions = {
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
  options = defaultOptions,
): Promise<ProcessedImage> {
  if (input.length === 0) {
    throw new ImageProcessingError(400, "empty_file", "Empty file");
  }

  if (input.length > options.maxInputBytes) {
    throw new ImageProcessingError(
      413,
      "input_too_large",
      "Input file is too large",
    );
  }

  const source = sharp(input, {
    animated: true,
    pages: -1,
    limitInputPixels: options.maxPixels,
  });

  const metadata = await source.metadata().catch((error: unknown) => {
    throw normalizeSharpError(error, {
      fallbackStatus: 400,
      fallbackCode: "invalid_image",
      fallbackMessage: "Cannot read image metadata",
    });
  });

  if (!metadata.format || !SUPPORTED_FORMATS.has(metadata.format)) {
    throw new ImageProcessingError(
      415,
      "unsupported_format",
      `Unsupported image format: ${metadata.format ?? "unknown"}`,
    );
  }

  const pages = metadata.pages ?? 1;
  if (pages > options.maxPages) {
    throw new ImageProcessingError(
      413,
      "too_many_frames",
      "Animated image has too many frames",
    );
  }

  const output = await sharp(input, {
    animated: true,
    pages: -1,
    limitInputPixels: options.maxPixels,
  })
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
    throw new ImageProcessingError(
      413,
      "output_too_large",
      "Processed image is too large",
    );
  }

  const outputPages = output.info.pages ?? pages;
  const animated = outputPages > 1;

  return {
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
): ImageProcessingError {
  if (error instanceof ImageProcessingError) {
    return error;
  }

  if (isSharpPixelLimitError(error)) {
    return new ImageProcessingError(
      413,
      "too_many_pixels",
      "Image exceeds the maximum pixel limit",
    );
  }

  if (isSharpTimeoutError(error)) {
    return new ImageProcessingError(
      408,
      "processing_timeout",
      "Image processing timed out",
    );
  }

  return new ImageProcessingError(
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

function readPositiveInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function readBoundedInt(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}
