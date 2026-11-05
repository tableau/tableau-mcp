import { randomUUID } from 'node:crypto';
import {
  existsSync,
  linkSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, relative, resolve, sep } from 'node:path';

import { compileFlowYaml, exportFlowYaml, newFlowYaml, PackageType } from './authoringCompiler.js';
import { runAuthoringEngine } from './authoringEngine.js';
import { CompactYaml, Json, jsonBytes, Obj, object, parseJson } from './compactYaml.js';
import { credentialKind, scopeCheck } from './credentialPolicy.js';
import type { EngineResult } from './engineClient.js';
import { metadataErrors } from './metadata.js';
import { readNativeArchive, writeNativeArchive } from './nativeArchive.js';
import { digest, MAX_FILE, ProjectIo } from './projectIo.js';
import schema from './tableau_prep_flow.schema.json';

describe('Node compact Prep authoring parity', () => {
  let workspace: string, io: ProjectIo;
  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'prep-node-'));
    io = new ProjectIo(workspace);
  });
  afterEach(() => {
    const rel = relative(resolve(tmpdir()), resolve(workspace));
    if (!rel.startsWith('prep-node-') || rel.includes(sep)) throw new Error('Unowned test root.');
    rmSync(workspace, { recursive: true, force: true });
  });
  const run = (request: Record<string, unknown>): EngineResult => runAuthoringEngine(request);
  function prepare(
    format: PackageType = 'tflx',
    resources: string[] = [],
  ): { request: Record<string, unknown>; prepared: EngineResult } {
    const request = { workspace, jobId: randomUUID(), format };
    const prepared = run({ ...request, operation: 'prepare', source: { type: 'new' }, resources });
    return { request: { ...request, projectSha256: prepared.projectSha256 }, prepared };
  }
  function preview(request: Record<string, unknown>, yaml: string): EngineResult {
    return run({ ...request, operation: 'preview', previewId: randomUUID(), yaml });
  }
  function generate(
    request: Record<string, unknown>,
    candidate: EngineResult,
    yaml: string,
  ): EngineResult {
    return run({
      ...request,
      operation: 'generate',
      previewId: candidate.previewId,
      previewSha256: candidate.previewSha256,
      yamlSha256: digest(yaml),
    });
  }
  function document(): Obj {
    const project = join(workspace, 'fixture');
    io.mkdir(project, true);
    newFlowYaml(io, project, 'tflx');
    return compileFlowYaml(
      io,
      project,
      io.read(join(project, 'project.yml')).toString('utf8'),
      'tflx',
    ).document;
  }
  it.each(['tfl', 'tflx'] as const)('ports new/edit/preview/exact generation for %s', (format) => {
    const { request, prepared } = prepare(format);
    const yaml = prepared.yaml!.replace('[Sales] * 1.1', '[Sales] * 1.2');
    expect(prepared.canvasPalette).toHaveLength(20);
    expect(prepared.canvasPalette).toContain('#86AF6A');
    expect(yaml).toContain('!id');
    const candidate = preview(request, yaml);
    expect(candidate.valid).toBe(true);
    const result = generate(request, candidate, yaml),
      bytes = readFileSync(join(workspace, result.path!));
    expect(digest(bytes)).toBe(candidate.previewSha256);
    expect(result.sha256).toBe(candidate.previewSha256);
    expect(result.nativeExecutionVerified).toBe(false);
    const entries = readNativeArchive(bytes),
      flow = object(parseJson(entries.get('flow')!));
    const csv = Object.values(object(flow.nodes))
      .map(object)
      .find((n) => n.nodeType === '.v1.LoadCsv')!;
    expect(csv.fields).toEqual([
      { name: 'Region', type: 'string', collation: null },
      { name: 'Sales', type: 'real', collation: null },
    ]);
    const display = object(parseJson(entries.get('displaySettings')!)),
      positions = object(object(display.flowDisplaySettings).flowNodeDisplaySettings);
    expect(Object.keys(positions).sort()).toEqual(Object.keys(object(flow.nodes)).sort());
    for (const value of Object.values(positions)) {
      const color = object(object(value).color);
      expect(color.hexCss).toMatch(/^#[0-9a-f]{6}$/i);
      const rgba = color.rgba as string[];
      expect(rgba).toHaveLength(4);
      expect(rgba.slice(0, 3).map(Number)).toEqual(
        String(color.hexCss)
          .slice(1)
          .match(/../g)!
          .map((channel) => parseInt(channel, 16)),
      );
      expect(Number(rgba[3])).toBe(1);
    }
    expect(
      Object.values(object(flow.nodes)).some((n) => object(n).expression === '[Sales] * 1.2'),
    ).toBe(true);
    expect(object(parseJson(entries.get('maestroMetadata')!)).isPackagedMaestroDocument).toBe(
      format === 'tflx',
    );
    if (format === 'tflx')
      expect(
        [...entries.values()].some((b) =>
          b.equals(Buffer.from('Region,Sales\nEast,100\nWest,200\n')),
        ),
      ).toBe(true);
  });
  it('round-trips Cloud CSV fields:null through local prepare, preview and generation', () => {
    const doc = document(),
      nodes = object(object(doc.flow).nodes),
      csv = Object.values(nodes)
        .map(object)
        .find((node) => node.nodeType === '.v1.LoadCsv')!;
    expect(csv).toBeDefined();
    csv.fields = null;
    const entries = new Map(Object.entries(doc).map(([key, value]) => [key, jsonBytes(value)])),
      source = writeNativeArchive(entries);
    writeFileSync(join(workspace, 'cloud.tflx'), source);
    const request = { workspace, jobId: randomUUID(), format: 'tflx' },
      prepared = run({
        ...request,
        operation: 'prepare',
        source: { type: 'local', path: 'cloud.tflx' },
      }),
      bound = { ...request, projectSha256: prepared.projectSha256 },
      yaml = prepared.yaml!.replace('[Sales] * 1.1', '[Sales] * 1.75'),
      candidate = preview(bound, yaml);
    expect(candidate.valid).toBe(true);
    const result = generate(bound, candidate, yaml),
      generated = readNativeArchive(readFileSync(join(workspace, result.path!))),
      flow = object(parseJson(generated.get('flow')!));
    expect(object(object(flow.nodes)[String(csv.id)]).fields).toBe(null);
    expect(readFileSync(join(workspace, 'cloud.tflx'))).toEqual(source);
    expect(metadataErrors(doc)).toEqual([]);
    for (const invalid of [true, 42, 'unknown', { Sales: 42 }, [42]]) {
      csv.fields = invalid;
      expect(metadataErrors(doc).length).toBeGreaterThan(0);
      expect(csv.fields).toEqual(invalid);
    }
  });
  it('preserves strict models and changes only the edited field', () => {
    const original = document(),
      bytes = jsonBytes(original),
      copied = parseJson(bytes);
    expect(metadataErrors(original)).toEqual([]);
    expect(jsonBytes(copied)).toEqual(bytes);
    const calculation = Object.values(object(object(original.flow).nodes))
      .map(object)
      .find((n) => typeof n.expression === 'string')!;
    calculation.expression = '[Sales] * 1.3';
    expect(metadataErrors(original)).toEqual([]);
    calculation.expression = 123;
    expect(metadataErrors(original).length).toBeGreaterThan(0);
  });
  it('stops release when edited canvas colors are outside the native palette', () => {
    const { request, prepared } = prepare(),
      codec = new CompactYaml(),
      authored = codec.load(prepared.yaml!),
      layout = object(
        object(object(authored.displaySettings).flowDisplaySettings).flowNodeDisplaySettings,
      ),
      node = object(Object.values(layout)[0]);
    node.color = { hexCss: '#000000', rgba: [0, 0, 0, 1] };
    const candidate = preview(request, codec.dump(authored));
    expect(candidate.valid).toBe(false);
    expect(candidate.errors!.some((error) => error.includes('CANVAS_COLOR_OUTSIDE_PALETTE'))).toBe(
      true,
    );
    expect(candidate.previewId).toBeUndefined();
    expect(candidate.previewSha256).toBeUndefined();
    expect(candidate.canvasPalette).toEqual(prepared.canvasPalette);
  });
  it('preserves unsupported imported colors for inspection but blocks strict generation', () => {
    const doc = document(),
      layout = object(
        object(object(doc.displaySettings).flowDisplaySettings).flowNodeDisplaySettings,
      ),
      node = object(Object.values(layout)[0]);
    node.color = { hexCss: '#123456', rgba: ['18', '52', '86', '1'] };
    expect(metadataErrors(doc)).toEqual([]);
    const source = writeNativeArchive(
        new Map(Object.entries(doc).map(([key, value]) => [key, jsonBytes(value)])),
      ),
      request = { workspace, jobId: randomUUID(), format: 'tflx' },
      prepared = run({
        ...request,
        operation: 'prepare',
        source: { type: 'download', base64: source.toString('base64') },
      });
    expect(prepared.valid).toBe(false);
    expect(prepared.errors!.some((error) => error.includes('CANVAS_COLOR_OUTSIDE_PALETTE'))).toBe(
      true,
    );
    expect(
      readFileSync(join(workspace, '.tableau-prep-mcp', request.jobId, 'original.tflx')),
    ).toEqual(source);
    const candidate = preview(
      { ...request, projectSha256: prepared.projectSha256 },
      prepared.yaml!,
    );
    expect(candidate.valid).toBe(false);
    expect(candidate.previewSha256).toBeUndefined();
  });
  it.each([
    ['id', 'bad-id'],
    ['nodeType', 'AddColumn'],
    ['baseType', 123],
    ['serialize', 'false'],
  ] as const)('rejects wrong typed %s without coercion', (field, value) => {
    const doc = document(),
      node = object(Object.values(object(object(doc.flow).nodes))[0]);
    node[field] = value;
    expect(metadataErrors(doc).length).toBeGreaterThan(0);
    expect(node[field]).toBe(value);
  });
  it('preserves absent/null/future fields and arbitrary integer values exactly', () => {
    const doc = document(),
      node = object(Object.values(object(object(doc.flow).nodes))[0]);
    delete node.name;
    node.description = null;
    node.nodeType = '.v12_3.FutureOperation';
    node.baseType = 'futureCategory';
    node.privateExtension = { future: [true, false, null, 'on', 1, 9007199254740993n] };
    const bytes = jsonBytes(doc);
    expect(metadataErrors(doc)).toEqual([]);
    const after = object(Object.values(object(object(object(parseJson(bytes)).flow).nodes))[0]);
    expect(Object.hasOwn(after, 'name')).toBe(false);
    expect(after.description).toBe(null);
    expect(after.privateExtension).toEqual(node.privateExtension);
    const codec = new CompactYaml();
    expect(codec.load(codec.dump({ value: 9007199254740993n })).value).toBe(9007199254740993n);
  });
  it('validates recursive graphs, child bindings, references and cycles', () => {
    const doc = document(),
      flow = object(doc.flow),
      nodes = object(flow.nodes),
      parent = object(Object.values(nodes)[0]),
      childId = randomUUID();
    parent.loomContainer = {
      nodes: {
        [childId]: { id: childId, nodeType: '.v1.AddColumn', baseType: 'transform', fields: null },
      },
    };
    expect(metadataErrors(doc)).toEqual([]);
    parent.namespacesToInput = { input: { nodeId: randomUUID() } };
    expect(metadataErrors(doc).some((e) => e.includes('namespacesToInput'))).toBe(true);
    delete parent.namespacesToInput;
    parent.nextNodes = [{ nextNodeId: parent.id }];
    expect(metadataErrors(doc).some((e) => e.includes('cycle'))).toBe(true);
  });
  it('externalizes large values and preserves every unknown property and opaque attachment', () => {
    const doc = document(),
      node = object(Object.values(object(object(doc.flow).nodes))[0]);
    node.values = { group: Array.from({ length: 1000 }, (_, i) => 'item-' + i) };
    node.futureExtension = object(
      parseJson(
        Buffer.from(
          '{"settings":[1,false,null,"on"],"__proto__":{"kept":true},"constructor":[1,2]}',
        ),
      ),
    );
    const entries = new Map(Object.entries(doc).map(([k, v]) => [k, jsonBytes(v)]));
    entries.set('opaque.bin', Buffer.from([0, 255, 9]));
    const project = join(workspace, 'exported');
    io.mkdir(project, true);
    exportFlowYaml(io, project, entries);
    const yaml = io.read(join(project, 'project.yml')).toString('utf8');
    expect(yaml).toContain('!id');
    expect(yaml).toContain('!include');
    expect(yaml).not.toContain('item-999');
    const compiled = compileFlowYaml(io, project, yaml, 'tflx');
    expect(compiled.errors).toEqual([]);
    expect(jsonBytes(compiled.document)).toEqual(jsonBytes(doc));
    expect(compiled.files.get('opaque.bin')).toEqual(Buffer.from([0, 255, 9]));
  });
  it.each([
    '!!python/object/apply:os.system [whoami]',
    'format: one\nformat: two\n',
    'a: &a [*a]',
    'a: &anchor 1',
    '? [x,y]\n: z',
    'true: value',
    '1: value',
    'null: value',
  ])('rejects unsafe/ambiguous YAML %s', (invalid) => {
    expect(() => new CompactYaml().load(invalid)).toThrow();
  });
  it('keeps YAML on/off/date strings, rejects invalid JSON and preserves precision', () => {
    const parsed = new CompactYaml().load('on: off\ndate: 2026-01-01\nyes: yes\n');
    expect(parsed).toEqual({ on: 'off', date: '2026-01-01', yes: 'yes' });
    for (const text of ['{"x":1,"x":2}', '{"x":NaN}', '{"x":1} trailing', '[1,]', '{"x":01}'])
      expect(() => parseJson(Buffer.from(text))).toThrow();
    expect(parseJson(Buffer.from('{"x":9007199254740993}'))).toEqual({ x: 9007199254740993n });
    expect(() => parseJson(Buffer.from('{"x":0.1234567890123456789012345}'))).toThrow(
      'NUMERIC_PRECISION_UNSUPPORTED',
    );
    const { request, prepared } = prepare();
    expect(() =>
      preview(
        request,
        prepared.yaml!.replace(
          'flow:\n',
          'flow:\n  preciseExtension: 0.1234567890123456789012345\n',
        ),
      ),
    ).toThrow('NUMERIC_PRECISION_UNSUPPORTED');
  });
  it('preserves integral float tokens and rejects them in strict integer version fields', () => {
    const native = parseJson(Buffer.from('{"x":1.0,"values":[1.0,2.5],"large":9007199254740993}'));
    expect(jsonBytes(native).toString('utf8')).toContain('"x":1.0');
    const codec = new CompactYaml();
    expect(jsonBytes(codec.load(codec.dump(object(native))))).toEqual(jsonBytes(native));
    const { request, prepared } = prepare();
    const yaml = prepared.yaml!.replace('flow:\n', 'flow:\n  majorVersion: 1.0\n');
    expect(preview(request, yaml).valid).toBe(false);
  });

  it('enforces item/depth limits after combining external JSON includes', () => {
    writeFileSync(join(workspace, 'many.json'), JSON.stringify(Array(60000).fill('x')));
    const { request, prepared } = prepare('tflx', ['many.json']);
    const yaml = prepared.yaml!.replace(
      'flow:\n',
      'flow:\n  first: !include user-resources/many.json\n  second: !include user-resources/many.json\n',
    );
    expect(() => preview(request, yaml)).toThrow();
  });
  it('blocks preview after a base resource changes', () => {
    const { request, prepared } = prepare();
    writeFileSync(
      join(
        workspace,
        '.tableau-prep-mcp',
        String(request.jobId),
        'base/project.resources/sales.csv',
      ),
      'changed',
    );
    expect(() => preview(request, prepared.yaml!)).toThrow('SOURCE_CHANGED');
  });
  it.each(['project', 'archive'] as const)('blocks generation after %s changes', (changed) => {
    const { request, prepared } = prepare(),
      candidate = preview(request, prepared.yaml!);
    const attempt = join(
      workspace,
      '.tableau-prep-mcp',
      String(request.jobId),
      candidate.previewId!,
    );
    writeFileSync(
      join(attempt, changed === 'project' ? 'project/project.resources/sales.csv' : 'preview.tflx'),
      'changed',
    );
    expect(() => generate(request, candidate, prepared.yaml!)).toThrow('STALE_PREVIEW');
    expect(existsSync(join(attempt, 'generated.tflx'))).toBe(false);
  });
  it('preserves an existing output and rejects hardlinked source files', () => {
    const { request, prepared } = prepare(),
      candidate = preview(request, prepared.yaml!),
      target = join(
        workspace,
        '.tableau-prep-mcp',
        String(request.jobId),
        candidate.previewId!,
        'generated.tflx',
      );
    writeFileSync(target, 'KEEP');
    expect(() => generate(request, candidate, prepared.yaml!)).toThrow();
    expect(readFileSync(target, 'utf8')).toBe('KEEP');
    const next = preview(request, prepared.yaml!);
    const generated = generate(request, next, prepared.yaml!);
    const alias = join(workspace, 'alias.tflx');
    linkSync(join(workspace, generated.path!), alias);
    expect(() => io.read(alias)).toThrow();
    expect(() =>
      run({
        workspace,
        jobId: randomUUID(),
        format: 'tflx',
        operation: 'prepare',
        source: { type: 'local', path: 'alias.tflx' },
      }),
    ).toThrow();
  });
  it.each([
    '../outside.csv',
    '/outside.csv',
    'C:/outside.csv',
    'CON/file.csv',
    'folder/../outside.csv',
  ])('blocks escaping/unsupported resource path %s', (path) => {
    const { request, prepared } = prepare();
    expect(() =>
      preview(request, prepared.yaml!.replaceAll('project.resources/sales.csv', path)),
    ).toThrow();
  });
  it('imports a replacement JSON values resource into a snapshot', () => {
    writeFileSync(join(workspace, 'choices.json'), '["A", "B"]');
    const { request, prepared } = prepare('tflx', ['choices.json']);
    expect(prepared.resources![0].path).toBe('user-resources/choices.json');
    const yaml = prepared.yaml!.replace(
      'flow:\n',
      'flow:\n  selectedValues: !include user-resources/choices.json\n',
    );
    expect(preview(request, yaml).valid).toBe(true);
  });
  it.each([
    ['class', 'postgres', 'DATABASE_PROVIDER_UNSUPPORTED'],
    ['password', 'FAKE_SECRET', 'CREDENTIAL_METADATA_UNSUPPORTED'],
  ] as const)(
    'rejects %s before disclosing/writing original metadata',
    (attribute, value, code) => {
      const doc = document();
      object(doc.flow).connections = { x: { connectionAttributes: { [attribute]: value } } };
      const entries = new Map(Object.entries(doc).map(([k, v]) => [k, jsonBytes(v)]));
      expect(() =>
        run({
          workspace,
          jobId: randomUUID(),
          format: 'tflx',
          operation: 'prepare',
          source: { type: 'download', base64: writeNativeArchive(entries).toString('base64') },
        }),
      ).toThrow(code);
    },
  );
  it('keeps owner context distinct from authentication and classifies the original policy', () => {
    expect(() =>
      scopeCheck({ ownerUserId: 'owner', server: 'https://tableau.invalid' }),
    ).not.toThrow();
    for (const input of [
      { connectionAttributes: { username: 'someone' } },
      { server: 'https://user:FAKE_PASSWORD@tableau.invalid' },
      { headers: { Authorization: 'Bearer FAKE' } },
    ] as Json[])
      expect(() => scopeCheck(input)).toThrow('CREDENTIAL_METADATA_UNSUPPORTED');
    expect(credentialKind('ssl-client-key-file')).toBe('locator');
    expect(credentialKind('authentication-mode')).toBe('metadata');
    expect(credentialKind('accessKeyId')).toBe('principal');
  });
  it('rejects graph aliases that collide, missing connections and invalid IDs', () => {
    const { request, prepared } = prepare();
    const missing = prepared.yaml!.replace(
      /connectionId:\s+!id\s+(?:'csv'|"csv"|csv)/,
      'connectionId: !id missing',
    );
    expect(missing).not.toBe(prepared.yaml);
    expect(preview(request, missing).valid).toBe(false);
    expect(() =>
      preview(request, prepared.yaml!.replace(/!id\s+(?:'csv'|"csv"|csv)/, '!id 1bad')),
    ).toThrow();
    expect(() => preview(request, prepared.yaml! + '\nunsupportedProjectKey: true\n')).toThrow();
  });
  it('checks CRC/length/path/size archive boundaries using actual packages', () => {
    const doc = document(),
      entries = new Map(Object.entries(doc).map(([k, v]) => [k, jsonBytes(v)]));
    const archive = writeNativeArchive(entries),
      corrupted = Buffer.from(archive);
    corrupted[40] ^= 255;
    expect(() => readNativeArchive(corrupted)).toThrow();
    expect(() => readNativeArchive(Buffer.alloc(MAX_FILE + 1))).toThrow();
    expect(() =>
      writeNativeArchive(new Map([...entries, ['../evil', Buffer.from('bad')]])),
    ).toThrow();
    expect(() => writeNativeArchive(new Map([...entries, ['FLOW', Buffer.from('bad')]]))).toThrow();
  });
  it('preserves the byte-identical matching JSON schema', () => {
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(
      digest(readFileSync(resolve('src/tools/web/prepAuthoring/tableau_prep_flow.schema.json'))),
    ).toBe('797bdd3646435d9f0849af34108747bb2be77d5d0e97dedfc684bcfd589a58d4');
  });
  const corpus = process.env.PREP_REFERENCE_CORPUS;
  const packages = corpus
    ? readdirSync(corpus).filter((name) => ['.tfl', '.tflx'].includes(extname(name).toLowerCase()))
    : [];
  it.skipIf(!corpus).each(packages.length ? packages : ['unconfigured'])(
    'round-trips every native metadata/attachment entry: %s',
    (name) => {
      const bytes = readFileSync(join(corpus!, name)),
        before = readNativeArchive(bytes),
        project = join(workspace, 'corpus');
      io.mkdir(project, true);
      exportFlowYaml(io, project, before);
      const compiled = compileFlowYaml(
        io,
        project,
        io.read(join(project, 'project.yml')).toString('utf8'),
        extname(name).slice(1) as PackageType,
      );
      expect(compiled.errors).toEqual([]);
      for (const [entry, value] of before) {
        if (Object.hasOwn(compiled.document, entry))
          expect(jsonBytes(compiled.document[entry])).toEqual(jsonBytes(parseJson(value)));
        else expect(compiled.files.get(entry)).toEqual(value);
      }
      expect(Object.keys(compiled.document).length + compiled.files.size).toBe(before.size);
    },
  );
});
