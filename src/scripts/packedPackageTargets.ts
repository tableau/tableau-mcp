interface PackageTargetFields {
  main?: unknown;
  types?: unknown;
  bin?: unknown;
  exports?: unknown;
}

function collectStrings(value: unknown, into: string[]): void {
  if (typeof value === 'string') {
    into.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, into);
  } else if (typeof value === 'object' && value !== null) {
    for (const item of Object.values(value)) collectStrings(item, into);
  }
}

export function getPackageTargets(pkg: PackageTargetFields): string[] {
  const targets: string[] = [];
  collectStrings(pkg.main, targets);
  collectStrings(pkg.types, targets);
  collectStrings(pkg.bin, targets);
  collectStrings(pkg.exports, targets);
  return [...new Set(targets)]
    .filter((target) => !target.includes('*'))
    .map((target) => target.replace(/^\.\//, ''));
}

export function findMissingPackageTargets(
  pkg: PackageTargetFields,
  packedPaths: ReadonlySet<string>,
): string[] {
  return getPackageTargets(pkg).filter((target) => !packedPaths.has(target));
}
