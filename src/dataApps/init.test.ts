import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { FileSystemWorkspaceStore } from './fileSystemWorkspaceStore.js';
import {
  getDataAppWorkspaceStore,
  resetDataAppWorkspaceStore,
  setDataAppWorkspaceStore,
} from './init.js';
import type { DataAppWorkspaceStore } from './workspaceStore.js';

const injectedStore = {} as DataAppWorkspaceStore;
let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'dataapp-init-'));
  vi.stubEnv('DATA_APP_WORKSPACE_ROOT', root);
});

afterAll(() => {
  resetDataAppWorkspaceStore();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe('data-app workspace store initialization', () => {
  it('uses an injected provider', () => {
    setDataAppWorkspaceStore(injectedStore);

    expect(getDataAppWorkspaceStore()).toBe(injectedStore);
  });

  it('starts the next test with a reset provider singleton', () => {
    const store = getDataAppWorkspaceStore();

    expect(store).toBeInstanceOf(FileSystemWorkspaceStore);
    expect(store).not.toBe(injectedStore);
    expect(getDataAppWorkspaceStore()).toBe(store);
  });
});
