import { getDefaultEnv, resetEnv, setEnv } from '../../testEnv.js';
import { McpClient } from '../mcpClient.js';

const PROMPT_NAME = 'stale-content-cleanup-apply';
const REPORT_TOOL = 'query-admin-insights';

describe('stale-content-cleanup-apply prompt', () => {
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

    it('defaults to a dry-run workflow that reports before deleting', async () => {
      if (!promptAvailable) {
        return;
      }
      const text = await client.getPromptText(PROMPT_NAME);
      // Reads from the deterministic report tool.
      expect(text).toContain(`\`${REPORT_TOOL}\``);
      expect(text).toContain('kind: "stale-content"');
      // Required human-in-the-loop break is present.
      expect(text).toContain('🛑 STOP');
      // Dry run is the default: report only, never tag and never confirm-delete.
      expect(text).toContain('DRY RUN is active');
      expect(text).toContain('STOP (dry run)');
      expect(text).not.toContain('Step 7 — Delete (confirmed)');
    });

    it('writes nothing before approval — no tagging in the dry-run default (F1)', async () => {
      if (!promptAvailable) {
        return;
      }
      const text = await client.getPromptText(PROMPT_NAME);
      // The dry-run branch must not emit a tagging step or instruct any write.
      expect(text).not.toContain('Tag approved items');
      expect(text).toContain('do NOT tag any item');
      // Oversized-report guard is present.
      expect(text).toContain('more than 100 rows');
      expect(text).toContain('narrow the scope');
    });

    it('gates tagging behind the human approval break when dryRun is false (F1)', async () => {
      if (!promptAvailable) {
        return;
      }
      const text = await client.getPromptText(PROMPT_NAME, { dryRun: 'false' });
      const gateIdx = text.indexOf('REQUIRED HUMAN CONFIRMATION');
      const tagIdx = text.indexOf('Tag approved items');
      expect(gateIdx).toBeGreaterThan(-1);
      expect(tagIdx).toBeGreaterThan(gateIdx);
      expect(text).toContain('ONLY for the items the user explicitly approved');
    });

    it('routes both supported content types by default', async () => {
      if (!promptAvailable) {
        return;
      }
      const text = await client.getPromptText(PROMPT_NAME);
      expect(text).toContain('list-workbooks');
      expect(text).toContain('delete-content');
      expect(text).toContain('list-datasources');
      expect(text).toContain('"resourceType": "workbook"');
      expect(text).toContain('"resourceType": "datasource"');
      expect(text).toContain('"Workbook"');
      expect(text).toContain('"Datasource"');
    });

    it('scopes routing to an explicit itemTypes subset', async () => {
      if (!promptAvailable) {
        return;
      }
      const text = await client.getPromptText(PROMPT_NAME, { itemTypes: 'Workbook' });
      expect(text).toContain('"resourceType": "workbook"');
      expect(text).not.toContain('"resourceType": "datasource"');
    });

    it('passes minAgeDays and projectIds through to the report tool args', async () => {
      if (!promptAvailable) {
        return;
      }
      const text = await client.getPromptText(PROMPT_NAME, {
        minAgeDays: '120',
        projectIds: 'abc-123,def-456',
      });
      expect(text).toContain('"minAgeDays": 120');
      expect(text).toContain('"projectIds"');
      expect(text).toContain('abc-123');
      expect(text).toContain('def-456');
    });

    it('enables the confirmed-delete phase when dryRun is false', async () => {
      if (!promptAvailable) {
        return;
      }
      const text = await client.getPromptText(PROMPT_NAME, { dryRun: 'false' });
      expect(text).toContain('Human confirmation break');
      expect(text).toContain('Step 6 — Grace check');
      expect(text).toContain('Step 7 — Delete (confirmed)');
      expect(text).toContain('confirm: true');
      expect(text).not.toContain('DRY RUN is active');
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
