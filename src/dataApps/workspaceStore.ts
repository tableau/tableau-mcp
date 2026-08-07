/**
 * The provider boundary for scoped data-app storage.
 *
 * Tools depend only on this interface, obtained via `getDataAppWorkspaceStore()` (see `init.ts`), so
 * the default contained-filesystem provider can be swapped for a hosted shared-object-store provider
 * without changing any tool. Every method is bound to a {@link WorkspaceScope}; handles cannot cross
 * actor/site/session boundaries, and no method accepts a caller-selected output directory.
 */

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

export interface DataAppWorkspaceStore {
  /** Create a new workspace under `scope` and return it with an opaque `appId`. */
  create(scope: WorkspaceScope, input: CreateWorkspaceInput): Promise<DataAppWorkspace>;

  /** Load a workspace by opaque id. Rejects if it is missing, expired, or in another scope. */
  get(scope: WorkspaceScope, appId: string): Promise<DataAppWorkspace>;

  /** List the current file manifest for a workspace. */
  listFiles(scope: WorkspaceScope, appId: string): Promise<DataAppFile[]>;

  /** Read the raw bytes of a single workspace file, enforcing path containment. */
  readFile(scope: WorkspaceScope, appId: string, path: string): Promise<Uint8Array>;

  /**
   * Atomically write a batch of files and return its post-write workspace digest. Nothing is
   * written if any file fails validation/limits, and the digest is coupled to this operation rather
   * than obtained from a later snapshot call.
   */
  upsertFiles(
    scope: WorkspaceScope,
    appId: string,
    files: DataAppFileInput[],
  ): Promise<DataAppUpsertResult>;

  /** Capture an immutable snapshot of every publishable file plus a content digest. */
  snapshot(scope: WorkspaceScope, appId: string): Promise<DataAppSnapshot>;

  /** Persist an immutable validation receipt; assigns and returns its lifecycle timestamps. */
  saveValidation(scope: WorkspaceScope, validation: ValidatedPackage): Promise<void>;

  /** Load a validation receipt by opaque id. Rejects if missing, expired, or in another scope. */
  getValidation(scope: WorkspaceScope, validationId: string): Promise<ValidatedPackage>;

  /** Remove all workspaces and validations whose TTL has elapsed. */
  deleteExpired(now?: Date): Promise<void>;
}

export type {
  CreateWorkspaceInput,
  DataAppFile,
  DataAppFileInput,
  DataAppSnapshot,
  DataAppUpsertResult,
  DataAppWorkspace,
  ValidatedPackage,
  WorkspaceScope,
};
