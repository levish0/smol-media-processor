import { Elysia, t } from "elysia";
import { MediaProcessingError } from "./errors";
import { processMedia } from "./media";

const PORT = Number.parseInt(process.env.PORT ?? "6701", 10);

const app = new Elysia()
  .get("/", () => "Media Processor")
  .get("/health", () => ({
    status: "ok",
    service: "smol-media-processor",
    timestamp: new Date().toISOString(),
  }))
  .post(
    "/process",
    async ({ body, set }) => {
      try {
        const file = body.file;

        if (!(file instanceof Blob)) {
          set.status = 400;
          return {
            success: false,
            code: "missing_file",
            error: "Missing multipart file field",
          };
        }

        const input = Buffer.from(await file.arrayBuffer());
        const processed = await processMedia(input);

        // These headers describe the sanitized output, not the original upload.
        set.headers["content-type"] = processed.mimeType;
        set.headers["x-media-kind"] = processed.kind;
        set.headers["x-media-mime-type"] = processed.mimeType;
        set.headers["x-media-extension"] = processed.extension;
        set.headers["x-media-width"] = processed.width.toString();
        set.headers["x-media-height"] = processed.height.toString();
        set.headers["x-media-size"] = processed.size.toString();

        if (processed.kind === "image") {
          set.headers["x-media-animated"] = processed.animated
            ? "true"
            : "false";
          set.headers["x-media-pages"] = processed.pages.toString();
        } else {
          set.headers["x-media-duration"] =
            processed.durationSeconds.toString();
          set.headers["x-media-has-audio"] = processed.hasAudio
            ? "true"
            : "false";
        }

        return processed.bytes;
      } catch (error) {
        if (error instanceof MediaProcessingError) {
          set.status = error.status;
          return {
            success: false,
            code: error.code,
            error: error.message,
          };
        }

        console.error("Unexpected media processing error:", error);
        set.status = 500;
        return {
          success: false,
          code: "internal_error",
          error: "Failed to process media",
        };
      }
    },
    {
      type: "multipart/form-data",
      body: t.Object({
        file: t.Optional(t.File()),
      }),
    },
  )
  .listen(PORT);

console.log(`Media Processor running at http://localhost:${app.server?.port}`);
