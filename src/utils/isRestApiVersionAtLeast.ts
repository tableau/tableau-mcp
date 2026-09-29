// REST API version strings look like "3.29", "3.30", "3.31".
export const MIN_REST_API_VERSION_FOR_EMBEDDED_QUERY = '3.30';

export function isRestApiVersionAtLeast(current: string, min: string): boolean {
  const [curMajor, curMinor] = current.split('.').map(Number);
  const [minMajor, minMinor] = min.split('.').map(Number);
  // Unknown/non-numeric format → assume capable (matches isTableauVersionAtLeast's fallback).
  if ([curMajor, curMinor].some(isNaN)) {
    return true;
  }
  return curMajor > minMajor || (curMajor === minMajor && curMinor >= minMinor);
}
