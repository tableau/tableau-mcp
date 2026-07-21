import { WebResourceFactory, WebResourceRegistration } from '../registry.js';
import { buildDataAppSkill } from './buildDataApp.js';

export const buildDataAppResourceUri = 'skill://tableau/build-data-app';

export const getBuildDataAppResource: WebResourceFactory = (): WebResourceRegistration => ({
  name: 'build-data-app',
  uri: buildDataAppResourceUri,
  title: 'Build a Data App',
  description:
    'Canonical workflow for turning a business question into a static, real-data-backed app: ' +
    'detect intent, query freely, author a workspace, render for review, iterate, validate, get ' +
    'explicit consent, and publish only the validated receipt.',
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
