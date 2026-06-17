import { WebResourceFactory } from '../registry.js';
import {
  VIBE_CODE_DATA_APP_SKILL_NAME,
  VIBE_CODE_DATA_APP_SKILL_URI,
  vibeCodeDataAppSkill,
} from './vibeCodeDataApp.js';

export const getVibeCodeDataAppSkillResource: WebResourceFactory = () => ({
  name: VIBE_CODE_DATA_APP_SKILL_NAME,
  uri: VIBE_CODE_DATA_APP_SKILL_URI,
  title: 'Skill: Vibe-Code a Tableau Data App',
  description:
    'Guidance for generating a data app that is packaged as a Tableau Dashboard ' +
    'Extension and hosted by Tableau. Covers the no-hardcoded-data rule, the ' +
    'data-access shim contract, Extensions API initialization and workbook-context ' +
    'interop, the packaging file layout, and the narrative/style contract. Read ' +
    'this before generating Tableau data app code.',
  mimeType: 'text/markdown',
  disabled: () => false,
  read: () => ({
    contents: [
      {
        uri: VIBE_CODE_DATA_APP_SKILL_URI,
        mimeType: 'text/markdown',
        text: vibeCodeDataAppSkill,
      },
    ],
  }),
});
