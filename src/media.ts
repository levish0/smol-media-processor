import { detectMediaKind } from "./detect";
import { MediaProcessingError } from "./errors";
import { processImage, type ProcessedImage } from "./image";
import { processVideo, type ProcessedVideo } from "./video";

export type ProcessedMedia = ProcessedImage | ProcessedVideo;

// Single entry point used by the HTTP layer: sniff the upload, then hand it to the
// matching processor. Each processor performs its own full validation.
export async function processMedia(input: Buffer): Promise<ProcessedMedia> {
  if (input.length === 0) {
    throw new MediaProcessingError(400, "empty_file", "Empty file");
  }

  const kind = detectMediaKind(input);

  if (kind === "image") {
    return processImage(input);
  }

  if (kind === "video") {
    return processVideo(input);
  }

  throw new MediaProcessingError(
    415,
    "unsupported_format",
    "Unsupported media format",
  );
}
