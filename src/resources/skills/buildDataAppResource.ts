import { WebResourceFactory, WebResourceRegistration } from '../registry.js';
import { buildDataAppSkill } from './buildDataApp.js';

export const buildDataAppResourceUri = 'skill://tableau/build-data-app';

export const getBuildDataAppResource: WebResourceFactory = (): WebResourceRegistration => ({
  name: 'build-data-app',
  uri: buildDataAppResourceUri,
  title: 'Build a Data App',
  description:
    'Canonical workflow for turning a business question into a live-query Tableau data app (a ' +
    'bundled dashboard extension that queries a published datasource live): detect intent, identify ' +
    'the datasource, scaffold the workspace, introspect and author the query + visualization, ' +
    'validate, get explicit consent, publish only the validated receipt, and review in Tableau.',
  mimeType: 'text/markdown',
  read: () => ({
    contents: [
      {
        uri: buildDataAppResourceUri,
        mimeType: 'text/markdown',
        text: buildDataAppSkill,
      },
    ],
  }),
});
