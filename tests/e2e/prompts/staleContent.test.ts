import { getDefaultEnv, resetEnv, setEnv } from '../../testEnv.js';
import { McpClient } from '../mcpClient.js';

const PROMPT_NAME = 'stale-content-cleanup-apply';
const REPORT_TOOL = 'get-stale-content-report';

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
      // Reads from the deterministic report tool exactly once.
      expect(text).toContain(`\`${REPORT_TOOL}\``);
      expect(text).toContain('exactly once');
      // Required human-in-the-loop break is present.
      expect(text).toContain('🛑 STOP');
      // Dry run is the default: stop after tag + notify, never confirm-delete.
      expect(text).toContain('DRY RUN is active');
      expect(text).toContain('STOP (dry run)');
      expect(text).not.toContain('Step 7 — Delete (confirmed)');
    });

    it('routes both supported content types by default', async () => {
      if (!promptAvailable) {
        return;
      }
      const text = await client.getPromptText(PROMPT_NAME);
      expect(text).toContain('list-workbooks');
      expect(text).toContain('delete-workbook');
      expect(text).toContain('list-datasources');
      expect(text).toContain('delete-datasource');
      expect(text).toContain('"Workbook"');
      expect(text).toContain('"Datasource"');
    });

    it('scopes routing to an explicit itemTypes subset', async () => {
      if (!promptAvailable) {
        return;
      }
      const text = await client.getPromptText(PROMPT_NAME, { itemTypes: 'Workbook' });
      expect(text).toContain('delete-workbook');
      expect(text).not.toContain('delete-datasource');
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
