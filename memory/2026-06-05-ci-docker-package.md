# 2026-06-05 CI Docker Package

## Objective

- Convert the extracted image processor service into a standalone `smol-image-processor` Bun/Docker package.
- Remove V7/scentia/Rust/server-worker workflow assumptions.

## User-Approved Scope

- User approved workflow, Dependabot, README, and formatting fixes after review.
- V7 service was preferred if the old V7 and scentia service implementations differed.

## Implementation Status

- Completed:
  - Replaced Rust/check workflow steps with root Bun install, format check, test, and build.
  - Replaced multi-image server/worker/image-processor Docker workflow with one root Docker image.
  - Removed obsolete Rust `build.yml`.
  - Changed Dependabot from Cargo to Bun and GitHub Actions.
  - Added concise README run, Docker, and limit sections.
- Partial:
  - Local Docker build was attempted but Docker Desktop engine was unavailable.
- Not started:
  - No version bump or changelog update.

## Major Changes

- Files/modules:
  - `.github/workflows/check.yml`
  - `.github/workflows/docker.yml`
  - `.github/workflows/build.yml`
  - `.github/dependabot.yml`
  - `README.md`
- API / interface changes:
  - None.
- Config / environment changes:
  - CI now uses Bun only.
  - Docker publishing now targets `ghcr.io/${{ github.repository }}` from root `Dockerfile`.
  - Dependabot now tracks `bun` and `github-actions`.
- Styles / assets:
  - None.
- Tests:
  - No test logic changed.

## Validation

- Commands run:
  - `bun run fmt:check`
  - `bun test`
  - `bun build src/index.ts --outdir <temp> --target bun`
  - `docker build -t smol-image-processor:local .`
  - `rg` search for old project/workflow residue.
- Result:
  - Format check passed.
  - Tests passed: 17 pass, 0 fail.
  - Bun build passed.
  - Old V7/scentia/cargo/Rust/server-worker path search returned no matches.
- Skipped checks:
  - Docker build did not run because Docker Desktop Linux engine was not available locally.

## Remaining Work

- Known gaps:
  - Re-run `docker build -t smol-image-processor:local .` when Docker is running.
- Risks:
  - Docker workflow is unverified locally due to Docker engine availability, but paths now match this standalone repository.
- Suggested next entry points:
  - `.github/workflows/docker.yml`
  - `Dockerfile`

## Notes For Next Agent

- Follow `AGENTS.md`: do not modify files without explicit user approval.
- The user prefers a simple README with only necessary information.
- Do not reintroduce V7, scentia, Rust, `services/image-processor`, server, or worker assumptions.
