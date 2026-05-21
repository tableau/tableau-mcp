import z from 'zod';

import { extractRefreshTaskSchema } from '../../../src/sdks/tableau/types/extractRefreshTask.js';
import { resetEnv, setEnv } from '../../testEnv.js';
import { McpClient } from '../mcpClient.js';

describe('list-extract-refresh-tasks', () => {
  let client: McpClient;

  beforeAll(() => {
    // Enable admin tools for this test
    process.env.TMCP_ADMIN_TOOLS_ENABLED = 'true';
    setEnv();
  });

  afterAll(() => {
    delete process.env.TMCP_ADMIN_TOOLS_ENABLED;
    resetEnv();
  });

  beforeAll(async () => {
    client = new McpClient();
    await client.connect();
  });

  afterAll(async () => {
    await client.close();
  });

  it('should list extract refresh tasks', async () => {
    const tasks = await client.callTool('list-extract-refresh-tasks', {
      schema: z.array(extractRefreshTaskSchema),
    });

    // Tasks array should be defined (may be empty if no tasks exist)
    expect(tasks).toBeDefined();
    expect(Array.isArray(tasks)).toBe(true);

    // If tasks exist, verify structure
    if (tasks.length > 0) {
      const task = tasks[0];
      expect(task).toHaveProperty('id');
      expect(typeof task.id).toBe('string');

      // Task should have either datasource or workbook
      expect(task.datasource || task.workbook).toBeDefined();

      // If datasource exists, verify structure
      if (task.datasource) {
        expect(task.datasource).toHaveProperty('id');
        expect(typeof task.datasource.id).toBe('string');
      }

      // If workbook exists, verify structure
      if (task.workbook) {
        expect(task.workbook).toHaveProperty('id');
        expect(typeof task.workbook.id).toBe('string');
      }

      // If schedule exists, verify structure
      if (task.schedule) {
        expect(task.schedule).toHaveProperty('id');
        expect(typeof task.schedule.id).toBe('string');
      }
    }
  });

  it('should validate task schema matches expected structure', async () => {
    const tasks = await client.callTool('list-extract-refresh-tasks', {
      schema: z.array(extractRefreshTaskSchema),
    });

    // Zod schema validation is done by callTool
    // If we get here, all tasks passed schema validation
    expect(tasks).toBeDefined();

    // Verify each task has required fields
    tasks.forEach((task) => {
      expect(task.id).toBeDefined();
      // At least one of datasource or workbook must exist
      const hasTarget = task.datasource !== undefined || task.workbook !== undefined;
      expect(hasTarget).toBe(true);
    });
  });
});
