import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, sep } from 'node:path';

import { buildPrepAuthoringWorker } from '../../../scripts/prepAuthoringAssets.js';
import { buildFlowPackage, compileFlowYaml, newFlowYaml } from './authoringCompiler.js';
import { object, parseJson } from './compactYaml.js';
import { runPrepEngine } from './engineClient.js';
import { readNativeArchive } from './nativeArchive.js';
import { digest, ProjectIo } from './projectIo.js';

describe('real bundled Node worker authoring integration', () => {
  let root: string, worker: string, workspace: string;
  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'prep-worker-'));
    worker = join(root, 'prep-authoring-worker.cjs');
    await buildPrepAuthoringWorker(worker);
  });
  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'prep-worker-'));
  });
  function cleanup(path: string): void {
    const rel = relative(resolve(tmpdir()), resolve(path));
    if (!rel.startsWith('prep-worker-') || rel.includes(sep)) throw new Error('Unowned test root.');
    rmSync(path, { recursive: true, force: true });
  }
  afterEach(() => {
    cleanup(workspace);
    vi.unstubAllEnvs();
  });
  afterAll(() => cleanup(root));
  const signal = (): AbortSignal => new AbortController().signal;
  it.each(['new', 'local', 'download'] as const)(
    'runs complete %s/edit/preview/release without Python',
    async (origin) => {
      vi.stubEnv('PREP_AUTHORING_PYTHON', 'NONEXISTENT');
      vi.stubEnv('PYTHONPATH', 'NONEXISTENT');
      const config = { enabled: true, workspace },
        jobId = randomUUID();
      let source: Record<string, unknown> = { type: 'new' },
        original: Buffer | undefined;
      if (origin !== 'new') {
        const io = new ProjectIo(workspace),
          project = join(workspace, 'fixture');
        io.mkdir(project, true);
        newFlowYaml(io, project, 'tflx');
        original = buildFlowPackage(
          compileFlowYaml(
            io,
            project,
            io.read(join(project, 'project.yml')).toString('utf8'),
            'tflx',
          ),
        );
        writeFileSync(join(workspace, 'original.tflx'), original);
        source =
          origin === 'local'
            ? { type: 'local', path: './original.tflx' }
            : { type: 'download', base64: original.toString('base64') };
      }
      const prepared = await runPrepEngine(
        config,
        { operation: 'prepare', jobId, format: 'tflx', source },
        signal(),
        worker,
      );
      const yaml = prepared.yaml!.replace('[Sales] * 1.1', '[Sales] * 1.25');
      expect(yaml).not.toBe(prepared.yaml);
      const base = { jobId, projectSha256: prepared.projectSha256, format: 'tflx' };
      const preview = await runPrepEngine(
        config,
        { ...base, operation: 'preview', previewId: randomUUID(), yaml },
        signal(),
        worker,
      );
      expect(preview.valid).toBe(true);
      const generated = await runPrepEngine(
        config,
        {
          ...base,
          operation: 'generate',
          previewId: preview.previewId,
          previewSha256: preview.previewSha256,
          yamlSha256: digest(yaml),
        },
        signal(),
        worker,
      );
      const bytes = readFileSync(join(workspace, generated.path!));
      expect(digest(bytes)).toBe(preview.previewSha256);
      expect(generated.sha256).toBe(preview.previewSha256);
      expect(generated.nativeExecutionVerified).toBe(false);
      const flow = object(parseJson(readNativeArchive(bytes).get('flow')!));
      expect(
        Object.values(object(flow.nodes)).some((n) => object(n).expression === '[Sales] * 1.25'),
      ).toBe(true);
      if (original) expect(readFileSync(join(workspace, 'original.tflx'))).toEqual(original);
      expect(existsSync(join(root, 'runner.py'))).toBe(false);
    },
  );
  it('preserves a40MiB opaque attachment within the64MiB expanded-project limit', async () => {
    const io = new ProjectIo(workspace),
      project = join(workspace, 'large-fixture');
    io.mkdir(project, true);
    newFlowYaml(io, project, 'tflx');
    const compiled = compileFlowYaml(
      io,
      project,
      io.read(join(project, 'project.yml')).toString('utf8'),
      'tflx',
    );
    const opaque = Buffer.alloc(40 * 1024 * 1024);
    compiled.files.set('opaque.bin', opaque);
    const source = buildFlowPackage(compiled),
      config = { enabled: true, workspace },
      jobId = randomUUID();
    const prepared = await runPrepEngine(
      config,
      {
        operation: 'prepare',
        jobId,
        format: 'tflx',
        source: { type: 'download', base64: source.toString('base64') },
      },
      signal(),
      worker,
    );
    const base = { jobId, projectSha256: prepared.projectSha256, format: 'tflx' };
    const preview = await runPrepEngine(
      config,
      { ...base, operation: 'preview', previewId: randomUUID(), yaml: prepared.yaml },
      signal(),
      worker,
    );
    expect(preview.valid).toBe(true);
    const generated = await runPrepEngine(
      config,
      {
        ...base,
        operation: 'generate',
        previewId: preview.previewId,
        previewSha256: preview.previewSha256,
        yamlSha256: digest(prepared.yaml!),
      },
      signal(),
      worker,
    );
    expect(
      digest(readNativeArchive(readFileSync(join(workspace, generated.path!))).get('opaque.bin')!),
    ).toBe(digest(opaque));
  });
  it('terminates a real Node worker on cancellation', async () => {
    const stalled = join(workspace, 'stalled.cjs');
    writeFileSync(stalled, 'setInterval(() => {}, 1000);');
    const controller = new AbortController();
    const pending = runPrepEngine({ enabled: true, workspace }, {}, controller.signal, stalled);
    const assertion = expect(pending).rejects.toThrow();
    controller.abort();
    await assertion;
  });
  it('does not expose diagnostics from a failing actual worker', async () => {
    const failing = join(workspace, 'failing.cjs');
    writeFileSync(failing, 'throw new Error("DUMMY_PRIVATE_DIAGNOSTIC");');
    await expect(
      runPrepEngine({ enabled: true, workspace }, {}, signal(), failing),
    ).rejects.not.toThrow('DUMMY_PRIVATE_DIAGNOSTIC');
  });
});
