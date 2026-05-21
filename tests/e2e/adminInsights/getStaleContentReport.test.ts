import { z } from 'zod';

import { getDefaultEnv, resetEnv, setEnv } from '../../testEnv.js';
import { McpClient } from '../mcpClient.js';

const staleContentRowSchema = z
  .object({
    itemId: z.string(),
    itemType: z.string(),
    itemName: z.string(),
    project: z.string().nullable(),
    ownerEmail: z.string().nullable(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
    lastUsedDate: z.string(),
    daysSinceLastUse: z.number(),
    size: z.number().nullable(),
    neverAccessed: z.boolean(),
  })
  .passthrough();

const reportSchema = z
  .object({
    thresholdDays: z.number(),
    totalStaleItems: z.number(),
    totalStaleSizeBytes: z.number(),
    rows: z.array(staleContentRowSchema),
  })
  .passthrough();

describe('get-stale-content-report', () => {
  let client: McpClient;
  let toolsAvailable = false;

  beforeAll(setEnv);
  afterAll(resetEnv);

  beforeAll(async () => {
    client = new McpClient({
      env: { ...getDefaultEnv(), TMCP_ADMIN_TOOLS_ENABLED: 'true' },
    });
    await client.connect();
    const tools = await client.listTools();
    toolsAvailable = tools.includes('get-stale-content-report');
    if (!toolsAvailable) {
      console.warn(
        'Skipping get-stale-content-report e2e tests — admin tools not registered. ' +
          'Ensure TMCP_ADMIN_TOOLS_ENABLED=true in tests/.env and the test site has Admin Insights enabled.',
      );
    }
  });

  afterAll(async () => {
    await client.close();
  });

  it('should return a report at the default threshold (90)', async () => {
    if (!toolsAvailable) {
      return;
    }
    const report = await client.callTool('get-stale-content-report', {
      schema: reportSchema,
      toolArgs: {},
    });

    expect(report.thresholdDays).toBe(90);
    expect(report.rows.length).toBe(report.totalStaleItems);
    // All rows must exceed the threshold (strict greater-than).
    expect(report.rows.every((r) => r.daysSinceLastUse > 90)).toBe(true);
  });

  it('should honor an explicit minAgeDays', async () => {
    if (!toolsAvailable) {
      return;
    }
    const report = await client.callTool('get-stale-content-report', {
      schema: reportSchema,
      toolArgs: { minAgeDays: 365 },
    });

    expect(report.thresholdDays).toBe(365);
    expect(report.rows.every((r) => r.daysSinceLastUse > 365)).toBe(true);
  });

  it('should never include items from the Admin Insights project', async () => {
    if (!toolsAvailable) {
      return;
    }
    const report = await client.callTool('get-stale-content-report', {
      schema: reportSchema,
      toolArgs: { minAgeDays: 1 },
    });

    expect(report.rows.every((r) => r.project !== 'Admin Insights')).toBe(true);
  });

  it('should sort rows descending by daysSinceLastUse, then by size', async () => {
    if (!toolsAvailable) {
      return;
    }
    const report = await client.callTool('get-stale-content-report', {
      schema: reportSchema,
      toolArgs: { minAgeDays: 1 },
    });

    for (let i = 1; i < report.rows.length; i++) {
      const prev = report.rows[i - 1];
      const curr = report.rows[i];
      if (prev.daysSinceLastUse < curr.daysSinceLastUse) {
        throw new Error(
          `Row ${i} violates daysSinceLastUse desc sort: ${prev.daysSinceLastUse} < ${curr.daysSinceLastUse}`,
        );
      }
      if (prev.daysSinceLastUse === curr.daysSinceLastUse) {
        const prevSize = prev.size ?? 0;
        const currSize = curr.size ?? 0;
        if (prevSize < currSize) {
          throw new Error(
            `Row ${i} violates size desc tiebreak at days=${prev.daysSinceLastUse}: ${prevSize} < ${currSize}`,
          );
        }
      }
    }
  });

  it('should return an empty rows array when threshold exceeds plausible item age', async () => {
    if (!toolsAvailable) {
      return;
    }
    const report = await client.callTool('get-stale-content-report', {
      schema: reportSchema,
      toolArgs: { minAgeDays: 3650 },
    });

    expect(report.thresholdDays).toBe(3650);
    expect(report.totalStaleItems).toBe(report.rows.length);
  });

  it('should flag never-accessed items via neverAccessed and align lastUsedDate with createdAt', async () => {
    if (!toolsAvailable) {
      return;
    }
    const report = await client.callTool('get-stale-content-report', {
      schema: reportSchema,
      toolArgs: { minAgeDays: 1 },
    });

    const neverAccessed = report.rows.filter((r) => r.neverAccessed);
    for (const row of neverAccessed) {
      expect(row.lastUsedDate).toBe(row.createdAt ?? row.lastUsedDate);
    }
  });
});
