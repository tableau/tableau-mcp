/**
 * Shared types for the scoped data-app workspace boundary.
 *
 * A "data app" is a static, server-managed workspace of UTF-8/binary source files that is later
 * packaged into an immutable validated TWBX and published. Every workspace and validation record is
 * bound to a {@link WorkspaceScope}; public contracts refer to workspaces and validations only by
 * opaque, randomly generated IDs (`appId` / `validationId`), never by filesystem paths.
 */

/**
 * A stable identity for the owner of a workspace/validation. It is derived from server-verified
 * signals (authenticated Tableau identity, MCP session, or the single-user stdio process) and never
 * from a value supplied by the tool caller. A raw PAT/token is never used as any part of this scope.
 */
export type WorkspaceScope = {
  /** The Tableau server origin the caller is bound to. */
  server: string;
  /** The Tableau site id (or a deterministic stand-in for session/stdio scopes). */
  siteId: string;
  /** The opaque actor identity (e.g. `user:<luid>`, `session:<id>`, or the local stdio actor). */
  actorId: string;
};

/** A single caller-supplied file to write into a workspace. */
export type DataAppFileInput = {
  /** Workspace-relative POSIX path (e.g. `src/app.js`). */
  path: string;
  /** UTF-8 string or raw bytes to store. */
  content: string | Uint8Array;
};

/** Metadata describing a stored workspace file. Bytes are not returned here. */
export type DataAppFile = {
  /** Workspace-relative POSIX path. */
  path: string;
  /** Size of the stored file in bytes. */
  bytes: number;
};

/**
 * Result of one atomic workspace-file upsert operation.
 *
 * The digest is computed by the store from the post-write workspace state before the operation
 * returns, so callers cannot accidentally pair the written-file list with a later snapshot.
 */
export type DataAppUpsertResult = {
  files: DataAppFile[];
  digest: string;
};

/** Input for creating a new workspace. */
export type CreateWorkspaceInput = {
  appName: string;
  packageId: string;
  template?: string;
  /** Optional initial files (e.g. a scaffold) written atomically as part of creation. */
  files?: DataAppFileInput[];
};

/** A workspace record and its current file manifest. */
export type DataAppWorkspace = {
  appId: string;
  appName: string;
  packageId: string;
  template: string;
  files: DataAppFile[];
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  /**
   * Absolute local path to the workspace files, exposed only when local-path mode is explicitly
   * enabled for a single-user stdio deployment. Undefined for all hosted/HTTP callers.
   */
  localPath?: string;
};

/** An immutable, point-in-time capture of every publishable workspace file plus a content digest. */
export type DataAppSnapshot = {
  appId: string;
  files: Array<{ path: string; content: Uint8Array }>;
  /** SHA-256 over the ordered (path, bytes) pairs of {@link DataAppSnapshot.files}. */
  digest: string;
  createdAt: Date;
};

/**
 * An immutable validation receipt. The stored `bytes` are the exact package that was validated and
 * that publication must upload verbatim; they never change if the workspace source changes later.
 * `createdAt`/`expiresAt` are assigned by the store on save and are always present on read.
 */
export type ValidatedPackage = {
  validationId: string;
  appId: string;
  /** The exact validated package bytes (e.g. a TWBX). Immutable once saved. */
  bytes: Uint8Array;
  /** SHA-256 of {@link ValidatedPackage.bytes}. */
  digest: string;
  /** The workspace {@link DataAppSnapshot.digest} the package was built from. */
  sourceDigest: string;
  /**
   * The display name the package was validated under. Publication reads this from the receipt (never
   * from the mutable workspace) so it uploads the exact metadata that was validated. Optional only
   * for backward compatibility with receipts written before this field existed.
   */
  workbookName?: string;
  warnings?: string[];
  checksPerformed?: string[];
  byteLength?: number;
  createdAt?: Date;
  expiresAt?: Date;
};
