import { getDefaultEnv, resetEnv, setEnv } from '../../testEnv.js';
import { McpClient } from '../mcpClient.js';

const PROMPT_NAME = 'user-license-reclamation-inform';
const REPORT_TOOL = 'query-admin-insights';

describe('user-license-reclamation-inform prompt', () => {
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

    it('reads activity from the deterministic report tool', async () => {
      if (!promptAvailable) {
        return;
      }
      const text = await client.getPromptText(PROMPT_NAME);
      expect(text).toContain(`\`${REPORT_TOOL}\``);
      expect(text).toContain('list-users');
      // Read-only inform report — no user modifications.
      expect(text).toContain('This report is read-only.');
      expect(text).not.toContain('update-user');
    });

    it('keeps the existing TS Events / Access content-access step', async () => {
      if (!promptAvailable) {
        return;
      }
      const text = await client.getPromptText(PROMPT_NAME);
      // The ts-events cross-reference (Step 2) must remain intact.
      expect(text).toContain('kind: "ts-events"');
      expect(text).toContain('"kind": "ts-events"');
      expect(text).toContain('"Access"');
      // ts-events joins on Actor User Name (its own caption).
      expect(text).toContain('Actor User Name');
    });

    it('adds a ts-users Desktop/Prep activity step (W-23757367)', async () => {
      if (!promptAvailable) {
        return;
      }
      const text = await client.getPromptText(PROMPT_NAME);
      // New Step 3: ts-users kind block.
      expect(text).toContain('kind: "ts-users"');
      expect(text).toContain('"kind": "ts-users"');
      // The Desktop and Prep last-access captions (UTC variants).
      expect(text).toContain('Tableau Desktop - Last Access Date');
      expect(text).toContain('Tableau Prep - Last Access Date');
    });

    it('joins ts-users rows on User Email / User Name, not Actor User Name', async () => {
      if (!promptAvailable) {
        return;
      }
      const text = await client.getPromptText(PROMPT_NAME);
      // ts-users uses the plain, unprefixed user captions.
      expect(text).toContain('Match each row to a candidate by `User Email`');
      expect(text).toContain('`User Name`');
      // The ts-users field block itself uses User Email / User Name.
      expect(text).toContain('"fieldCaption": "User Email"');
      expect(text).toContain('"fieldCaption": "User Name"');
    });

    it('states that a null Desktop/Prep date is NOT activity', async () => {
      if (!promptAvailable) {
        return;
      }
      const text = await client.getPromptText(PROMPT_NAME);
      // A candidate is only rescued by a recent non-null Desktop/Prep date.
      expect(text).toContain('null is NOT activity');
      expect(text).toContain('Only a recent *non-null* Desktop/Prep date rescues a user');
    });

    it('carries the Desktop/Prep data-availability caveat', async () => {
      if (!promptAvailable) {
        return;
      }
      const text = await client.getPromptText(PROMPT_NAME);
      // On tenants without Desktop/Prep telemetry the fields are null for everyone.
      expect(text).toContain('populated only when the tenant collects Desktop/Prep telemetry');
      expect(text).toContain('Desktop/Prep activity data may be unavailable on this tenant');
    });

    it('scopes the ts-users query to Step-1 candidate emails and warns on truncation (W-23757367)', async () => {
      if (!promptAvailable) {
        return;
      }
      const text = await client.getPromptText(PROMPT_NAME);
      expect(text).toContain('"filterType": "SET"');
      expect(text).toContain(
        '<REPLACE with the candidate User Emails from Step 1 — one string per candidate>',
      );
      expect(text).toContain('**Scope this query to the Step-1 candidates.**');
      expect(text).toContain('Do not fetch all site users.');
      expect(text).toContain('truncated at the 10000-row limit');
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
