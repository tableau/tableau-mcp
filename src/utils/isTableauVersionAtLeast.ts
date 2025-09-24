import { ProductVersion } from '../sdks/tableau/types/serverInfo.js';

export function isTableauVersionAtLeast({
  productVersion,
  minVersion,
}: {
  productVersion: ProductVersion;
  minVersion: `${number}.${number}.${number}`;
}): boolean {
  const { value: versionValue } = productVersion;

  if (versionValue === 'main') {
    // Build is from the main branch, so the build version is on the "build" attribute and looks like "main.25.0804.1416"
    // This is likely an internal dev environment, so we'll assume it's a fresh build and pass the check.
    return true;
  }

  // Build is from a release branch, so the release version is the value and looks like "2025.3.0"
  const [year, major, minor] = versionValue.split('.').map(Number);
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
