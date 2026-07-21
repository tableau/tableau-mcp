/**
 * A minimal, in-memory `DataAppWorkspaceStore` test double shared by the data-app tool unit tests.
 *
 * Tool-level tests should exercise this fake rather than the real `FileSystemWorkspaceStore` (which
 * already has exhaustive containment/limit/atomicity coverage in
 * `src/dataApps/fileSystemWorkspaceStore.test.ts`) so tool tests stay fast, avoid touching the real
 * filesystem, and focus on the tool's own concerns: scope derivation, param shaping, and error
 * mapping.
 */

import { createHash } from 'crypto';

import { generateOpaqueId } from '../../../dataApps/opaqueId.js';
import type {
  CreateWorkspaceInput,
  DataAppFile,
  DataAppFileInput,
  DataAppSnapshot,
  DataAppUpsertResult,
  DataAppWorkspace,
  ValidatedPackage,
  WorkspaceScope,
} from '../../../dataApps/types.js';
import type { DataAppWorkspaceStore } from '../../../dataApps/workspaceStore.js';
import {
  DataAppValidationAlreadyExistsError,
  DataAppValidationNotFoundError,
  DataAppWorkspaceNotFoundError,
  UnsafeWorkspacePathError,
} from '../../../errors/mcpToolError.js';

type Entry = {
  scopeKey: string;
  workspace: DataAppWorkspace;
  fileContents: Map<string, Uint8Array>;
};

// A stored validation receipt (immutable bytes + metadata), keyed like the real store by scope so a
// different actor scope cannot read another scope's receipt.
type ValidationEntry = { scopeKey: string; validation: ValidatedPackage };

/** Files ordinary upserts may never overwrite, mirroring the real store's protection. */
const PROTECTED_FILES = new Set(['dataapp.json']);

export class FakeWorkspaceStore implements DataAppWorkspaceStore {
  private readonly entries = new Map<string, Entry>();
  private readonly validations = new Map<string, ValidationEntry>();
  /** TTL applied to saved validations, mirroring the real store's expiry assignment. */
  validationTtlMs = 60_000;
  /** When set, `create`/`get` populate `DataAppWorkspace.localPath` from this function's result. */
  localPathFor?: (appId: string) => string | undefined;

  async create(scope: WorkspaceScope, input: CreateWorkspaceInput): Promise<DataAppWorkspace> {
    const appId = generateOpaqueId();
    const fileContents = new Map<string, Uint8Array>();
    const files: DataAppFile[] = [];
    for (const file of input.files ?? []) {
      const bytes = toBytes(file.content);
      fileContents.set(file.path, bytes);
      files.push({ path: file.path, bytes: bytes.byteLength });
    }
    const now = new Date();
    const workspace: DataAppWorkspace = {
      appId,
      appName: input.appName,
      packageId: input.packageId,
      template: input.template ?? 'static-html',
      files,
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
      localPath: this.localPathFor?.(appId),
    };
    this.entries.set(this.key(scope, appId), {
      scopeKey: this.scopeKey(scope),
      workspace,
      fileContents,
    });
    return workspace;
  }

  async get(scope: WorkspaceScope, appId: string): Promise<DataAppWorkspace> {
    return this.load(scope, appId).workspace;
  }

  async listFiles(scope: WorkspaceScope, appId: string): Promise<DataAppFile[]> {
    return this.load(scope, appId).workspace.files;
  }

  async readFile(scope: WorkspaceScope, appId: string, path: string): Promise<Uint8Array> {
    const entry = this.load(scope, appId);
    const bytes = entry.fileContents.get(path);
    if (!bytes) {
      throw new DataAppWorkspaceNotFoundError(`File not found in workspace: ${path}`);
    }
    return bytes;
  }

