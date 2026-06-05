import { Elysia, t } from "elysia";
import { ImageProcessingError, processImage } from "./processor";

const PORT = Number.parseInt(process.env.PORT ?? "6701", 10);

const app = new Elysia()
  .get("/", () => "Image Processor")
  .get("/health", () => ({
    status: "ok",
    service: "smol-image-processor",
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
        const processed = await processImage(input);

        // These headers describe the sanitized WebP output, not the original upload.
        set.headers["content-type"] = processed.mimeType;
        set.headers["x-image-mime-type"] = processed.mimeType;
        set.headers["x-image-extension"] = processed.extension;
        set.headers["x-image-width"] = processed.width.toString();
        set.headers["x-image-height"] = processed.height.toString();
        set.headers["x-image-size"] = processed.size.toString();
        set.headers["x-image-animated"] = processed.animated ? "true" : "false";
        set.headers["x-image-pages"] = processed.pages.toString();

        return processed.bytes;
      } catch (error) {
        if (error instanceof ImageProcessingError) {
          set.status = error.status;
          return {
            success: false,
            code: error.code,
            error: error.message,
          };
        }

        console.error("Unexpected image processing error:", error);
        set.status = 500;
        return {
          success: false,
          code: "internal_error",
          error: "Failed to process image",
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

console.log(`Image Processor running at http://localhost:${app.server?.port}`);
