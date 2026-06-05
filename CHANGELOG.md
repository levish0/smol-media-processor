# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
