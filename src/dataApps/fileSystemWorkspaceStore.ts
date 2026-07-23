/**
 * Default, contained-filesystem implementation of {@link DataAppWorkspaceStore}.
 *
 * Security model:
 *  - All state lives under a single server-controlled root. The root is `realpath`-resolved once so
 *    every derived path is symlink-free at its base and lexical containment checks are reliable.
 *  - Workspaces and validations are partitioned by a SHA-256 hash of the {@link WorkspaceScope}, so a
 *    different actor/site/server cannot even name another scope's directory.
 *  - Opaque ids are random hex; they contain no filesystem path characters.
 *  - Caller file paths are validated against traversal, absolute paths, backslashes, NUL bytes, and
 *    symlink components, and are confined to the workspace `files/` directory.
 *  - Writes are atomic (temp file in the same directory, then rename) and batches validate every
 *    input before mutating anything.
 *  - Validation bytes are stored as their own immutable file, so mutating workspace source afterward
 *    never changes a saved receipt.
 *
 * NOTE: because state is local, this provider requires sticky/single-instance hosting or a shared
 * volume. Hosted multi-instance deployments should supply a shared-object-store provider via
 * `init.ts` instead.
 */

import { createHash, randomBytes } from 'crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'fs';
import { dirname, join, relative, resolve, sep } from 'path';

import {
  DataAppValidationAlreadyExistsError,
  DataAppValidationNotFoundError,
  DataAppWorkspaceLimitExceededError,
  DataAppWorkspaceNotFoundError,
  UnsafeWorkspacePathError,
} from '../errors/mcpToolError.js';
import { generateOpaqueId, isOpaqueId, parseOpaqueId } from './opaqueId.js';
import type {
  CreateWorkspaceInput,
  DataAppFile,
  DataAppFileInput,
  DataAppSnapshot,
  DataAppUpsertResult,
  DataAppWorkspace,
  ValidatedPackage,
  WorkspaceScope,
} from './types.js';
import type { DataAppWorkspaceStore } from './workspaceStore.js';

/** Tool-managed files that ordinary upserts may never overwrite. */
export const PROTECTED_WORKSPACE_FILES: ReadonlySet<string> = new Set([
  caseInsensitivePathKey('dataapp.json'),
]);

export type FileSystemWorkspaceStoreOptions = {
  /** Server-controlled root directory. Created if missing. */
  root: string;
  workspaceTtlMs: number;
  validationTtlMs: number;
  maxFileCount: number;
  maxFileBytes: number;
  maxWorkspaceBytes: number;
  /** When true, {@link DataAppWorkspace.localPath} is populated on create/get. */
  exposeLocalPath?: boolean;
};

type WorkspaceMeta = {
  appId: string;
  scopeHash: string;
  appName: string;
  packageId: string;
  template: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  files: DataAppFile[];
};

type ValidationMeta = {
  validationId: string;
  scopeHash: string;
  appId: string;
  digest: string;
  sourceDigest: string;
  byteLength: number;
  warnings: string[];
  checksPerformed: string[];
  createdAt: string;
  expiresAt: string;
  /** Display name the package was validated under. Optional for pre-existing receipts. */
  workbookName?: string;
};

export class FileSystemWorkspaceStore implements DataAppWorkspaceStore {
  private readonly root: string;
  private readonly workspaceTtlMs: number;
  private readonly validationTtlMs: number;
  private readonly maxFileCount: number;
  private readonly maxFileBytes: number;
  private readonly maxWorkspaceBytes: number;
  private readonly exposeLocalPath: boolean;

  constructor(options: FileSystemWorkspaceStoreOptions) {
    mkdirSync(options.root, { recursive: true });
    // Resolve symlinks in the root once so all derived paths share a real, symlink-free base.
    this.root = realpathSync(options.root);
    this.workspaceTtlMs = options.workspaceTtlMs;
    this.validationTtlMs = options.validationTtlMs;
    this.maxFileCount = options.maxFileCount;
    this.maxFileBytes = options.maxFileBytes;
    this.maxWorkspaceBytes = options.maxWorkspaceBytes;
    this.exposeLocalPath = options.exposeLocalPath ?? false;
  }

  async create(scope: WorkspaceScope, input: CreateWorkspaceInput): Promise<DataAppWorkspace> {
    const scopeHash = hashScope(scope);
    const appId = generateOpaqueId();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.workspaceTtlMs);
    const filesDir = this.workspaceFilesDir(scopeHash, appId);
    mkdirSync(filesDir, { recursive: true });

