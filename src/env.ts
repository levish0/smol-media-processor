const INTEGER_ENV_PATTERN = /^[+-]?\d+$/;

export function readPositiveInt(name: string, fallback: number): number {
  const parsed = readIntegerEnv(name);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function readBoundedInt(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = readIntegerEnv(name);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, parsed));
}

export function readEnumEnv<T extends string>(
  name: string,
  fallback: T,
  allowed: readonly T[],
): T {
  const raw = process.env[name]?.trim();
  return raw && (allowed as readonly string[]).includes(raw)
    ? (raw as T)
    : fallback;
}

function readIntegerEnv(name: string): number {
  const raw = process.env[name];
  if (!raw) {
    return Number.NaN;
  }

  const normalized = raw.trim();
  if (!INTEGER_ENV_PATTERN.test(normalized)) {
    return Number.NaN;
  }

  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}
