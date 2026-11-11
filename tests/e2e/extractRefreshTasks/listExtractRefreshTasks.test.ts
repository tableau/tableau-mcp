import { z } from 'zod';

import {
  ExtractRefreshTask,
  extractRefreshTaskSchema,
} from '../../../src/sdks/tableau/types/extractRefreshTask.js';
import invariant from '../../../src/utils/invariant.js';
import { getAdminToolsEnv, getDefaultEnv, resetEnv, setEnv } from '../../testEnv.js';
import { McpClient } from '../mcpClient.js';

/**
 * E2E coverage for the admin-only, read-only `list-extract-refresh-tasks` tool.
 *
 * The Tableau REST API has no server-side paging for this endpoint, so the tool fetches every task
 * and limits client-side. These tests prove that an admin's MAX_RESULT_LIMITS cap is honored end
 * to end (it used to be ignored), on top of the caller's `limit`.
 *
 * The response is a bare array of tasks, or a plain-text message when there are none, so tool
 * calls go through the raw client rather than `McpClient.callTool` (which always JSON-parses).
 */
const EMPTY_MESSAGE =
  'No extract refresh tasks were found. Either none exist or you do not have permission to view them.';

const CAP = 1;

async function listTasks(
  client: McpClient,
  toolArgs: Record<string, unknown> = {},
): Promise<Array<ExtractRefreshTask>> {
  const result = await client.client.callTool({
    name: 'list-extract-refresh-tasks',
    arguments: toolArgs,
  });
  invariant(Array.isArray(result.content));
  expect(result.content).toHaveLength(1);
  const [content] = result.content;
  invariant(content.type === 'text');
  if (result.isError) {
    throw new Error(content.text);
  }
  if (content.text === EMPTY_MESSAGE) {
    return [];
  }
  return z.array(extractRefreshTaskSchema).parse(JSON.parse(content.text));
}

describe('list-extract-refresh-tasks', () => {
  let client: McpClient;
  let cappedClient: McpClient;
  let toolsAvailable = false;

  beforeAll(setEnv);
  afterAll(resetEnv);

  beforeAll(async () => {
    client = new McpClient({ env: getAdminToolsEnv() });
    cappedClient = new McpClient({
      env: {
        ...getAdminToolsEnv(),
        MAX_RESULT_LIMITS: `list-extract-refresh-tasks:${CAP}`,
      },
    });
    // Connect one at a time: both servers sign in with the same PAT.
    await client.connect();
    await cappedClient.connect();
    const tools = await client.listTools();
    toolsAvailable = tools.includes('list-extract-refresh-tasks');
    if (!toolsAvailable) {
      console.warn(
        'Skipping list-extract-refresh-tasks e2e tests — admin tools not registered. ' +
          'Ensure the caller is a site admin.',
      );
    }
  });

  afterAll(async () => {
    await client.close();
    await cappedClient.close();
  });

  it('should register the tool only when admin tools are enabled', async () => {
    const defaultClient = new McpClient({ env: getDefaultEnv() });
    await defaultClient.connect();
    try {
      const tools = await defaultClient.listTools();
      expect(tools.includes('list-extract-refresh-tasks')).toBe(false);
    } finally {
      await defaultClient.close();
    }
  });

  it('should list extract refresh tasks', async () => {
    if (!toolsAvailable) {
      return;
    }

    // listTasks has already checked every task against the schema. Not every task names a
    // target (ExtractServiceFullRefreshExtractTask has neither `datasource` nor `workbook`),
    // so `id` is the only field to require here.
    const tasks = await listTasks(client);
    for (const task of tasks) {
      expect(task.id).toBeTruthy();
    }
  });

  it('should cap results at MAX_RESULT_LIMITS', async () => {
    if (!toolsAvailable) {
      return;
    }

    const allTasks = await listTasks(client);
    if (allTasks.length <= CAP) {
      console.warn(
        `Site has ${allTasks.length} extract refresh task(s); the cap is only proven to cut ` +
          `results on a site with more than ${CAP}.`,
      );
    }

    const cappedTasks = await listTasks(cappedClient);
    expect(cappedTasks).toHaveLength(Math.min(allTasks.length, CAP));
    const allIds = new Set(allTasks.map((task) => task.id));
    for (const task of cappedTasks) {
      expect(allIds.has(task.id)).toBe(true);
    }
  });

  it('should keep the cap when the caller asks for more', async () => {
    if (!toolsAvailable) {
      return;
    }

    const allTasks = await listTasks(client);
    const cappedTasks = await listTasks(cappedClient, {
      limit: CAP + 10,
      pageSize: CAP + 10,
    });
    expect(cappedTasks).toHaveLength(Math.min(allTasks.length, CAP));
  });
});
