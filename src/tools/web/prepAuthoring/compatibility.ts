import { z } from 'zod';

import { engineSummarySchema } from './engineClient.js';

type Summary = z.infer<typeof engineSummarySchema>;
type Notice = { code: string; severity: 'warning' | 'advisory'; message: string; source: string };
const scripts = 'https://help.tableau.com/current/prep/en-us/prep_scripts.htm';
const inputs = 'https://help.tableau.com/current/prep/en-us/prep_add_input_data.htm';

export function prepCompatibility(
  summary: Summary,
  target: 'builder' | 'cloud' | 'server',
  format: 'tfl' | 'tflx',
): { publicationReadiness: 'unsupported' | 'requires-runtime-verification'; notices: Notice[] } {
  const notices: Notice[] = [];
  let publicationReadiness: 'unsupported' | 'requires-runtime-verification' =
    'requires-runtime-verification';
  if (summary.hasScriptSteps) {
    if (target === 'cloud') {
      publicationReadiness = 'unsupported';
      notices.push({
        code: 'CLOUD_SCRIPT_STEPS_UNSUPPORTED',
        severity: 'warning',
        message:
          'Structural validation does not make this flow Cloud-ready: Tableau Cloud does not support Python/R script steps in authored or published flows.',
        source: scripts,
      });
    } else {
      notices.push({
        code: 'SCRIPT_SERVICE_REQUIRED',
        severity: 'warning',
        message:
          'Python/R script steps require the appropriate TabPy/Rserve connection and runtime configuration. Server can run published script flows; web authoring/editing requires a supported Server version (2020.4.1+). This is not universally local-only.',
        source: scripts,
      });
    }
  }
  if (summary.hasInputUnion) {
    notices.push({
      code: 'INPUT_UNION_AUTHORING_BUILDER',
      severity: 'advisory',
      message:
        'Input unions are created/edited in Prep Builder and can be scheduled to run on the web. Additional file-filter options have version/scheduling limits; verify the selected target rather than treating all unions as local-only.',
      source: inputs,
    });
    if (format === 'tflx')
      notices.push({
        code: 'PACKAGED_UNION_NEW_FILES',
        severity: 'warning',
        message:
          'A packaged TFLX does not automatically pick up newly matching files. Open the native TFL in Prep Builder and repackage to include new files.',
        source: inputs,
      });
  }
  if (target === 'cloud' && summary.hasFileInputs)
    notices.push({
      code: 'CLOUD_FILE_REFRESH',
      severity: 'warning',
      message:
        'Cloud cannot refresh file inputs in the same way as Builder/Server. Refresh file data in Prep Builder and republish the flow when needed.',
      source: inputs,
    });
  return { publicationReadiness, notices };
}
