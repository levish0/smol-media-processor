import { describe, expect, test } from "bun:test";
import sharp from "sharp";
import { MediaProcessingError } from "./errors";
import { processImage, type ImageOptions } from "./image";

const options: ImageOptions = {
  maxInputBytes: 1024 * 1024,
  maxOutputBytes: 1024 * 1024,
  maxPixels: 1_000_000,
  maxPages: 10,
  timeoutSeconds: 10,
  webpQuality: 85,
  webpEffort: 0,
};

function expectSanitizedWebp(
  output: Awaited<ReturnType<typeof processImage>>,
  width: number,
  height: number,
) {
  expect(output.kind).toBe("image");
  expect(output.mimeType).toBe("image/webp");
  expect(output.extension).toBe("webp");
  expect(output.width).toBe(width);
  expect(output.height).toBe(height);
  expect(output.size).toBe(output.bytes.length);
}

async function createFrame(background: string): Promise<Buffer> {
  return sharp({
    create: {
      width: 2,
      height: 1,
      channels: 4,
      background,
    },
  })
    .png()
    .toBuffer();
}

async function createAnimatedGif(
  delay = [100, 100],
  loop = 0,
): Promise<Buffer> {
  const frame1 = await createFrame("#ff0000");
  const frame2 = await createFrame("#00ff00");

  return sharp([frame1, frame2], { join: { animated: true } })
    .gif({ delay, loop })
    .toBuffer();
}

async function createAnimatedWebp(
  delay = [80, 120],
  loop = 0,
): Promise<Buffer> {
  const frame1 = await createFrame("#ff0000");
  const frame2 = await createFrame("#0000ff");

  return sharp([frame1, frame2], { join: { animated: true } })
    .webp({ delay, loop })
    .toBuffer();
}

function readImageDefaultsFromEnv(env: Record<string, string>) {
  const script =
    'import { imageDefaults } from "./src/image.ts"; console.log(JSON.stringify(imageDefaults));';
  const result = Bun.spawnSync({
    cmd: [process.execPath, "-e", script],
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });

  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString());
  }

  return JSON.parse(result.stdout.toString()) as ImageOptions;
}

