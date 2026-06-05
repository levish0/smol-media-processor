# smol-image-processor

Small Bun/Elysia service that normalizes uploaded raster images to WebP.

## Policy

- Input: JPEG, PNG, GIF, WebP
- Output: WebP
- Animated GIF/WebP inputs are emitted as animated WebP
- `MAX_PAGES` defaults to 300 frames/pages to reject extreme animated uploads
- SVG is not supported
- Metadata is stripped by Sharp's default output behavior
- EXIF orientation is applied before metadata is stripped

## API

### `GET /health`

Returns service health.

### `POST /process`

Consumes `multipart/form-data` with a `file` field. Supported input formats are JPEG, PNG, GIF, and WebP. The response body is always processed WebP bytes.

Response headers:

- `x-image-mime-type`
- `x-image-extension`
- `x-image-width`
- `x-image-height`
- `x-image-size`
- `x-image-animated`
- `x-image-pages`

## Run

```bash
bun install
bun start
```

Default port is `6701`. Override with `PORT`.

## Docker

```bash
docker build -t smol-image-processor .
docker run --rm -p 6701:6701 -e MAX_INPUT_BYTES=10485760 smol-image-processor
```

## Environment Variables

| Name | Default | Description |
| --- | ---: | --- |
| `PORT` | `6701` | HTTP server port |
| `MAX_INPUT_BYTES` | `10485760` | Maximum upload size |
| `MAX_OUTPUT_BYTES` | `10485760` | Maximum processed WebP size |
| `MAX_PIXELS` | `32000000` | Maximum input pixel count |
| `MAX_PAGES` | `300` | Maximum animated frames/pages |
| `PROCESSING_TIMEOUT_SECONDS` | `20` | Sharp processing timeout |
| `WEBP_QUALITY` | `85` | WebP quality, 1-100 |
| `WEBP_EFFORT` | `4` | WebP encoder effort, 0-6 |

## License

MIT
