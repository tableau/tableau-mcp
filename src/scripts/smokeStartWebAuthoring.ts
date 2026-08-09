/* eslint-disable no-console */

import 'dotenv/config';

import { readFileSync } from 'fs';

import { RestApi } from '../sdks/tableau/restApi.js';
import { stageWorkbookForWebAuthoring } from '../tools/web/workbooks/stageWorkbookForWebAuthoring.js';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const server = requireEnv('SERVER').replace(/\/+$/, '');
  const siteName = process.env.SITE_NAME ?? '';
  const workbookPath = requireEnv('TWB_PATH');
  const workbookXml = readFileSync(workbookPath);

  RestApi.host = server;
  RestApi.version = process.env.TABLEAU_API_VERSION ?? '3.29';

  const restApi = new RestApi({ maxRequestTimeoutMs: 60_000 });
  await restApi.signIn({
    type: 'pat',
    siteName,
    patName: requireEnv('PAT_NAME'),
    patValue: requireEnv('PAT_VALUE'),
  });

  const { validation, authoringUrl } = await stageWorkbookForWebAuthoring({
    restApi,
    server,
    siteName,
    workbookBytes: workbookXml,
  });

  console.log('Validation result:');
  console.log(JSON.stringify(validation, null, 2));

  if ((validation.errors?.length ?? 0) > 0) {
    console.error('Workbook validation failed; no authoring URL was generated.');
    process.exitCode = 2;
    return;
  }

  if (process.env.SIGN_OUT_BEFORE_HANDOFF === 'true') {
    await restApi.signOut();
    console.log('\nSigned out of the Tableau REST session before browser handoff.');
  }

  console.log('\nOpen this URL in a browser authenticated to the same Tableau site:');
  console.log(authoringUrl);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Unknown web authoring smoke-test error');
  process.exitCode = 1;
});