describe("processImage", () => {
  test("converts PNG input to sanitized WebP", async () => {
    const input = await sharp({
      create: {
        width: 4,
        height: 3,
        channels: 4,
        background: "#ff6600",
      },
    })
      .png()
      .toBuffer();

    const output = await processImage(input, options);
    const metadata = await sharp(output.bytes, { animated: true }).metadata();

    expectSanitizedWebp(output, 4, 3);
    expect(output.animated).toBe(false);
    expect(output.pages).toBe(1);
    expect(metadata.format).toBe("webp");
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
  });

  test("converts JPEG input to WebP", async () => {
    const input = await sharp({
      create: {
        width: 5,
        height: 4,
        channels: 3,
        background: "#55aa11",
      },
    })
      .jpeg()
      .toBuffer();

    const output = await processImage(input, options);

    expectSanitizedWebp(output, 5, 4);
    expect(output.animated).toBe(false);
    expect(output.pages).toBe(1);
  });

  test("accepts existing WebP and emits WebP", async () => {
    const input = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 3,
        background: "#336699",
      },
    })
      .webp()
      .toBuffer();

    const output = await processImage(input, options);

    expectSanitizedWebp(output, 2, 2);
  });

  test("converts animated WebP and preserves animation metadata", async () => {
    const input = await createAnimatedWebp([80, 120], 3);

    const output = await processImage(input, options);
    const metadata = await sharp(output.bytes, { animated: true }).metadata();

    expectSanitizedWebp(output, 2, 1);
    expect(output.animated).toBe(true);
    expect(output.pages).toBe(2);
    expect(metadata.pages).toBe(2);
    expect(metadata.delay).toEqual([80, 120]);
    expect(metadata.loop).toBe(3);
  });

  test("accepts GIF input and emits WebP", async () => {
    const input = Buffer.from(
      "R0lGODlhAQABAIAAAP8AAP///yH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==",
      "base64",
    );

    const output = await processImage(input, options);

    expectSanitizedWebp(output, 1, 1);
  });

  test("converts animated GIF and reports animation metadata", async () => {
    const input = await createAnimatedGif([100, 150], 2);

    const output = await processImage(input, options);
    const metadata = await sharp(output.bytes, { animated: true }).metadata();

    expectSanitizedWebp(output, 2, 1);
    expect(output.animated).toBe(true);
    expect(output.pages).toBe(2);
    expect(metadata.delay).toEqual([100, 150]);
    expect(metadata.loop).toBe(2);
  });

  test("rejects empty input", async () => {
    await expect(processImage(Buffer.alloc(0), options)).rejects.toMatchObject({
      status: 400,
      code: "empty_file",
    });
  });

  test("rejects unsupported SVG input", async () => {
    const input = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
    );

    await expect(processImage(input, options)).rejects.toMatchObject({
      status: 415,
      code: "unsupported_format",
    });
  });

  test("rejects inputs that exceed the max input size", async () => {
    await expect(
      processImage(Buffer.alloc(options.maxInputBytes + 1), options),
    ).rejects.toMatchObject({
      status: 413,
      code: "input_too_large",
    });
  });

  test("rejects invalid image bytes", async () => {
    await expect(
      processImage(Buffer.from("not-an-image"), options),
    ).rejects.toMatchObject({
      status: 400,
      code: "invalid_image",
    });
  });

  test("strips EXIF metadata from JPEG input", async () => {
    const input = await sharp({
      create: {
        width: 6,
        height: 4,
        channels: 3,
        background: "#2266cc",
      },
    })
      .withExif({ IFD0: { Make: "TestCam", Model: "SharpFixture" } })
      .jpeg()
      .toBuffer();

    const output = await processImage(input, options);
    const metadata = await sharp(output.bytes).metadata();

    expectSanitizedWebp(output, 6, 4);
    expect(metadata.exif).toBeUndefined();
  });

  test("applies EXIF orientation before stripping metadata", async () => {
    const input = await sharp({
      create: {
        width: 3,
        height: 5,
        channels: 3,
        background: "#abcdef",
      },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();

    const output = await processImage(input, options);
    const metadata = await sharp(output.bytes).metadata();

    expectSanitizedWebp(output, 5, 3);
    expect(metadata.orientation).toBeUndefined();
    expect(metadata.exif).toBeUndefined();
  });

  test("strips ICC profile from PNG input", async () => {
    const input = await sharp({
      create: {
        width: 4,
        height: 4,
        channels: 3,
        background: "#ff0000",
      },
    })
      .withMetadata({ icc: "srgb" })
      .png()
      .toBuffer();

    const output = await processImage(input, options);
    const metadata = await sharp(output.bytes).metadata();

    expectSanitizedWebp(output, 4, 4);
    expect(metadata.icc).toBeUndefined();
  });

  test("preserves PNG transparency", async () => {
    const input = await sharp({
      create: {
        width: 1,
        height: 1,
        channels: 4,
        background: { r: 255, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();

    const output = await processImage(input, options);
    const metadata = await sharp(output.bytes).metadata();
    const raw = await sharp(output.bytes).ensureAlpha().raw().toBuffer();

    expectSanitizedWebp(output, 1, 1);
    expect(metadata.hasAlpha).toBe(true);
    expect(raw[3]).toBe(0);
  });

  test("rejects oversized output", async () => {
    const input = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 3,
        background: "#00aa00",
      },
    })
      .jpeg()
      .toBuffer();

    await expect(
      processImage(input, { ...options, maxOutputBytes: 1 }),
    ).rejects.toMatchObject({
      status: 413,
      code: "output_too_large",
    });
  });

  test("uses structured processor errors", async () => {
    const error = new MediaProcessingError(400, "example", "Example");

    expect(error.name).toBe("MediaProcessingError");
    expect(error.status).toBe(400);
    expect(error.code).toBe("example");
  });

  test("rejects images that exceed the pixel limit", async () => {
    const input = await sharp({
      create: {
        width: 2000,
        height: 2000,
        channels: 3,
        background: "#ffffff",
      },
    })
      .png()
      .toBuffer();

    await expect(
      processImage(input, { ...options, maxPixels: 1_000_000 }),
    ).rejects.toMatchObject({
      status: 413,
      code: "too_many_pixels",
    });
  });

  test("rejects image one pixel over the limit", async () => {
    const input = await sharp({
      create: {
        width: 1001,
        height: 1000,
        channels: 3,
        background: "#ffffff",
      },
    })
      .png()
      .toBuffer();

    await expect(
      processImage(input, { ...options, maxPixels: 1_000_000 }),
    ).rejects.toMatchObject({
      status: 413,
      code: "too_many_pixels",
    });
  });

  test("accepts image exactly at the pixel limit", async () => {
    const input = await sharp({
      create: {
        width: 1000,
        height: 1000,
        channels: 3,
        background: "#123456",
      },
    })
      .png()
      .toBuffer();

    const output = await processImage(input, options);

    expectSanitizedWebp(output, 1000, 1000);
  });

  test("accepts animated image exactly at maxPages", async () => {
    const input = await createAnimatedGif();

    const output = await processImage(input, { ...options, maxPages: 2 });

    expectSanitizedWebp(output, 2, 1);
    expect(output.animated).toBe(true);
    expect(output.pages).toBe(2);
  });

  test("rejects animated image exceeding maxPages", async () => {
    const input = await createAnimatedGif();

    await expect(
      processImage(input, { ...options, maxPages: 1 }),
    ).rejects.toMatchObject({
      status: 413,
      code: "too_many_frames",
    });
  });
});

describe("imageDefaults", () => {
  test("uses strict integer environment parsing and clamps bounded values", () => {
    const parsed = readImageDefaultsFromEnv({
      MAX_INPUT_BYTES: "12px",
      MAX_OUTPUT_BYTES: "42",
      MAX_PIXELS: "0",
      MAX_PAGES: "2abc",
      PROCESSING_TIMEOUT_SECONDS: "15.9",
      WEBP_QUALITY: "150",
      WEBP_EFFORT: "-2",
    });

    expect(parsed.maxInputBytes).toBe(10 * 1024 * 1024);
    expect(parsed.maxOutputBytes).toBe(42);
    expect(parsed.maxPixels).toBe(32_000_000);
    expect(parsed.maxPages).toBe(300);
    expect(parsed.timeoutSeconds).toBe(20);
    expect(parsed.webpQuality).toBe(100);
    expect(parsed.webpEffort).toBe(0);
  });
});
