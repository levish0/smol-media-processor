import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MediaProcessingError } from "./errors";
import { readBoundedInt, readEnumEnv, readPositiveInt } from "./env";
import type { ProcessedMediaBase } from "./types";

const PRESETS = [
  "ultrafast",
  "superfast",
  "veryfast",
  "faster",
  "fast",
  "medium",
  "slow",
  "slower",
  "veryslow",
] as const;

type Preset = (typeof PRESETS)[number];

// ffprobe reports the container as a comma-joined demuxer list. Only inputs whose
// list exactly matches one of these are accepted; everything else is rejected
// before ffmpeg ever opens the file.
const ALLOWED_INPUT_FORMATS = new Set([
  "mov,mp4,m4a,3gp,3g2,mj2",
  "matroska,webm",
  "avi",
  "flv",
  "mpeg",
]);

const PROBE_TIMEOUT_SECONDS = 30;

export type ProcessedVideo = ProcessedMediaBase & {
  kind: "video";
  mimeType: "video/mp4";
  extension: "mp4";
  durationSeconds: number;
  hasAudio: boolean;
};

export type VideoOptions = {
  maxInputBytes: number;
  maxOutputBytes: number;
  maxDurationSeconds: number;
  maxDimension: number;
  timeoutSeconds: number;
  crf: number;
  preset: Preset;
  audioBitrateKbps: number;
};

export const videoDefaults: VideoOptions = {
  maxInputBytes: readPositiveInt("MAX_VIDEO_INPUT_BYTES", 100 * 1024 * 1024),
  maxOutputBytes: readPositiveInt("MAX_VIDEO_OUTPUT_BYTES", 100 * 1024 * 1024),
  maxDurationSeconds: readPositiveInt("MAX_VIDEO_DURATION_SECONDS", 300),
  maxDimension: readPositiveInt("MAX_VIDEO_DIMENSION", 1920),
  timeoutSeconds: readPositiveInt("VIDEO_TIMEOUT_SECONDS", 120),
  crf: readBoundedInt("VIDEO_CRF", 23, 0, 51),
  preset: readEnumEnv<Preset>("VIDEO_PRESET", "medium", PRESETS),
  audioBitrateKbps: readPositiveInt("VIDEO_AUDIO_BITRATE_KBPS", 128),
};

export async function processVideo(
  input: Buffer,
  options = videoDefaults,
): Promise<ProcessedVideo> {
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

  const id = randomUUID();
  const inputPath = join(tmpdir(), `smp-${id}.in`);
  const outputPath = join(tmpdir(), `smp-${id}.mp4`);

  try {
    await Bun.write(inputPath, input);

    const probe = await probeInput(inputPath, options);

    await transcode(inputPath, outputPath, probe.hasAudio, options);

    const output = await readOutput(outputPath);
    if (output.length > options.maxOutputBytes) {
      throw new MediaProcessingError(
        413,
        "output_too_large",
        "Processed video is too large",
      );
    }

    const outputMeta = await probeOutputMetadata(outputPath);

    return {
      kind: "video",
      bytes: output,
      mimeType: "video/mp4",
      extension: "mp4",
      width: outputMeta.width,
      height: outputMeta.height,
      size: output.length,
      durationSeconds: outputMeta.durationSeconds,
      hasAudio: probe.hasAudio,
    };
  } finally {
    await safeUnlink(inputPath);
    await safeUnlink(outputPath);
  }
}

type FfprobeStream = {
  codec_type?: string;
  width?: number;
  height?: number;
  duration?: string;
};

type FfprobeResult = {
  format?: { format_name?: string; duration?: string };
  streams?: FfprobeStream[];
};

type InputProbe = {
  hasAudio: boolean;
};

async function probeInput(
  path: string,
  options: VideoOptions,
): Promise<InputProbe> {
  const result = await ffprobe(path);

  const formatName = result.format?.format_name ?? "";
  if (!ALLOWED_INPUT_FORMATS.has(formatName)) {
    throw new MediaProcessingError(
      415,
      "unsupported_format",
      `Unsupported video format: ${formatName || "unknown"}`,
    );
  }

  const streams = result.streams ?? [];
  const videoStream = streams.find((s) => s.codec_type === "video");
  if (!videoStream) {
    throw new MediaProcessingError(
      415,
      "unsupported_format",
      "No video stream found",
    );
  }

  const duration = parseDuration(result);
  if (!Number.isFinite(duration)) {
    throw new MediaProcessingError(
      400,
      "invalid_video",
      "Cannot determine video duration",
    );
  }

  if (duration > options.maxDurationSeconds) {
    throw new MediaProcessingError(
      413,
      "too_long",
      "Video is longer than the maximum duration",
    );
  }

  return { hasAudio: streams.some((s) => s.codec_type === "audio") };
}

