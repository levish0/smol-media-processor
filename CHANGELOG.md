# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-06-22

### Added

- Video processing: `POST /process` now detects videos and normalizes them to MP4 (H.264/AAC) via ffmpeg, with source metadata stripped, dimension downscaling, and duration/size limits.
- Magic-byte media detection so the processor routes uploads by content rather than the client-supplied type.
- Video environment variables: `MAX_VIDEO_INPUT_BYTES`, `MAX_VIDEO_OUTPUT_BYTES`, `MAX_VIDEO_DURATION_SECONDS`, `MAX_VIDEO_DIMENSION`, `VIDEO_TIMEOUT_SECONDS`, `VIDEO_CRF`, `VIDEO_PRESET`, `VIDEO_AUDIO_BITRATE_KBPS`.
- Video and detection test coverage.
- `ffmpeg` is installed in the Docker image.

### Changed

- Renamed the project from `smol-image-processor` to `smol-media-processor`.
- Generalized the codebase into `env`, `errors`, `types`, `detect`, `image`, `video`, and `media` modules; `ImageProcessingError` is now `MediaProcessingError`.
- Response headers are now generalized to `x-media-*` (previously `x-image-*`) with kind-specific extras. **Breaking** for clients reading the old `x-image-*` headers.

## [0.1.1] - 2026-06-05

### Added

- Added processor coverage for EXIF orientation, animated WebP metadata, animation timing, alpha preservation, and `MAX_PAGES` boundary behavior.
- Added default option coverage for strict integer environment variable parsing and bounded WebP option clamping.

### Changed

- Tightened processor environment variable parsing to ignore partial integer strings such as `12px` or `15.9`.
- Consolidated Sharp input setup used by metadata reads and image processing.

## [0.1.0] - 2026-06-05

### Added

- Initial Bun/Elysia image processor service.
- Multipart `/process` endpoint that normalizes JPEG, PNG, GIF, and WebP inputs to WebP.
- `/health` endpoint.
- Docker image build.
- GitHub Actions checks and GHCR publishing workflow.
