import { z } from 'zod';

import { getDefaultEnv, getSuperstoreWorkbook, resetEnv, setEnv } from '../../testEnv.js';
import { McpClient } from '../mcpClient.js';

const REMOVED_TOOLS = ['list-pending-deletion-tags', 'remove-pending-deletion-tags'] as const;
// A cleanup batch no preview has ever opened, so it can never authorize anything.
const NEVER_OPENED_BATCH = '2000-01-01';

const listResultSchema = z.object({
  data: z.array(z.object({ id: z.string(), name: z.string() })),
});

const removeResultSchema = z.object({
  removedCount: z.number(),
  items: z.array(
    z.object({
      resourceId: z.string(),
      status: z.enum(['removed', 'no-markers', 'not-allowed', 'error']),
      removedTags: z.array(z.string()),
      message: z.string().optional(),
    }),
  ),
});

// Markers are found with the read-only list tools' tag filter (no dedicated list tool).
async function listMarked(
  client: McpClient,
  resourceType: 'workbook' | 'datasource',
  cleanupDate: string,
): Promise<{ id: string; name: string }[]> {
  try {
    const result = await client.callTool(
      resourceType === 'workbook' ? 'list-workbooks' : 'list-datasources',
      {
        schema: listResultSchema,
        toolArgs: { filter: `tags:eq:pending-deletion-${cleanupDate}` },
      },
    );
    return result.data;
  } catch (e) {
    // An empty match comes back as plain text ("No workbooks found...") rather than JSON.
    if (e instanceof SyntaxError) {
      return [];
    }
    throw e;
  }
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoUtc(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * E2E coverage for the pending-deletion marker lifecycle (W-24199845 / W-24311035):
 * delete-content's date-stamped `pending-deletion-YYYY-MM-DD` batch tag, and the admin-only
 * `action: "remove-pending-tags"` of delete-content (found via list-workbooks / list-datasources tag filters).
 *
 * Everything here is non-destructive. Nothing is ever confirmed for deletion: every confirm leg names
 * a batch the item was never tagged for (rejected by the tag gate) or one past the batch age limit
 * (rejected before the item is even read). The opt-in round trip (preview →
 * list → remove) is gated behind `PENDING_DELETION_E2E_WORKBOOK_ID` — set it to a disposable stale
 * workbook LUID. It only adds and then removes a marker tag.
 */
describe('pending-deletion tags', () => {
  let client: McpClient;
  let toolsAvailable = false;

  beforeAll(setEnv);
  afterAll(resetEnv);

  beforeAll(async () => {
    client = new McpClient({ env: { ...getDefaultEnv(), ADMIN_TOOLS_ENABLED: 'true' } });
    await client.connect();
    const tools = await client.listTools();
    toolsAvailable = tools.includes('delete-content');
    if (!toolsAvailable) {
      console.warn(
        'Skipping pending-deletion tag e2e tests — admin tools not registered. ' +
          'Ensure the caller is a site admin.',
      );
    }
  });

  afterAll(async () => {
    await client.close();
  });

  it('does not register standalone tag tools (consolidated into delete-content)', async () => {
    const tools = await client.listTools();
    for (const name of REMOVED_TOOLS) {
      expect(tools).not.toContain(name);
    }
  });

  it('rejects a future cleanupDate on delete-content at schema level', async () => {
    if (!toolsAvailable) {
      return;
    }
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await expect(
      client.callTool('delete-content', {
        schema: z.string(),
        toolArgs: {
          resourceType: 'workbook',
          resourceId: getSuperstoreWorkbook().id,
          confirm: true,
          cleanupDate: tomorrow,
        },
      }),
    ).rejects.toThrow(/future/);
  });

  it('rejects a back-dated preview without writing a tag', async () => {
    if (!toolsAvailable) {
      return;
    }
    await expect(
      client.callTool('delete-content', {
        schema: z.string(),
        toolArgs: {
          resourceType: 'workbook',
          resourceId: getSuperstoreWorkbook().id,
          cleanupDate: NEVER_OPENED_BATCH,
        },
      }),
    ).rejects.toThrow(/today's UTC date/);
  });

  it('rejects a confirm for a cleanup batch the item was never tagged for', async () => {
    if (!toolsAvailable) {
      return;
    }
    // A recent batch (inside the age limit) so the tag gate, not batch expiry, is what rejects it.
    const batch = daysAgoUtc(1);
    const workbookId = getSuperstoreWorkbook().id;
    const marked = await listMarked(client, 'workbook', batch);
    if (marked.some((i) => i.id === workbookId)) {
      console.warn(`Skipping — Superstore unexpectedly carries pending-deletion-${batch}.`);
      return;
    }
    await expect(
      client.callTool('delete-content', {
        schema: z.string(),
        toolArgs: {
          resourceType: 'workbook',
          resourceId: workbookId,
          confirm: true,
          cleanupDate: batch,
        },
      }),
    ).rejects.toThrow(/could not verify that a preview ran/);
  });

  it('rejects a confirm for a batch older than the default 30-day limit (batch expiry)', async () => {
    if (!toolsAvailable) {
      return;
    }
    for (const [cleanupDate, age] of [
      [daysAgoUtc(31), '31 days old'],
      [NEVER_OPENED_BATCH, 'days old'],
    ] as const) {
      await expect(
        client.callTool('delete-content', {
          schema: z.string(),
          toolArgs: {
            resourceType: 'workbook',
            resourceId: getSuperstoreWorkbook().id,
            confirm: true,
            cleanupDate,
          },
        }),
      ).rejects.toThrow(new RegExp(`${age}, past the 30-day limit[\\s\\S]*Nothing was deleted`));
    }
  });

  it('honors a configured PENDING_DELETION_MAX_AGE_DAYS', async () => {
    if (!toolsAvailable) {
      return;
    }
    const strictClient = new McpClient({
      env: { ...getDefaultEnv(), ADMIN_TOOLS_ENABLED: 'true', PENDING_DELETION_MAX_AGE_DAYS: '1' },
    });
    await strictClient.connect();
    try {
      await expect(
        strictClient.callTool('delete-content', {
          schema: z.string(),
          toolArgs: {
            resourceType: 'workbook',
            resourceId: getSuperstoreWorkbook().id,
            confirm: true,
            cleanupDate: daysAgoUtc(2),
          },
        }),
      ).rejects.toThrow(/2 days old, past the 1-day limit/);
    } finally {
      await strictClient.close();
    }
  });

  it('lists nothing for a batch that was never opened', async () => {
    if (!toolsAvailable) {
      return;
    }
    expect(await listMarked(client, 'workbook', NEVER_OPENED_BATCH)).toEqual([]);
  });

  it('remove is a no-op for a batch the item does not carry', async () => {
    if (!toolsAvailable) {
      return;
    }
    const workbookId = getSuperstoreWorkbook().id;
    const result = await client.callTool('delete-content', {
      schema: removeResultSchema,
      toolArgs: {
        action: 'remove-pending-tags',
        resourceType: 'workbook',
        resourceIds: [workbookId],
        cleanupDate: NEVER_OPENED_BATCH,
      },
    });
    expect(result.removedCount).toBe(0);
    expect(result.items).toEqual([
      { resourceId: workbookId, status: 'no-markers', removedTags: [] },
    ]);
  });

  it('remove reports a per-item error for an unknown id', async () => {
    if (!toolsAvailable) {
      return;
    }
    const result = await client.callTool('delete-content', {
      schema: removeResultSchema,
      toolArgs: {
        action: 'remove-pending-tags',
        resourceType: 'datasource',
        resourceIds: ['00000000-0000-4000-8000-000000000000'],
      },
    });
    expect(result.removedCount).toBe(0);
    expect(result.items[0].status).toBe('error');
  });

  it('preview → list → remove round trip on a disposable stale workbook (opt-in)', async () => {
    if (!toolsAvailable) {
      return;
    }
    const workbookId = process.env.PENDING_DELETION_E2E_WORKBOOK_ID;
    if (!workbookId) {
      console.warn(
        'Skipping round trip — set PENDING_DELETION_E2E_WORKBOOK_ID to a disposable stale workbook LUID.',
      );
      return;
    }
    const today = todayUtc();
    const batchTag = `pending-deletion-${today}`;

    let preview: string;
    try {
      preview = await client.callTool('delete-content', {
        schema: z.string(),
        toolArgs: { resourceType: 'workbook', resourceId: workbookId },
      });
    } catch (e) {
      // Fail-closed paths are valid outcomes on a site where the item is not (yet) stale in
      // Admin Insights; the tag must then NOT have been written.
      expect(String(e)).toMatch(/no longer meets|could not verify|not found in Admin Insights/);
      const listed = await listMarked(client, 'workbook', today);
      expect(listed.map((i) => i.id)).not.toContain(workbookId);
      return;
    }

    try {
      expect(preview).toContain('Nothing has been deleted');
      expect(preview).toContain(batchTag);

      // The tag-filter index lags tag writes by a few seconds, so poll rather than assert once.
      await vi.waitFor(
        async () => {
          const listed = await listMarked(client, 'workbook', today);
          expect(listed.map((i) => i.id)).toContain(workbookId);
        },
        { timeout: 30_000, interval: 2_000 },
      );
    } finally {
      // Always clear the marker, even if an assertion above failed.
      const removed = await client.callTool('delete-content', {
        schema: removeResultSchema,
        toolArgs: {
          action: 'remove-pending-tags',
          resourceType: 'workbook',
          resourceIds: [workbookId],
          cleanupDate: today,
        },
      });
      expect(removed.items[0]).toMatchObject({ status: 'removed', removedTags: [batchTag] });
    }

    // Same index lag after the removal.
    await vi.waitFor(
      async () => {
        const after = await listMarked(client, 'workbook', today);
        expect(after.map((i) => i.id)).not.toContain(workbookId);
      },
      { timeout: 30_000, interval: 2_000 },
    );
  });
});
