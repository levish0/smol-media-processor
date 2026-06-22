# smol-media-processor

Small Bun/Elysia service that normalizes uploaded media: raster images to WebP and videos to MP4 (H.264/AAC).

## Policy

### Images

- Input: JPEG, PNG, GIF, WebP
- Output: WebP
- Animated GIF/WebP inputs are emitted as animated WebP
- `MAX_PAGES` defaults to 300 frames/pages to reject extreme animated uploads
- SVG is not supported
- Metadata is stripped by Sharp's default output behavior
- EXIF orientation is applied before metadata is stripped

### Videos

- Input: MP4/MOV, WebM/Matroska, AVI, FLV, MPEG (validated via ffprobe)
- Output: MP4 (H.264 video, AAC audio, `+faststart`)
- Re-encoded with libx264; container/source metadata is stripped (`-map_metadata -1`)
- Videos larger than `MAX_VIDEO_DIMENSION` are downscaled (aspect preserved, no upscaling)
- `MAX_VIDEO_DURATION_SECONDS` rejects overly long uploads
- ffmpeg/ffprobe run with `-protocol_whitelist file` so they never touch the network or external files

The media kind is detected from the uploaded bytes (magic-byte sniffing), not the client-supplied content type.

## API

### `GET /health`

Returns service health.

### `POST /process`

Consumes `multipart/form-data` with a `file` field. The processor detects whether the
upload is an image or a video and normalizes it accordingly. The response body is the
processed bytes (WebP for images, MP4 for videos).

Common response headers:

- `x-media-kind` (`image` or `video`)
- `x-media-mime-type`
- `x-media-extension`
- `x-media-width`
- `x-media-height`
- `x-media-size`

Image-only headers:

- `x-media-animated`
- `x-media-pages`

Video-only headers:

- `x-media-duration` (seconds)
- `x-media-has-audio`

## Run

```bash
bun install
bun start
```

`ffmpeg` and `ffprobe` must be available on `PATH` for video processing. Default port is
`6701`; override with `PORT`.

## Docker

```bash
docker build -t smol-media-processor .
docker run --rm -p 6701:6701 -e MAX_INPUT_BYTES=10485760 smol-media-processor
```

The image installs `ffmpeg` for video processing.

## Environment Variables

### Images

| Name | Default | Description |
| --- | ---: | --- |
| `PORT` | `6701` | HTTP server port |
| `MAX_INPUT_BYTES` | `10485760` | Maximum image upload size |
| `MAX_OUTPUT_BYTES` | `10485760` | Maximum processed WebP size |
| `MAX_PIXELS` | `32000000` | Maximum input pixel count |
| `MAX_PAGES` | `300` | Maximum animated frames/pages |
| `PROCESSING_TIMEOUT_SECONDS` | `20` | Sharp processing timeout |
| `WEBP_QUALITY` | `85` | WebP quality, 1-100 |
| `WEBP_EFFORT` | `4` | WebP encoder effort, 0-6 |

### Videos

| Name | Default | Description |
| --- | ---: | --- |
| `MAX_VIDEO_INPUT_BYTES` | `104857600` | Maximum video upload size |
| `MAX_VIDEO_OUTPUT_BYTES` | `104857600` | Maximum processed MP4 size |
| `MAX_VIDEO_DURATION_SECONDS` | `300` | Maximum input duration |
| `MAX_VIDEO_DIMENSION` | `1920` | Max width/height; larger inputs are downscaled |
| `VIDEO_TIMEOUT_SECONDS` | `120` | ffmpeg transcode timeout |
| `VIDEO_CRF` | `23` | libx264 CRF, 0-51 (lower = higher quality) |
| `VIDEO_PRESET` | `medium` | libx264 preset (`ultrafast`…`veryslow`) |
| `VIDEO_AUDIO_BITRATE_KBPS` | `128` | AAC audio bitrate in kbps |

## License

MIT
