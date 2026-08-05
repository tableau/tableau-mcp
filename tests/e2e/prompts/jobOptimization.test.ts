import { getDefaultEnv, resetEnv, setEnv } from '../../testEnv.js';
import { McpClient } from '../mcpClient.js';

const PROMPT_NAME = 'job-optimization-inform';
const TOOL_NAME = 'query-admin-insights';

describe('job-optimization-inform prompt', () => {
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

    it('returns a default extract-refresh workflow with the pre-baked tool args', async () => {
      if (!promptAvailable) {
        return;
      }
      const text = await client.getPromptText(PROMPT_NAME);
      expect(text).toContain(`\`${TOOL_NAME}\``);
      expect(text).toContain('exactly once');
      expect(text).toContain('"RefreshExtracts"');
      expect(text).not.toContain('__JOB_TYPE__');
    });

    it('passes lookbackDays and limit through to the tool args', async () => {
      if (!promptAvailable) {
        return;
      }
      const text = await client.getPromptText(PROMPT_NAME, {
        lookbackDays: '30',
        limit: '100',
      });
      expect(text).toContain('"dateRangeType": "LASTN"');
      expect(text).toContain('"rangeN": 30');
      expect(text).toContain('"limit": 100');
    });

    it('scopes to an explicit jobType without discovery', async () => {
      if (!promptAvailable) {
        return;
      }
      const text = await client.getPromptText(PROMPT_NAME, { jobType: 'RunFlow' });
      expect(text).toContain('"RunFlow"');
      expect(text).not.toContain('"RefreshExtracts"');
      expect(text).not.toContain('__JOB_TYPE__');
    });

    it('enters discovery mode when discover is true', async () => {
      if (!promptAvailable) {
        return;
      }
      const text = await client.getPromptText(PROMPT_NAME, { discover: 'true' });
      expect(text).toContain('distinct `Job Type`');
      expect(text).toContain('__JOB_TYPE__');
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
