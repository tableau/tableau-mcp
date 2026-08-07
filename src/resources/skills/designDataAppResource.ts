import { WebResourceFactory, WebResourceRegistration } from '../registry.js';
import { tableauDataAppDesignSkill } from './tableauDataAppDesign.js';

export const designDataAppResourceUri = 'skill://tableau/design-data-app';

export const getDesignDataAppResource: WebResourceFactory = (): WebResourceRegistration => ({
  name: 'design-data-app',
  uri: designDataAppResourceUri,
  title: 'Design a Data App',
  description:
    'Design guidance for a Tableau data app (a custom-rendered viz (worksheet) extension): decide ' +
    'what to show and why. Covers message-first structure (BLUF/pyramid), archetype-by-audience, ' +
    'the perception hierarchy and mark choice, graphical integrity (zero baseline, no deceptive ' +
    'dual axis, provenance), action titles/annotations, accessible color (grey default + one ' +
    'accent, ColorBrewer, colorblindness), decluttering, and verifying by reviewing the published ' +
    'app in Tableau. Read this alongside skill://tableau/build-data-app.',
  mimeType: 'text/markdown',
  read: () => ({
    contents: [
      {
        uri: designDataAppResourceUri,
        mimeType: 'text/markdown',
        text: tableauDataAppDesignSkill,
      },
    ],
  }),
});
