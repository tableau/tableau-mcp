import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';

import * as configModule from '../../../config.desktop.js';
import { getCacheDir } from '../../../desktop/cachePath.js';
import * as externalDiscovery from '../../../desktop/externalApi/discovery.js';
import {
  redactDatasourceCredentials,
  REDACTED_CREDENTIAL_SENTINEL,
} from '../../../desktop/limits/datasourceCredentialRedaction.js';
import { runApplyPreamble } from './applyPreamble.js';

describe('runApplyPreamble redacted-credential guard', () => {
  const temporaryPaths: string[] = [];

  beforeEach(() => {
    vi.spyOn(configModule, 'getDesktopConfig').mockReturnValue({
      ...new configModule.Config(),
      desktopSessionId: '7',
    } as configModule.Config);
    vi.spyOn(externalDiscovery, 'discoverInstances').mockReturnValue([
      { pid: 7, instanceId: 'inst' } as ReturnType<
        typeof externalDiscovery.discoverInstances
      >[number],
    ]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    for (const path of temporaryPaths.splice(0)) {
      rmSync(path, { recursive: true, force: true });
    }
  });

  function cachedFile(xml: string): string {
    const directory = mkdtempSync(join(getCacheDir(), 'apply-preamble-redaction-'));
    temporaryPaths.push(directory);
    const file = join(directory, 'doc.xml');
    writeFileSync(file, xml);
    return file;
  }

  function run(
    kind: 'datasource' | 'workbook' | 'worksheet' | 'dashboard',
    file: string,
  ): ReturnType<typeof runApplyPreamble> {
    return runApplyPreamble({
      kind,
      file,
      session: '7',
      emptyPathGuidance: '',
      notFoundGuidance: '',
    });
  }

  const redacted = redactDatasourceCredentials(
    "<workbook><connection password='hunter2'/></workbook>",
  );

  it.each(['datasource', 'workbook', 'worksheet', 'dashboard'] as const)(
    'refuses a redacted %s file',
    (kind) => {
      const result = run(kind, cachedFile(redacted));

      expect(result.isErr()).toBe(true);
      const error = result.unwrapErr();
      expect(error.type).toBe('args-validation');
      expect(error.message).toContain('redacted');
      expect(redacted).toContain(REDACTED_CREDENTIAL_SENTINEL);
    },
  );

  it('refuses before resolving the session', () => {
    run('workbook', cachedFile(redacted));

    expect(externalDiscovery.discoverInstances).not.toHaveBeenCalled();
  });

  it('accepts a worksheet file without the sentinel', () => {
    expect(run('worksheet', cachedFile('<worksheet name="s"/>')).isOk()).toBe(true);
  });

  it('accepts a datasource whose credential attribute is genuinely empty', () => {
    expect(run('datasource', cachedFile("<connection password=''/>")).isOk()).toBe(true);
  });
});
