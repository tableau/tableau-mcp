import { describe, expect, it } from 'vitest';

import { constructWebAuthoringUrl } from './authoringUrlUtils.js';

describe('constructWebAuthoringUrl', () => {
  it('constructs a named-site authoring URL', () => {
    expect(
      constructWebAuthoringUrl({
        server: 'https://tableau.example.com/',
        siteName: 'blackbear',
        workbookId: 'workbook-id',
        uploadSessionId: 'upload-id',
      }),
    ).toBe(
      'https://tableau.example.com/vizql/show/t/blackbear/authoring/newWorkbook/workbook-id/fromFileUpload/upload-id',
    );
  });

  it.each(['', 'Default'])('constructs a default-site authoring URL for %j', (siteName) => {
    expect(
      constructWebAuthoringUrl({
        server: 'https://tableau.example.com/existing/path?query=value#fragment',
        siteName,
        workbookId: 'workbook-id',
        uploadSessionId: 'upload-id',
      }),
    ).toBe(
      'https://tableau.example.com/vizql/show/authoring/newWorkbook/workbook-id/fromFileUpload/upload-id',
    );
  });

  it('encodes the site name and preserves Tableau identifiers', () => {
    expect(
      constructWebAuthoringUrl({
        server: 'https://tableau.example.com',
        siteName: 'my site',
        workbookId: 'new-workbook-id',
        uploadSessionId: '4840:upload-id-0:0',
      }),
    ).toBe(
      'https://tableau.example.com/vizql/show/t/my%20site/authoring/newWorkbook/new-workbook-id/fromFileUpload/4840:upload-id-0:0',
    );
  });
});