async function transcode(
  inputPath: string,
  outputPath: string,
  hasAudio: boolean,
  options: VideoOptions,
): Promise<void> {
  const max = options.maxDimension;
  // Fit within max×max without upscaling, then round to even dimensions for
  // yuv420p. Commas inside scale expressions are escaped for the filtergraph
  // parser (no shell is involved, so the backslashes are literal).
  const vf =
    `scale=w='min(${max}\\,iw)':h='min(${max}\\,ih)':force_original_aspect_ratio=decrease,` +
    `scale=w='trunc(iw/2)*2':h='trunc(ih/2)*2'`;

  const args = [
    "-hide_banner",
    "-loglevel",
    "error",
    "-nostdin",
    "-y",
    "-protocol_whitelist",
    "file",
    "-i",
    inputPath,
    "-map_metadata",
    "-1",
    "-map",
    "0:v:0",
    ...(hasAudio ? ["-map", "0:a:0?"] : []),
    "-vf",
    vf,
    "-c:v",
    "libx264",
    "-preset",
    options.preset,
    "-crf",
    String(options.crf),
    "-pix_fmt",
    "yuv420p",
    ...(hasAudio
      ? ["-c:a", "aac", "-b:a", `${options.audioBitrateKbps}k`]
      : ["-an"]),
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    outputPath,
  ];

  const result = await runProcess("ffmpeg", args, options.timeoutSeconds);

  if (result.timedOut) {
    throw new MediaProcessingError(
      408,
      "processing_timeout",
      "Video processing timed out",
    );
  }

  if (result.exitCode !== 0) {
    throw new MediaProcessingError(
      422,
      "processing_failed",
      "Failed to process video",
    );
  }
}

async function ffprobe(path: string): Promise<FfprobeResult> {
  const args = [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    "-protocol_whitelist",
    "file",
    path,
  ];

  const result = await runProcess("ffprobe", args, PROBE_TIMEOUT_SECONDS);

  if (result.timedOut || result.exitCode !== 0) {
    throw new MediaProcessingError(
      400,
      "invalid_video",
      "Cannot read video metadata",
    );
  }

  try {
    return JSON.parse(result.stdout) as FfprobeResult;
  } catch {
    throw new MediaProcessingError(
      400,
      "invalid_video",
      "Cannot read video metadata",
    );
  }
}

type OutputMetadata = {
  width: number;
  height: number;
  durationSeconds: number;
};

async function probeOutputMetadata(path: string): Promise<OutputMetadata> {
  const result = await ffprobe(path);
  const videoStream = (result.streams ?? []).find(
    (s) => s.codec_type === "video",
  );
  const duration = parseDuration(result);

  return {
    width: videoStream?.width ?? 0,
    height: videoStream?.height ?? 0,
    durationSeconds: Number.isFinite(duration) ? roundTo(duration, 3) : 0,
  };
}

function parseDuration(result: FfprobeResult): number {
  const fromFormat = Number(result.format?.duration);
  if (Number.isFinite(fromFormat)) {
    return fromFormat;
  }

  const videoStream = (result.streams ?? []).find(
    (s) => s.codec_type === "video",
  );
  return Number(videoStream?.duration);
}

type ProcessResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut: boolean;
};

async function runProcess(
  command: string,
  args: string[],
  timeoutSeconds: number,
): Promise<ProcessResult> {
  const proc = Bun.spawn([command, ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    proc.kill(9);
  }, timeoutSeconds * 1000);

  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    return { stdout, stderr, exitCode, timedOut };
  } finally {
    clearTimeout(timer);
  }
}

async function readOutput(path: string): Promise<Buffer> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new MediaProcessingError(
      422,
      "processing_failed",
      "Failed to process video",
    );
  }

  return Buffer.from(await file.arrayBuffer());
}

async function safeUnlink(path: string): Promise<void> {
  await unlink(path).catch(() => {
    // Best-effort cleanup; a missing temp file is not an error worth surfacing.
  });
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
