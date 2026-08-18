/**
 * Numeric SemVer comparison ("0.2.6" >= "0.2.5"). Missing/unparseable parts read as 0,
 * so `undefined` and `""` compare as 0.0.0 — below every real floor.
 */
export function apiVersionAtLeast(current: string | undefined, minimum: string): boolean {
  const [cMajor, cMinor, cPatch] = parseApiVersion(current);
  const [mMajor, mMinor, mPatch] = parseApiVersion(minimum);
  if (cMajor !== mMajor) return cMajor > mMajor;
  if (cMinor !== mMinor) return cMinor > mMinor;
  return cPatch >= mPatch;
}

function parseApiVersion(version: string | undefined): [number, number, number] {
  const [major = 0, minor = 0, patch = 0] = (version ?? '')
    .split('.')
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
  return [major, minor, patch];
}
