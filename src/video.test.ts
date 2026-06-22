import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processVideo, type VideoOptions } from "./video";

const options: VideoOptions = {
  maxInputBytes: 50 * 1024 * 1024,
  maxOutputBytes: 50 * 1024 * 1024,
  maxDurationSeconds: 10,
  maxDimension: 1920,
  timeoutSeconds: 60,
  crf: 30,
  preset: "ultrafast",
  audioBitrateKbps: 96,
};

type CreateVideoOptions = {
  duration?: number;
  width?: number;
  height?: number;
  audio?: boolean;
  container?: "mp4" | "avi";
  title?: string;
};

function createTestVideo(opts: CreateVideoOptions = {}): Buffer {
  const {
    duration = 1,
    width = 320,
    height = 240,
    audio = true,
    container = "mp4",
    title,
  } = opts;

  const out = join(tmpdir(), `smp-test-${randomUUID()}.${container}`);
  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    `testsrc=duration=${duration}:size=${width}x${height}:rate=15`,
    ...(audio
      ? ["-f", "lavfi", "-i", `sine=frequency=440:duration=${duration}`]
      : []),
  ];

  if (container === "mp4") {
    args.push(
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      ...(audio ? ["-c:a", "aac"] : []),
    );
  } else {
    args.push("-c:v", "mpeg4", ...(audio ? ["-c:a", "mp3"] : []));
  }

  if (title) {
    args.push("-metadata", `title=${title}`);
  }

  args.push(out);

  const result = Bun.spawnSync(["ffmpeg", ...args]);
  if (result.exitCode !== 0) {
    throw new Error(result.stderr.toString());
  }

  const buffer = readFileSync(out);
  unlinkSync(out);
  return buffer;
}

function probe(buffer: Buffer): {
  format?: { format_name?: string; tags?: Record<string, string> };
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
  }>;
} {
  const path = join(tmpdir(), `smp-probe-${randomUUID()}.bin`);
  writeFileSync(path, buffer);
  try {
    const result = Bun.spawnSync([
      "ffprobe",
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      path,
    ]);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr.toString());
    }
    return JSON.parse(result.stdout.toString());
  } finally {
    unlinkSync(path);
  }
}

describe("processVideo", () => {
  test("transcodes MP4 with audio to sanitized MP4", async () => {
    const input = createTestVideo({ width: 320, height: 240, audio: true });

    const output = await processVideo(input, options);
    const meta = probe(output.bytes);

    expect(output.kind).toBe("video");
    expect(output.mimeType).toBe("video/mp4");
    expect(output.extension).toBe("mp4");
    expect(output.width).toBe(320);
    expect(output.height).toBe(240);
    expect(output.size).toBe(output.bytes.length);
    expect(output.hasAudio).toBe(true);
    expect(output.durationSeconds).toBeGreaterThan(0);

    const videoStream = meta.streams?.find((s) => s.codec_type === "video");
    const audioStream = meta.streams?.find((s) => s.codec_type === "audio");
    expect(videoStream?.codec_name).toBe("h264");
    expect(audioStream?.codec_name).toBe("aac");
  });

  test("reports hasAudio=false for silent video", async () => {
    const input = createTestVideo({ audio: false });

    const output = await processVideo(input, options);
    const meta = probe(output.bytes);

    expect(output.hasAudio).toBe(false);
    expect(meta.streams?.some((s) => s.codec_type === "audio")).toBe(false);
  });

  test("downscales videos that exceed maxDimension and keeps even dimensions", async () => {
    const input = createTestVideo({ width: 640, height: 480, audio: false });

    const output = await processVideo(input, { ...options, maxDimension: 320 });

    expect(output.width).toBeLessThanOrEqual(320);
    expect(output.height).toBeLessThanOrEqual(320);
    expect(output.width % 2).toBe(0);
    expect(output.height % 2).toBe(0);
  });

  test("transcodes non-MP4 (AVI) input to MP4", async () => {
    const input = createTestVideo({ container: "avi", audio: false });

    const output = await processVideo(input, options);

    expect(output.mimeType).toBe("video/mp4");
    expect(output.width).toBe(320);
    expect(output.height).toBe(240);
  });

  test("strips source metadata", async () => {
    const input = createTestVideo({ audio: false, title: "TopSecretTitle" });
    expect(probe(input).format?.tags?.title).toBe("TopSecretTitle");

    const output = await processVideo(input, options);
    const meta = probe(output.bytes);

    expect(meta.format?.tags?.title).toBeUndefined();
  });

  test("rejects empty input", async () => {
    await expect(processVideo(Buffer.alloc(0), options)).rejects.toMatchObject({
      status: 400,
      code: "empty_file",
    });
  });

  test("rejects inputs that exceed the max input size", async () => {
    await expect(
      processVideo(Buffer.alloc(options.maxInputBytes + 1), options),
    ).rejects.toMatchObject({
      status: 413,
      code: "input_too_large",
    });
  });

  test("rejects videos longer than the duration limit", async () => {
    const input = createTestVideo({ duration: 2, audio: false });

    await expect(
      processVideo(input, { ...options, maxDurationSeconds: 1 }),
    ).rejects.toMatchObject({
      status: 413,
      code: "too_long",
    });
  });

  test("rejects oversized output", async () => {
    const input = createTestVideo({ audio: false });

    await expect(
      processVideo(input, { ...options, maxOutputBytes: 1 }),
    ).rejects.toMatchObject({
      status: 413,
      code: "output_too_large",
    });
  });

  test("rejects invalid video bytes", async () => {
    await expect(
      processVideo(Buffer.from("not-a-video"), options),
    ).rejects.toMatchObject({
      status: 400,
      code: "invalid_video",
    });
  });
});
