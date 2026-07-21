/**
 * Data-app workspace store initialization and provider factory.
 *
 * Tools obtain the store exclusively through {@link getDataAppWorkspaceStore}, so a hosted
 * shared-object-store provider can be injected later (via {@link setDataAppWorkspaceStore}) without
 * changing any tool. The default provider is the contained {@link FileSystemWorkspaceStore}, which
 * requires sticky/single-instance hosting or a shared volume in multi-instance deployments.
 */

import { getConfig } from '../config.js';
import { FileSystemWorkspaceStore } from './fileSystemWorkspaceStore.js';
import type { DataAppWorkspaceStore } from './workspaceStore.js';

let globalStore: DataAppWorkspaceStore | null = null;

/**
 * Get the process-wide data-app workspace store, lazily constructing the default filesystem provider
 * from configuration on first use.
 */
export function getDataAppWorkspaceStore(): DataAppWorkspaceStore {
  if (globalStore === null) {
    globalStore = createDefaultStore();
  }
  return globalStore;
}

/**
 * Inject a custom store (e.g. a hosted shared-object-store provider, or a test double). Intended to
 * be called once during startup before any tool resolves the store.
 */
export function setDataAppWorkspaceStore(store: DataAppWorkspaceStore): void {
  globalStore = store;
}

/** Reset the store singleton. For tests only. */
export function resetDataAppWorkspaceStore(): void {
  globalStore = null;
}

function createDefaultStore(): DataAppWorkspaceStore {
  const { dataApps } = getConfig();
  return new FileSystemWorkspaceStore({
    root: dataApps.workspaceRoot,
    workspaceTtlMs: dataApps.workspaceTtlMs,
    validationTtlMs: dataApps.validationTtlMs,
    maxFileCount: dataApps.maxFileCount,
    maxFileBytes: dataApps.maxFileBytes,
    maxWorkspaceBytes: dataApps.maxWorkspaceBytes,
    exposeLocalPath: dataApps.exposeLocalPath,
  });
}
