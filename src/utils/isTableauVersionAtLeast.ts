import { ProductVersion } from '../sdks/tableau/types/serverInfo.js';

// Example 2025.3.0
type TableauVersion = `${number}.${number}.${number}`;

export function getResultForTableauVersion<T>({
  productVersion,
  mappings,
}: {
  productVersion: ProductVersion;
  mappings: { [minVersion: TableauVersion]: T } & { default: T };
}): T {
  for (const [minVersion, value] of Object.entries(mappings) as Array<[TableauVersion, T]>) {
    if (isTableauVersionAtLeast({ productVersion, minVersion })) {
      return value;
    }
  }

  return mappings.default;
}

function isTableauVersionAtLeast({
  productVersion,
  minVersion,
}: {
  productVersion: ProductVersion;
  minVersion: `${number}.${number}.${number}`;
}): boolean {
  const { value: versionValue, build } = productVersion;

  if (versionValue === '0.0.0' || build.includes('main')) {
    // Development servers can report 0.0.0 or a main build (for example main.26.1005.0759).
    // Treat either marker as a fresh build and pass the check.
    return true;
  }

  const [year, major, minor] = versionValue.split('.').map(Number);
  if ([year, major, minor].some(isNaN)) {
    // The version is in some unknown format, so we'll assume it's a fresh build and pass the check.
    return true;
  }

  // Build is from a release branch, so the release version is the value and looks like "2025.3.0"
  const [minYear, minMajor, minMinor] = minVersion.split('.').map(Number);

  if (
    year > minYear ||
    (year === minYear && major > minMajor) ||
    (year === minYear && major === minMajor && minor >= minMinor)
  ) {
    // Tableau version is newer than the minimum required version
    return true;
  }

  // Tableau version is older than the minimum required version
  return false;
}

export const exportedForTesting = {
  isTableauVersionAtLeast,
};
