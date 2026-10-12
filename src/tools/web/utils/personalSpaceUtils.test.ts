import { AxiosError } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import { RestApi } from '../../../sdks/tableau/restApi.js';
import {
  mapPersonalSpaceSiteDisabledError,
  notInPersonalSpaceError,
  resolvePersonalSpace,
} from './personalSpaceUtils.js';

const restApiWith = (getPersonalSpace: () => Promise<unknown>): RestApi =>
  ({ siteId: 'site-1', personalSpaceMethods: { getPersonalSpace } }) as unknown as RestApi;

const apiError = (status: number, error: unknown): AxiosError => {
  const axiosError = new AxiosError(`Request failed with status code ${status}`);
  axiosError.response = { status, data: { error } } as AxiosError['response'];
  return axiosError;
};

describe('resolvePersonalSpace', () => {
  it('returns the Personal Space when writable', async () => {
    const space = { luid: 'ps-1', ownerLuid: 'user-1', readOnly: false };
    const getPersonalSpace = vi.fn().mockResolvedValue(space);

    const result = await resolvePersonalSpace(restApiWith(getPersonalSpace), 'move');

    expect(result.isOk() && result.value).toEqual(space);
    expect(getPersonalSpace).toHaveBeenCalledWith({ siteId: 'site-1' });
  });

  it.each([
    ['publish', 'Could not resolve your Personal Space for publishing (boom); pass projectId'],
    ['move', 'Could not resolve your Personal Space for moving (boom); pass projectId'],
  ] as const)('errors when unresolvable (%s)', async (action, expected) => {
    const result = await resolvePersonalSpace(
      restApiWith(() => Promise.reject(new Error('boom'))),
      action,
    );

    expect(result.isErr() && result.error.type).toBe('args-validation');
    expect(result.isErr() && result.error.message).toContain(expected);
  });

  it.each([
    ['publish', 401, 'publishing', 'publish'],
    ['move', 401, 'moving', 'move'],
    ['publish', 403, 'publishing', 'publish'],
    ['move', 403, 'moving', 'move'],
  ] as const)('asks to re-authorize on %s lookup %i', async (action, status, gerund, verb) => {
    const result = await resolvePersonalSpace(
      restApiWith(() => Promise.reject(apiError(status, {}))),
      action,
    );

    expect(result.isErr() && result.error.type).toBe('personal-space-unauthorized');
    expect(result.isErr() && result.error.statusCode).toBe(status);
    expect(result.isErr() && result.error.message).toBe(
      `Could not resolve your Personal Space for ${gerund} (Request failed with status code ` +
        `${status}); reconnect (re-authorize) Tableau MCP so your token is granted the ` +
        `tableau:projects:read scope, then retry the ${verb}.`,
    );
  });

  it.each([
    [
      'publish',
      'cannot be used as a publish target; pass projectId (use list-projects) to publish',
    ],
    ['move', 'cannot be used as a move target; pass projectId (use list-projects) to move'],
  ] as const)('errors when read-only (%s)', async (action, expected) => {
    const result = await resolvePersonalSpace(
      restApiWith(() => Promise.resolve({ luid: 'ps-1', ownerLuid: 'user-1', readOnly: true })),
      action,
    );

    expect(result.isErr() && result.error.type).toBe('args-validation');
    expect(result.isErr() && result.error.message).toContain(expected);
  });
});

describe('mapPersonalSpaceSiteDisabledError', () => {
  const siteDisabled = apiError(400, {
    code: '400000',
    detail: 'Payload is either malformed or incomplete. (Personal Space is not enabled.)',
  });

  it.each([
    ['publish', 'Publishing directly to a personal space is not enabled for this Tableau site.'],
    ['move', 'Moving content into Personal Space is not enabled for this Tableau site.'],
  ] as const)('maps the site-disabled error (%s)', (action, expected) => {
    const mapped = mapPersonalSpaceSiteDisabledError(siteDisabled, action);

    expect(mapped?.type).toBe('feature-disabled');
    expect(mapped?.message).toContain(expected);
  });

  it.each([
    ['a 400000 without a personal-space detail', apiError(400, { code: '400000', detail: 'x' })],
    ['a different code', apiError(400, { code: '400001', detail: 'personal space' })],
    ['a non-API error', new Error('personal space')],
  ])('returns null for %s', (_, error) => {
    expect(mapPersonalSpaceSiteDisabledError(error, 'move')).toBeNull();
  });
});

describe('notInPersonalSpaceError', () => {
  it('returns null when the workbook landed in Personal Space', () => {
    expect(notInPersonalSpaceError({ location: { type: 'PersonalSpace' } }, 'publish')).toBeNull();
  });

  it.each([
    [
      'publish',
      { project: { id: 'p-1', name: 'Default' } },
      'This Tableau site published the workbook to the "Default" project instead of your ' +
        'personal space — its REST API does not support personal-space publishing. Delete it ' +
        'there if unwanted, or publish to a project explicitly by passing projectId.',
    ],
    [
      'move',
      { location: { type: 'Project', name: 'Default' } },
      'After the move the workbook is in the "Default" project instead of your personal space — ' +
        'this Tableau site does not support moving workbooks into a personal space. Pass ' +
        'projectId to move it to a project instead.',
    ],
    ['move', {}, 'After the move the workbook is in a project instead of your personal space'],
  ] as const)('errors when the %s landed elsewhere', (action, workbook, expected) => {
    const error = notInPersonalSpaceError(workbook, action);

    expect(error?.type).toBe('unknown');
    expect(error?.message).toContain(expected);
  });
});
