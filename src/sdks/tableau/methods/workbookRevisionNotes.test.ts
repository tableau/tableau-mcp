import type { InternalAxiosRequestConfig } from 'axios';

import WorkbooksMethods from './workbooksMethods.js';

const args = {
  siteId: 'site-1',
  workbookId: 'a1b2c3d4-5e6f-4a8b-9c0d-1e2f3a4b5c6d',
  revisionNumber: 17,
  notes: '  Revised total calculation\nSecond line.  ',
};

describe('updateWorkbookRevisionNotes REST request', () => {
  const createClient = () => {
    const adapter = vi.fn(async (config: InternalAxiosRequestConfig) => ({
      status: 204,
      statusText: 'No Content',
      headers: {},
      data: '',
      config,
    }));
    const client = new WorkbooksMethods(
      'https://tableau.example.com/api/3.30',
      { type: 'Bearer', token: 'test-auth-token' },
      { adapter },
    );
    return { adapter, client };
  };

  it('PATCHes JSON notes on the exact revision metadata route and accepts an empty 204', async () => {
    const { adapter, client } = createClient();
    await expect(client.updateWorkbookRevisionNotes(args)).resolves.toBeUndefined();
    expect(adapter).toHaveBeenCalledTimes(1);
    const request = adapter.mock.calls[0][0];
    expect(request.baseURL).toBe('https://tableau.example.com/api/3.30');
    expect(request.method).toBe('patch');
    expect(request.url).toBe(
      `/sites/${args.siteId}/workbooks/${args.workbookId}/revisions/${args.revisionNumber}/metadata`,
    );
    expect(request.headers.get('Authorization')).toBe('Bearer test-auth-token');
    expect(request.headers.get('Content-Type')).toContain('application/json');
    expect(JSON.parse(request.data)).toEqual({ notes: args.notes });
  });

  it('rejects non-positive, fractional, or unsafe revisions before issuing a request', async () => {
    const { adapter, client } = createClient();
    for (const revisionNumber of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(client.updateWorkbookRevisionNotes({ ...args, revisionNumber })).rejects.toThrow(
        'revisionNumber must be a positive integer.',
      );
    }
    expect(adapter).not.toHaveBeenCalled();
  });
});