    const inputs = input.files ?? [];
    const registry = this.validateBatch(filesDir, [], inputs, { allowProtected: true });
    for (const { resolvedPath, bytes } of registry.writes) {
      this.writeFileAtomic(resolvedPath, bytes);
    }

    const meta: WorkspaceMeta = {
      appId,
      scopeHash,
      appName: input.appName,
      packageId: input.packageId,
      template: input.template ?? 'live-extension',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      files: registry.files,
    };
    this.writeMeta(scopeHash, appId, meta);

    return this.toWorkspace(meta, filesDir);
  }

  async get(scope: WorkspaceScope, appId: string): Promise<DataAppWorkspace> {
    const meta = this.loadWorkspaceMeta(scope, appId);
    return this.toWorkspace(meta, this.workspaceFilesDir(meta.scopeHash, appId));
  }

  async listFiles(scope: WorkspaceScope, appId: string): Promise<DataAppFile[]> {
    return this.loadWorkspaceMeta(scope, appId).files;
  }

  async readFile(scope: WorkspaceScope, appId: string, path: string): Promise<Uint8Array> {
    const meta = this.loadWorkspaceMeta(scope, appId);
    const filesDir = this.workspaceFilesDir(meta.scopeHash, appId);
    const resolvedPath = this.resolveContainedPath(filesDir, path);
    const normalized = normalizePath(path);
    const caseVariant = meta.files.find(
      (file) =>
        caseInsensitivePathKey(file.path) === caseInsensitivePathKey(normalized) &&
        file.path !== normalized,
    );
    if (caseVariant) {
      throw new UnsafeWorkspacePathError(
        `Workspace path casing does not match stored path: ${normalized} and ${caseVariant.path}`,
      );
    }
    if (!existsSync(resolvedPath)) {
      throw new DataAppWorkspaceNotFoundError(`File not found in workspace: ${path}`);
    }
    return new Uint8Array(readFileSync(resolvedPath));
  }

  async upsertFiles(
    scope: WorkspaceScope,
    appId: string,
    files: DataAppFileInput[],
  ): Promise<DataAppUpsertResult> {
    const meta = this.loadWorkspaceMeta(scope, appId);
    const filesDir = this.workspaceFilesDir(meta.scopeHash, appId);

    // Validate the entire batch before mutating anything.
    const batch = this.validateBatch(filesDir, meta.files, files, { allowProtected: false });

    for (const { resolvedPath, bytes } of batch.writes) {
      mkdirSync(dirname(resolvedPath), { recursive: true });
      this.writeFileAtomic(resolvedPath, bytes);
    }

    meta.files = batch.files;
    meta.updatedAt = new Date().toISOString();
    this.writeMeta(meta.scopeHash, appId, meta);

    const upsertedPaths = new Set(files.map((f) => normalizePath(f.path)));
    return {
      files: meta.files.filter((f) => upsertedPaths.has(f.path)),
      // All provider work above and this digest computation are synchronous within this async
      // method (there is no await/interleaving point), so the returned digest identifies exactly
      // the post-write state produced by this operation.
      digest: this.buildSnapshot(meta, filesDir).digest,
    };
  }

  async snapshot(scope: WorkspaceScope, appId: string): Promise<DataAppSnapshot> {
    const meta = this.loadWorkspaceMeta(scope, appId);
    const filesDir = this.workspaceFilesDir(meta.scopeHash, appId);
    return this.buildSnapshot(meta, filesDir);
  }

  private buildSnapshot(meta: WorkspaceMeta, filesDir: string): DataAppSnapshot {
    const files = [...meta.files]
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map((file) => {
        const resolvedPath = this.resolveContainedPath(filesDir, file.path);
        return { path: file.path, content: new Uint8Array(readFileSync(resolvedPath)) };
      });

    const hash = createHash('sha256');
    for (const file of files) {
      hash.update(file.path);
      hash.update('\0');
      hash.update(String(file.content.byteLength));
      hash.update('\0');
      hash.update(file.content);
    }

    return {
      appId: meta.appId,
      files,
      digest: hash.digest('hex'),
      createdAt: new Date(),
    };
  }

  async saveValidation(scope: WorkspaceScope, validation: ValidatedPackage): Promise<void> {
    const scopeHash = hashScope(scope);
    const validationId = parseOpaqueId(validation.validationId, 'validationId');
    const appId = parseOpaqueId(validation.appId, 'appId');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.validationTtlMs);
    const dir = this.validationsDir(scopeHash);
    mkdirSync(dir, { recursive: true });

    const bytes =
      validation.bytes instanceof Uint8Array ? validation.bytes : new Uint8Array(validation.bytes);
    const digest = validation.digest || sha256Hex(bytes);

    // Immutable payload: the exact validated bytes, written once as their own file.
    const bytesPath = this.validationBytesPath(scopeHash, validationId);
    try {
      this.writeFileExclusive(bytesPath, bytes);
    } catch (error) {
      if (isAlreadyExistsError(error)) {
        throw new DataAppValidationAlreadyExistsError();
      }
      throw error;
    }

    const meta: ValidationMeta = {
      validationId,
      scopeHash,
      appId,
      digest,
      sourceDigest: validation.sourceDigest,
      byteLength: bytes.byteLength,
      warnings: validation.warnings ?? [],
      checksPerformed: validation.checksPerformed ?? [],
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      ...(validation.workbookName !== undefined && { workbookName: validation.workbookName }),
    };
    try {
      this.writeFileExclusive(
        this.validationMetaPath(scopeHash, validationId),
        Buffer.from(JSON.stringify(meta), 'utf8'),
      );
    } catch (error) {
      rmSync(bytesPath, { force: true });
      if (isAlreadyExistsError(error)) {
        throw new DataAppValidationAlreadyExistsError();
      }
      throw error;
    }
  }

  async getValidation(scope: WorkspaceScope, validationId: string): Promise<ValidatedPackage> {
    const scopeHash = hashScope(scope);
    const metaPath = this.validationMetaPath(scopeHash, validationId);
    if (!existsSync(metaPath)) {
      throw new DataAppValidationNotFoundError();
    }
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as ValidationMeta;
    if (meta.scopeHash !== scopeHash || isExpired(meta.expiresAt)) {
      throw new DataAppValidationNotFoundError();
    }
    const bytesPath = this.validationBytesPath(scopeHash, validationId);
    if (!existsSync(bytesPath)) {
      throw new DataAppValidationNotFoundError();
    }

    return {
      validationId: meta.validationId,
      appId: meta.appId,
      bytes: new Uint8Array(readFileSync(bytesPath)),
      digest: meta.digest,
      sourceDigest: meta.sourceDigest,
      byteLength: meta.byteLength,
      warnings: meta.warnings,
      checksPerformed: meta.checksPerformed,
      createdAt: new Date(meta.createdAt),
      expiresAt: new Date(meta.expiresAt),
      ...(meta.workbookName !== undefined && { workbookName: meta.workbookName }),
    };
  }

  async deleteExpired(now: Date = new Date()): Promise<void> {
    if (!existsSync(this.root)) {
      return;
    }
    for (const scopeHash of safeReaddir(this.root)) {
      const workspacesDir = join(this.root, scopeHash, 'workspaces');
      for (const appId of safeReaddir(workspacesDir)) {
        if (!isOpaqueId(appId)) {
          continue;
        }
        const metaPath = this.workspaceMetaPath(scopeHash, appId);
        if (!existsSync(metaPath)) {
          continue;
        }
        try {
          const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as WorkspaceMeta;
          if (isExpired(meta.expiresAt, now)) {
            rmSync(join(workspacesDir, appId), { recursive: true, force: true });
          }
        } catch {
          // Corrupt metadata: remove the workspace defensively.
          rmSync(join(workspacesDir, appId), { recursive: true, force: true });
        }
      }

      const validationsDir = this.validationsDir(scopeHash);
      for (const entry of safeReaddir(validationsDir)) {
        if (!entry.endsWith('.json')) {
          continue;
        }
        const validationId = entry.slice(0, -'.json'.length);
        if (!isOpaqueId(validationId)) {
          continue;
        }
        const metaPath = this.validationMetaPath(scopeHash, validationId);
        try {
          const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as ValidationMeta;
          if (isExpired(meta.expiresAt, now)) {
            rmSync(metaPath, { force: true });
            rmSync(this.validationBytesPath(scopeHash, validationId), { force: true });
          }
        } catch {
          rmSync(metaPath, { force: true });
        }
      }
    }
  }

  // --- internals -------------------------------------------------------------

  private validateBatch(
    filesDir: string,
    existing: DataAppFile[],
    inputs: DataAppFileInput[],
    { allowProtected }: { allowProtected: boolean },
  ): { files: DataAppFile[]; writes: Array<{ resolvedPath: string; bytes: Uint8Array }> } {
    const registry = new Map(existing.map((f) => [f.path, f.bytes]));
    const caseInsensitivePaths = new Map<string, string>();
    const workspacePaths = new Set<string>();
    const writes: Array<{ resolvedPath: string; bytes: Uint8Array }> = [];

    for (const file of existing) {
      assertNoCaseCollision(caseInsensitivePaths, file.path);
      assertNoAncestorCollision(workspacePaths, file.path);
    }

    for (const input of inputs) {
      const normalized = normalizePath(input.path);
      const pathKey = caseInsensitivePathKey(normalized);
      if (!allowProtected && PROTECTED_WORKSPACE_FILES.has(pathKey)) {
        throw new UnsafeWorkspacePathError(
          `Cannot overwrite protected workspace file: ${normalized}`,
        );
      }
      assertNoCaseCollision(caseInsensitivePaths, normalized);
      assertNoAncestorCollision(workspacePaths, normalized);
      const resolvedPath = this.resolveContainedPath(filesDir, input.path);
      const bytes = toBytes(input.content);
      if (bytes.byteLength > this.maxFileBytes) {
        throw new DataAppWorkspaceLimitExceededError(
          `File ${normalized} is ${bytes.byteLength} bytes; the per-file limit is ${this.maxFileBytes} bytes.`,
        );
      }
      registry.set(normalized, bytes.byteLength);
      writes.push({ resolvedPath, bytes });
    }

    if (registry.size > this.maxFileCount) {
      throw new DataAppWorkspaceLimitExceededError(
        `Workspace would contain ${registry.size} files; the limit is ${this.maxFileCount}.`,
      );
    }

    let totalBytes = 0;
    for (const bytes of registry.values()) {
      totalBytes += bytes;
    }
    if (totalBytes > this.maxWorkspaceBytes) {
      throw new DataAppWorkspaceLimitExceededError(
        `Workspace would total ${totalBytes} bytes; the limit is ${this.maxWorkspaceBytes} bytes.`,
      );
    }

    const files: DataAppFile[] = [...registry.entries()]
      .map(([path, bytes]) => ({ path, bytes }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

    return { files, writes };
  }

  private resolveContainedPath(filesDir: string, rawPath: string): string {
    assertSafeRelativePath(rawPath);
    const normalized = normalizePath(rawPath);
    const resolvedPath = resolve(filesDir, normalized);

    // Lexical containment against the (already real) files directory.
    if (resolvedPath !== filesDir && !resolvedPath.startsWith(filesDir + sep)) {
      throw new UnsafeWorkspacePathError(`Path escapes the workspace: ${rawPath}`);
    }

    // Reject any symlink component so a symlink cannot redirect reads/writes outside the workspace.
    const rel = relative(filesDir, resolvedPath);
    if (rel) {
      let current = filesDir;
      for (const segment of rel.split(sep)) {
        const caseVariant = safeReaddir(current).find(
          (entry) =>
            caseInsensitivePathKey(entry) === caseInsensitivePathKey(segment) && entry !== segment,
        );
        if (caseVariant) {
          throw new UnsafeWorkspacePathError(
            `Workspace path casing conflicts with existing path: ${caseVariant} and ${segment}`,
          );
        }
        current = join(current, segment);
        const stat = lstatSync(current, { throwIfNoEntry: false });
        if (stat?.isSymbolicLink()) {
          throw new UnsafeWorkspacePathError(`Path contains a symlink component: ${rawPath}`);
        }
      }
    }

    return resolvedPath;
  }

  private writeFileAtomic(targetPath: string, bytes: Uint8Array): void {
    mkdirSync(dirname(targetPath), { recursive: true });
    const tempPath = `${targetPath}.${randomBytes(8).toString('hex')}.tmp`;
    writeFileSync(tempPath, bytes);
    renameSync(tempPath, targetPath);
  }

  private writeFileExclusive(targetPath: string, bytes: Uint8Array): void {
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, bytes, { flag: 'wx' });
  }

  private loadWorkspaceMeta(scope: WorkspaceScope, appId: string): WorkspaceMeta {
    const scopeHash = hashScope(scope);
    const metaPath = this.workspaceMetaPath(scopeHash, appId);
    if (!existsSync(metaPath)) {
      throw new DataAppWorkspaceNotFoundError();
    }
    const meta = JSON.parse(readFileSync(metaPath, 'utf8')) as WorkspaceMeta;
    if (meta.scopeHash !== scopeHash || isExpired(meta.expiresAt)) {
      throw new DataAppWorkspaceNotFoundError();
    }
    return meta;
  }

  private writeMeta(scopeHash: string, appId: string, meta: WorkspaceMeta): void {
    this.writeFileAtomic(
      this.workspaceMetaPath(scopeHash, appId),
      Buffer.from(JSON.stringify(meta), 'utf8'),
    );
  }

  private toWorkspace(meta: WorkspaceMeta, filesDir: string): DataAppWorkspace {
    return {
      appId: meta.appId,
      appName: meta.appName,
      packageId: meta.packageId,
      template: meta.template,
      files: meta.files,
      createdAt: new Date(meta.createdAt),
      updatedAt: new Date(meta.updatedAt),
      expiresAt: new Date(meta.expiresAt),
      ...(this.exposeLocalPath ? { localPath: filesDir } : {}),
    };
  }

  private scopeDir(scopeHash: string): string {
    return join(this.root, scopeHash);
  }

  private workspaceFilesDir(scopeHash: string, appId: string): string {
    return join(this.scopeDir(scopeHash), 'workspaces', parseOpaqueId(appId, 'appId'), 'files');
  }

  private workspaceMetaPath(scopeHash: string, appId: string): string {
    return join(this.scopeDir(scopeHash), 'workspaces', parseOpaqueId(appId, 'appId'), 'meta.json');
  }

  private validationsDir(scopeHash: string): string {
    return join(this.scopeDir(scopeHash), 'validations');
  }

  private validationMetaPath(scopeHash: string, validationId: string): string {
    return join(
      this.validationsDir(scopeHash),
      `${parseOpaqueId(validationId, 'validationId')}.json`,
    );
  }

  private validationBytesPath(scopeHash: string, validationId: string): string {
    return join(
      this.validationsDir(scopeHash),
      `${parseOpaqueId(validationId, 'validationId')}.bin`,
    );
  }
}

