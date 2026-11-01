import { readdirSync } from 'node:fs';
import { basename, extname, join, relative, sep } from 'node:path';

import {
  buildFlowPackage,
  compileFlowYaml,
  exportFlowYaml,
  newFlowYaml,
  PackageType,
} from './authoringCompiler.js';
import { CompactYaml, jsonBytes, object, parseJson } from './compactYaml.js';
import { scopeCheck } from './credentialPolicy.js';
import type { EngineResult } from './engineClient.js';
import { knownEntries, summary } from './metadata.js';
import { readNativeArchive } from './nativeArchive.js';
import { AuthoringError, digest, identity, MAX_FILE, MAX_YAML, ProjectIo } from './projectIo.js';

/** Isolated Node worker entry; no network, native execution, scripts or credentials. */
export function runAuthoringEngine(request: Record<string, unknown>): EngineResult {
  if (typeof request.workspace !== 'string' || !['tfl', 'tflx'].includes(String(request.format)))
    throw new AuthoringError();
  const io = new ProjectIo(request.workspace),
    format = request.format as PackageType;
  const cache = io.path('.tableau-prep-mcp');
  io.mkdir(cache);
  const job = io.path(identity(request.jobId), cache),
    base = join(job, 'base');
  if (request.operation === 'prepare') {
    if (readdirSync(cache).length >= 20) throw new AuthoringError('WORKSPACE_PROJECT_LIMIT');
    io.mkdir(job, true);
    io.mkdir(base, true);
    const source = object(request.source);
    let sourceSha256: string | null = null;
    if (source.type === 'new') newFlowYaml(io, base, format);
    else {
      let bytes: Buffer;
      if (
        source.type === 'local' &&
        typeof source.path === 'string' &&
        ['.tfl', '.tflx'].includes(extname(source.path).toLowerCase())
      )
        bytes = io.read(io.path(source.path));
      else if (
        source.type === 'download' &&
        typeof source.base64 === 'string' &&
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(source.base64)
      )
        bytes = Buffer.from(source.base64, 'base64');
      else throw new AuthoringError();
      if (bytes.length > MAX_FILE) throw new AuthoringError();
      const entries = readNativeArchive(bytes);
      const document = Object.fromEntries(
        knownEntries.map((name) => [name, parseJson(entries.get(name) ?? Buffer.alloc(0))]),
      );
      scopeCheck(document);
      sourceSha256 = digest(bytes);
      io.write(join(job, 'original.tflx'), bytes);
      exportFlowYaml(io, base, entries);
    }
    const resources: NonNullable<EngineResult['resources']> = [];
    const selected = request.resources ?? [];
    if (!Array.isArray(selected) || selected.length > 20) throw new AuthoringError();
    for (const name of selected) {
      if (
        typeof name !== 'string' ||
        !['.csv', '.tsv', '.xlsx', '.xls', '.json', '.hyper', '.tde', '.txt'].includes(
          extname(name).toLowerCase(),
        )
      )
        throw new AuthoringError();
      const original = io.path(name),
        target = io.path('user-resources/' + basename(original), base),
        data = io.read(original);
      io.write(target, data);
      resources.push({
        path: relative(base, target).split(sep).join('/'),
        bytes: data.length,
        sha256: digest(data),
      });
    }
    const yaml = io.read(join(base, 'project.yml'), MAX_YAML).toString('utf8');
    const compiled = compileFlowYaml(io, base, yaml, format);
    scopeCheck(compiled.document);
    return {
      ok: true,
      valid: !compiled.errors.length,
      yaml,
      projectSha256: io.manifest(base).sha256,
      sourceSha256,
      resources,
      summary: summary(compiled.document),
      nativeExecutionVerified: false,
    };
  }
  if (io.manifest(base).sha256 !== request.projectSha256)
    throw new AuthoringError('SOURCE_CHANGED');
  if (request.operation === 'preview') {
    if (typeof request.yaml !== 'string' || Buffer.byteLength(request.yaml) > MAX_YAML)
      throw new AuthoringError();
    scopeCheck(new CompactYaml().load(request.yaml));
    const previewId = identity(request.previewId),
      attempt = io.path(previewId, job),
      project = join(attempt, 'project');
    io.mkdir(attempt, true);
    io.mkdir(project, true);
    io.copy(base, project);
    const candidate = join(project, 'project.yml');
    io.replacePrivate(candidate, request.yaml);
    const compiled = compileFlowYaml(io, project, request.yaml, format);
    scopeCheck(compiled.document);
    if (compiled.errors.length)
      return {
        ok: true,
        valid: false,
        errorCount: compiled.errors.length,
        errors: compiled.errors.slice(0, 20).map((e) => e.slice(0, 256)),
        nativeExecutionVerified: false,
      };
    const payload = buildFlowPackage(compiled),
      previewSha256 = digest(payload);
    io.write(join(attempt, 'preview.' + format), payload);
    if (io.read(candidate, MAX_YAML).toString('utf8') !== request.yaml)
      throw new AuthoringError('SOURCE_CHANGED');
    const receipt = {
      format,
      yamlSha256: digest(request.yaml),
      previewSha256,
      projectSha256: io.manifest(project).sha256,
      baseSha256: request.projectSha256 as string,
      summary: summary(compiled.document),
    };
    io.write(join(attempt, 'receipt.json'), jsonBytes(receipt));
    return {
      ok: true,
      valid: true,
      previewId,
      previewSha256,
      bytes: payload.length,
      nodeCount: Object.keys(object(object(compiled.document.flow).nodes)).length,
      attachmentCount: compiled.files.size,
      summary: receipt.summary,
      nativeExecutionVerified: false,
    };
  }
  if (request.operation === 'generate') {
    const attempt = io.path(identity(request.previewId), job),
      receipt = object(parseJson(io.read(join(attempt, 'receipt.json'), MAX_YAML)));
    if (
      receipt.previewSha256 !== request.previewSha256 ||
      receipt.yamlSha256 !== request.yamlSha256 ||
      receipt.baseSha256 !== request.projectSha256 ||
      receipt.format !== format ||
      io.manifest(join(attempt, 'project')).sha256 !== receipt.projectSha256
    )
      throw new AuthoringError('STALE_PREVIEW');
    const payload = io.read(join(attempt, 'preview.' + format));
    if (digest(payload) !== request.previewSha256) throw new AuthoringError('STALE_PREVIEW');
    const target = join(attempt, 'generated.' + format);
    io.publish(target, payload);
    if (digest(io.read(target)) !== receipt.previewSha256)
      throw new AuthoringError('STALE_PREVIEW');
    return {
      ok: true,
      valid: true,
      path: relative(io.root, target).split(sep).join('/'),
      bytes: payload.length,
      sha256: String(receipt.previewSha256),
      summary: summaryFromReceipt(receipt.summary),
      nativeExecutionVerified: false,
    };
  }
  throw new AuthoringError();
}
function summaryFromReceipt(value: unknown): NonNullable<EngineResult['summary']> {
  const result = object(value);
  if (
    typeof result.hasScriptSteps !== 'boolean' ||
    typeof result.hasInputUnion !== 'boolean' ||
    typeof result.hasFileInputs !== 'boolean'
  )
    throw new AuthoringError();
  return {
    hasScriptSteps: result.hasScriptSteps,
    hasInputUnion: result.hasInputUnion,
    hasFileInputs: result.hasFileInputs,
  };
}
