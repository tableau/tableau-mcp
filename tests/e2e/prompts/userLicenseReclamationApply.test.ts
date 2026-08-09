import { getDefaultEnv, resetEnv, setEnv } from '../../testEnv.js';
import { McpClient } from '../mcpClient.js';

const PROMPT_NAME = 'user-license-reclamation-apply';
const REPORT_TOOL = 'query-admin-insights';
const APPLY_TOOL = 'update-user';

describe('user-license-reclamation-apply prompt', () => {
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
    });

    it('keeps the existing TS Events / Access content-access step', async () => {
      if (!promptAvailable) {
        return;
      }
      const text = await client.getPromptText(PROMPT_NAME);
      expect(text).toContain('"kind": "ts-events"');
      expect(text).toContain('"Access"');
      expect(text).toContain('Actor User Name');
    });

    it('adds a ts-users Desktop/Prep activity step (W-23757367)', async () => {
      if (!promptAvailable) {
        return;
      }
      const text = await client.getPromptText(PROMPT_NAME);
      // New Step 2b: ts-users kind block.
      expect(text).toContain('"kind": "ts-users"');
      expect(text).toContain('2b — Tableau Desktop / Prep activity.');
      // Desktop and Prep last-access captions (UTC variants).
      expect(text).toContain('Tableau Desktop - Last Access Date');
      expect(text).toContain('Tableau Prep - Last Access Date');
    });

    it('joins ts-users rows on User Email / User Name, not Actor User Name', async () => {
      if (!promptAvailable) {
        return;
      }
      const text = await client.getPromptText(PROMPT_NAME);
      expect(text).toContain('Match each row to a candidate by `User Email`');
      expect(text).toContain('`User Name`');
      expect(text).toContain('"fieldCaption": "User Email"');
      expect(text).toContain('"fieldCaption": "User Name"');
    });

    it('states that a null Desktop/Prep date is NOT activity', async () => {
      if (!promptAvailable) {
        return;
      }
      const text = await client.getPromptText(PROMPT_NAME);
      expect(text).toContain('null is NOT activity');
      expect(text).toContain('Only a recent *non-null* Desktop/Prep date rescues a user');
    });

    it('carries the Desktop/Prep data-availability caveat', async () => {
      if (!promptAvailable) {
        return;
      }
      const text = await client.getPromptText(PROMPT_NAME);
      expect(text).toContain('Desktop/Prep activity data may be unavailable on this tenant');
      expect(text).toContain('do not collect Desktop/Prep telemetry');
    });

    it('folds the Desktop/Prep clause into the inactivity determination (W-23757367)', async () => {
      if (!promptAvailable) {
        return;
      }
      const text = await client.getPromptText(PROMPT_NAME);
      expect(text).toContain('Inactivity determination (all conditions must hold):');
      // The determination now includes the Desktop/Prep condition as a hard requirement.
      expect(text).toContain(
        'The user has NO recent non-null Tableau Desktop OR Prep last-access date',
      );
      // A recent non-null Desktop/Prep date excludes an otherwise-stale user.
      expect(text).toContain(
        'A user with a recent non-null Desktop or Prep last-access date is **active** and must be excluded',
      );
    });

    it('defaults to a dry-run workflow that reports before applying', async () => {
      if (!promptAvailable) {
        return;
      }
      const text = await client.getPromptText(PROMPT_NAME);
      // Dry run is the default: report only, never call update-user, never reach the confirmed apply step.
      expect(text).toContain('`dryRun = true`');
      expect(text).toContain(`report only. Do **not** call \`${APPLY_TOOL}\``);
      expect(text).toContain('Step 4 — STOP (dry run).');
      expect(text).toContain('Dry run — no changes applied.');
      expect(text).not.toContain('Step 6 — Apply (confirmed).');
    });

    it('gates the confirmed apply behind the human approval break when dryRun is false', async () => {
      if (!promptAvailable) {
        return;
      }
      const text = await client.getPromptText(PROMPT_NAME, { dryRun: 'false' });
      // The HITL gate must precede the confirmed apply step, which precedes the confirmed update-user call.
      const gateIdx = text.indexOf('🛑 STOP — REQUIRED HUMAN CONFIRMATION');
      const applyStepIdx = text.indexOf('Step 6 — Apply (confirmed).');
      const confirmCallIdx = text.indexOf('siteRole: "Unlicensed", confirm: true');
      expect(gateIdx).toBeGreaterThan(-1);
      expect(applyStepIdx).toBeGreaterThan(gateIdx);
      expect(confirmCallIdx).toBeGreaterThan(applyStepIdx);
      // The preview → token → confirm ordering is intact.
      expect(text).toContain('Step 5 — Preview');
      expect(text).toContain('confirmationToken');
      expect(text).toContain('`dryRun = false`');
      // The dry-run stop must be gone in this branch.
      expect(text).not.toContain('Step 4 — STOP (dry run).');
      expect(text).not.toContain('Dry run — no changes applied.');
    });

    it('never permits an update before the Step 4 approval', async () => {
      if (!promptAvailable) {
        return;
      }
      const text = await client.getPromptText(PROMPT_NAME, { dryRun: 'false' });
      expect(text).toContain('This is a DESTRUCTIVE admin workflow.');
      expect(text).toContain('CRITICAL: Steps 1-3 are READ-ONLY.');
      expect(text).toContain(`Make NO \`${APPLY_TOOL}\` call until the user has`);
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
