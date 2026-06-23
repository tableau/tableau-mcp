import { getDefaultEnv, resetEnv, setEnv } from '../../testEnv.js';
import { McpClient } from '../mcpClient.js';

const PROMPT_NAME = 'extract-optimization-apply';
const INVENTORY_TOOL = 'list-extract-refresh-tasks';
const PERFORMANCE_TOOL = 'query-admin-insights-job-performance';
const UPDATE_TOOL = 'update-cloud-extract-refresh-task';
const DELETE_TOOL = 'delete-extract-refresh-task';

describe('extract-optimization-apply prompt', () => {
  beforeAll(setEnv);
  afterAll(resetEnv);

  describe('with admin tools enabled', () => {
    let client: McpClient;
    let promptAvailable = false;

    beforeAll(async () => {
      client = new McpClient({
        env: { ...getDefaultEnv(), ADMIN_TOOLS_ENABLED: 'true' },
      });
      await client.connect();
      const prompts = await client.listPrompts();
      promptAvailable = prompts.includes(PROMPT_NAME);
      if (!promptAvailable) {
        console.warn(
          `Skipping ${PROMPT_NAME} e2e tests — prompt not registered. ` +
            'Ensure ADMIN_TOOLS_ENABLED=true in tests/.env.',
        );
      }
    });

    afterAll(async () => {
      await client.close();
    });

    it('is registered', async () => {
      if (!promptAvailable) {
        return;
      }
      const prompts = await client.listPrompts();
      expect(prompts).toContain(PROMPT_NAME);
    });

    it('defaults to a dry-run workflow that reports before applying', async () => {
      if (!promptAvailable) {
        return;
      }
      const text = await client.getPromptText(PROMPT_NAME);
      // Inventory + performance are both invoked exactly once, both read-only.
      expect(text).toContain(`\`${INVENTORY_TOOL}\``);
      expect(text).toContain(`\`${PERFORMANCE_TOOL}\``);
      expect(text).toContain('exactly once');
      // Required human-in-the-loop break is present.
      expect(text).toContain('🛑 STOP');
      // Dry run is the default: report only, never call update or delete.
      expect(text).toContain('`dryRun = true`');
      expect(text).toContain('Dry run — no changes applied.');
      expect(text).not.toContain('Step 5 — Apply (only after Step 4 approval).');
    });

    it('writes nothing before approval — no apply step in the dry-run default', async () => {
      if (!promptAvailable) {
        return;
      }
      const text = await client.getPromptText(PROMPT_NAME);
      // The dry-run branch must not emit an apply step or instruct any write.
      expect(text).toContain(`Do **not** call \`${UPDATE_TOOL}\``);
      expect(text).toContain(`Do **not** call \`${DELETE_TOOL}\``);
      // The destructive framing is present so a downstream prompt edit can't quietly remove it.
      expect(text).toContain('DESTRUCTIVE admin workflow');
      expect(text).toContain('CRITICAL: Steps 1-3 are READ-ONLY');
    });

    it('gates the apply step behind the human approval break when dryRun is false', async () => {
      if (!promptAvailable) {
        return;
      }
      const text = await client.getPromptText(PROMPT_NAME, { dryRun: 'false' });
      const gateIdx = text.indexOf('REQUIRED HUMAN CONFIRMATION');
      const applyIdx = text.indexOf('Step 5 — Apply (only after Step 4 approval).');
      expect(gateIdx).toBeGreaterThan(-1);
      expect(applyIdx).toBeGreaterThan(gateIdx);
      expect(text).toContain('Do **not** parallelize');
      expect(text).toContain('A previous approval does NOT carry forward.');
      expect(text).not.toContain('Dry run — no changes applied.');
    });

    it('scopes the performance read to the four extract refresh job types', async () => {
      if (!promptAvailable) {
        return;
      }
      const text = await client.getPromptText(PROMPT_NAME);
      expect(text).toContain('"RefreshExtracts"');
      expect(text).toContain('"IncrementExtracts"');
      expect(text).toContain('"RefreshExtractsViaBridge"');
      expect(text).toContain('"IncrementExtractsViaBridge"');
    });

    it('passes lookbackDays through to the performance tool args', async () => {
      if (!promptAvailable) {
        return;
      }
      const text = await client.getPromptText(PROMPT_NAME, { lookbackDays: '30' });
      expect(text).toContain('"dateRangeType": "LASTN"');
      expect(text).toContain('"rangeN": 30');
    });

    it('narrows the scope and adds a Missing tasks bullet when taskIds is provided', async () => {
      if (!promptAvailable) {
        return;
      }
      const text = await client.getPromptText(PROMPT_NAME, {
        taskIds: '11111111-1111-1111-1111-111111111111',
      });
      expect(text).toContain('11111111-1111-1111-1111-111111111111');
      expect(text).toContain('narrow the working set client-side');
      expect(text).toContain('Missing tasks');
    });
  });

  describe('with admin tools disabled', () => {
    let client: McpClient;

    beforeAll(async () => {
      client = new McpClient({ env: getDefaultEnv() });
      await client.connect();
    });

    afterAll(async () => {
      await client.close();
    });

    it('does not register the prompt', async () => {
      const prompts = await client.listPrompts();
      expect(prompts).not.toContain(PROMPT_NAME);
    });
  });
});
