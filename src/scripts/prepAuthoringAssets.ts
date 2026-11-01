import { build } from 'esbuild';

/** Bundle the reviewed Node compiler, schema and npm dependencies; no Python assets. */
export async function buildPrepAuthoringWorker(outfile: string): Promise<void> {
  const result = await build({
    entryPoints: ['./src/tools/web/prepAuthoring/authoringWorker.ts'],
    outfile,
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    packages: 'bundle',
    sourcemap: false,
    metafile: true,
    logLevel: 'silent',
  });
  if (Object.keys(result.metafile!.inputs).some((path) => /\.(py|pyc|jar|exe|dll)$/i.test(path)))
    throw new Error('Unexpected native/Python asset in Prep authoring worker.');
}