  async upsertFiles(
    scope: WorkspaceScope,
    appId: string,
    files: DataAppFileInput[],
  ): Promise<DataAppUpsertResult> {
    const entry = this.load(scope, appId);

    // Validate the whole batch (protected-file check) before mutating anything, mirroring the real
    // store's atomic-preflight guarantee.
    for (const file of files) {
      if (PROTECTED_FILES.has(file.path)) {
        throw new UnsafeWorkspacePathError(
          `Cannot overwrite protected workspace file: ${file.path}`,
        );
      }
    }

    const upserted: DataAppFile[] = [];
    for (const file of files) {
      const bytes = toBytes(file.content);
      entry.fileContents.set(file.path, bytes);
      const record = { path: file.path, bytes: bytes.byteLength };
      const existingIndex = entry.workspace.files.findIndex((f) => f.path === file.path);
      if (existingIndex >= 0) {
        entry.workspace.files[existingIndex] = record;
      } else {
        entry.workspace.files.push(record);
      }
      upserted.push(record);
    }
    entry.workspace.updatedAt = new Date();
    return {
      files: upserted,
      digest: this.digestFor(entry),
    };
  }

  async snapshot(scope: WorkspaceScope, appId: string): Promise<DataAppSnapshot> {
    const entry = this.load(scope, appId);
    return {
      appId,
      files: entry.workspace.files.map((f) => ({
        path: f.path,
        content: entry.fileContents.get(f.path) ?? new Uint8Array(),
      })),
      digest: this.digestFor(entry),
      createdAt: new Date(),
    };
  }

  async saveValidation(scope: WorkspaceScope, validation: ValidatedPackage): Promise<void> {
    const key = `${this.scopeKey(scope)}\0${validation.validationId}`;
    if (this.validations.has(key)) {
      throw new DataAppValidationAlreadyExistsError();
    }
    const now = new Date();
    const bytes =
      validation.bytes instanceof Uint8Array ? validation.bytes : new Uint8Array(validation.bytes);
    // Store an immutable COPY of the bytes so later workspace mutation cannot change the receipt.
    this.validations.set(key, {
      scopeKey: this.scopeKey(scope),
      validation: {
        ...validation,
        bytes: new Uint8Array(bytes),
        digest: validation.digest || sha256Hex(bytes),
        byteLength: validation.byteLength ?? bytes.byteLength,
        createdAt: now,
        expiresAt: new Date(now.getTime() + this.validationTtlMs),
      },
    });
  }

  async getValidation(scope: WorkspaceScope, validationId: string): Promise<ValidatedPackage> {
    const entry = this.validations.get(`${this.scopeKey(scope)}\0${validationId}`);
    if (!entry || entry.scopeKey !== this.scopeKey(scope)) {
      throw new DataAppValidationNotFoundError();
    }
    if (entry.validation.expiresAt && entry.validation.expiresAt.getTime() <= Date.now()) {
      throw new DataAppValidationNotFoundError();
    }
    // Hand back a copy so a caller cannot mutate stored bytes in place.
    return { ...entry.validation, bytes: new Uint8Array(entry.validation.bytes) };
  }

  async deleteExpired(): Promise<void> {
    // no-op: TTL/expiry lifecycle is covered by the real store's tests.
  }

  private scopeKey(scope: WorkspaceScope): string {
    return `${scope.server}\0${scope.siteId}\0${scope.actorId}`;
  }

  private key(scope: WorkspaceScope, appId: string): string {
    return `${this.scopeKey(scope)}\0${appId}`;
  }

  private load(scope: WorkspaceScope, appId: string): Entry {
    const entry = this.entries.get(this.key(scope, appId));
    if (!entry || entry.scopeKey !== this.scopeKey(scope)) {
      throw new DataAppWorkspaceNotFoundError();
    }
    return entry;
  }

  // Content-addressed digest over the sorted (path, bytes) pairs, mirroring the real store so
  // identical content yields an identical digest and any file change changes it.
  private digestFor(entry: Entry): string {
    const hash = createHash('sha256');
    const paths = [...entry.workspace.files.map((f) => f.path)].sort();
    for (const path of paths) {
      const content = entry.fileContents.get(path) ?? new Uint8Array();
      hash.update(path);
      hash.update('\0');
      hash.update(String(content.byteLength));
      hash.update('\0');
      hash.update(content);
    }
    return hash.digest('hex');
  }
}

function toBytes(content: string | Uint8Array): Uint8Array {
  return typeof content === 'string' ? new TextEncoder().encode(content) : content;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
