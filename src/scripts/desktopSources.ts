const desktopDirectories = ['src/desktop/', 'src/tools/desktop/', 'resources/desktop/'];

/** Returns the esbuild metafile input paths (cwd-relative) that are Desktop source. */
export function findDesktopSources(inputPaths: Iterable<string>): string[] {
  return [...inputPaths].filter((inputPath) => {
    const path = inputPath.replaceAll('\\', '/');
    const basename = path.slice(path.lastIndexOf('/') + 1);
    return (
      desktopDirectories.some((directory) => path.startsWith(directory)) ||
      basename.endsWith('.desktop.ts') ||
      basename === 'index.combined.ts'
    );
  });
}
