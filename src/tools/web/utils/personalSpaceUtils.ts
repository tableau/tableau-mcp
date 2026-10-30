import { Ok, Result } from 'ts-results-es';

import {
  ArgsValidationError,
  FeatureDisabledError,
  McpToolError,
  UnknownError,
} from '../../../errors/mcpToolError.js';
import { RestApi } from '../../../sdks/tableau/restApi.js';
import { parseTableauApiError } from '../../../sdks/tableau/tableauApiError.js';
import { PersonalSpace } from '../../../sdks/tableau/types/personalSpace.js';
import { Workbook } from '../../../sdks/tableau/types/workbook.js';
import { getExceptionMessage } from '../../../utils/getExceptionMessage.js';

export type PersonalSpaceAction = 'publish' | 'move';

const wording = {
  publish: { verb: 'publish', gerund: 'publishing' },
  move: { verb: 'move', gerund: 'moving' },
} as const satisfies Record<PersonalSpaceAction, { verb: string; gerund: string }>;

const siteDisabledMessage = {
  publish:
    'Publishing directly to a personal space is not enabled for this Tableau site. Publish to a ' +
    'project instead by passing projectId, or ask a site administrator to enable ' +
    'personal-space publishing.',
  move:
    'Moving content into Personal Space is not enabled for this Tableau site. Move it to a ' +
    'project instead by passing projectId, or ask a site administrator.',
} as const satisfies Record<PersonalSpaceAction, string>;

const notInPersonalSpaceMessage = {
  publish: (landedIn: string) =>
    `This Tableau site published the workbook to ${landedIn} instead of your personal space — ` +
    'its REST API does not support personal-space publishing. Delete it there if unwanted, or ' +
    're-publish to a project by passing projectId; a staged upload must be re-requested with ' +
    'request-workbook-upload.',
  move: (landedIn: string) =>
    `After the move the workbook is in ${landedIn} instead of your personal space — this ` +
    'Tableau site does not support moving workbooks into a personal space. Pass projectId to ' +
    'move it to a project instead.',
} as const satisfies Record<PersonalSpaceAction, (landedIn: string) => string>;

const projectIdHint = (action: PersonalSpaceAction): string =>
  `pass projectId (use list-projects) to ${wording[action].verb} to a project instead.`;

export async function resolvePersonalSpace(
  restApi: RestApi,
  action: PersonalSpaceAction,
): Promise<Result<PersonalSpace, McpToolError>> {
  // Don't pre-check site.personalSpaceEnabled: Query Site is admin-only, and the callers are
  // typically non-admin Explorers/Creators. A site with Personal Space disabled surfaces here as
  // a getPersonalSpace failure instead.
  let personalSpace: PersonalSpace;
  try {
    personalSpace = await restApi.personalSpaceMethods.getPersonalSpace({
      siteId: restApi.siteId,
    });
  } catch (error) {
    return new ArgsValidationError(
      `Could not resolve your Personal Space for ${wording[action].gerund} (${getExceptionMessage(error)}); ` +
        projectIdHint(action),
    ).toErr();
  }

  if (personalSpace.readOnly) {
    return new ArgsValidationError(
      `Your Personal Space is read-only and cannot be used as a ${wording[action].verb} target; ${projectIdHint(action)}`,
    ).toErr();
  }

  return new Ok(personalSpace);
}

// Map the server's "personal space is disabled for this site" gate (code 400000 with a detail
// mentioning personal space) to a clean tool error, or null so the caller rethrows to the
// generic handler.
export function mapPersonalSpaceSiteDisabledError(
  error: unknown,
  action: PersonalSpaceAction,
): FeatureDisabledError | null {
  const parsed = parseTableauApiError(error);
  if (
    parsed?.status === 400 &&
    parsed.code === '400000' &&
    parsed.detail?.toLowerCase().includes('personal space')
  ) {
    return new FeatureDisabledError(siteDisabledMessage[action]);
  }
  return null;
}

// Some servers accept a Personal Space destination but silently land the workbook in a project.
export function notInPersonalSpaceError(
  workbook: Pick<Partial<Workbook>, 'project' | 'location'>,
  action: PersonalSpaceAction,
): UnknownError | null {
  if (workbook.location?.type === 'PersonalSpace') {
    return null;
  }
  const landed = workbook.project?.name ?? workbook.location?.name;
  return new UnknownError(
    notInPersonalSpaceMessage[action](landed ? `the "${landed}" project` : 'a project'),
  );
}