// --- module helpers ----------------------------------------------------------

function hashScope(scope: WorkspaceScope): string {
  return createHash('sha256')
    .update(scope.server)
    .update('\0')
    .update(scope.siteId)
    .update('\0')
    .update(scope.actorId)
    .digest('hex');
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function toBytes(content: string | Uint8Array): Uint8Array {
  return typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
}

function normalizePath(rawPath: string): string {
  return rawPath.replace(/^\.\//, '').replace(/\/+/g, '/');
}

function caseInsensitivePathKey(path: string): string {
  return path.normalize('NFC').toLowerCase();
}

function assertNoCaseCollision(paths: Map<string, string>, path: string): void {
  const key = caseInsensitivePathKey(path);
  const existingPath = paths.get(key);
  if (existingPath !== undefined && existingPath !== path) {
    throw new UnsafeWorkspacePathError(
      `Workspace paths differ only by case: ${existingPath} and ${path}`,
    );
  }
  paths.set(key, path);
}

function assertNoAncestorCollision(paths: Set<string>, path: string): void {
  const key = caseInsensitivePathKey(path);
  for (const existingPath of paths) {
    const existingKey = caseInsensitivePathKey(existingPath);
    if (key.startsWith(`${existingKey}/`) || existingKey.startsWith(`${key}/`)) {
      throw new UnsafeWorkspacePathError(
        `Workspace paths cannot be both a file and a directory: ${existingPath} and ${path}`,
      );
    }
  }
  paths.add(path);
}

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}

function isExpired(expiresAt: string, now: Date = new Date()): boolean {
  return now.getTime() >= new Date(expiresAt).getTime();
}

function safeReaddir(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function assertSafeRelativePath(rawPath: string): void {
  if (typeof rawPath !== 'string' || rawPath.trim() === '') {
    throw new UnsafeWorkspacePathError('Workspace file path must be a non-empty string.');
  }
  if (rawPath.includes('\0')) {
    throw new UnsafeWorkspacePathError('Workspace file path must not contain NUL bytes.');
  }
  if (rawPath.includes('\\')) {
    throw new UnsafeWorkspacePathError(
      `Workspace file path must not contain backslashes: ${rawPath}`,
    );
  }
  if (rawPath.startsWith('/') || /^[a-zA-Z]:/.test(rawPath)) {
    throw new UnsafeWorkspacePathError(`Workspace file path must be relative: ${rawPath}`);
  }
  const segments = normalizePath(rawPath).split('/');
  for (const segment of segments) {
    if (segment === '..' || segment === '.') {
      throw new UnsafeWorkspacePathError(
        `Workspace file path must not contain "${segment}": ${rawPath}`,
      );
    }
  }
}
