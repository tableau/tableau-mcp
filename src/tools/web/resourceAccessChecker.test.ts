import { ZodiosError } from '@zodios/core';
import { AxiosError } from 'axios';

import { OverridableConfig } from '../../overridableConfig.js';
import { TableauRestError } from '../../sdks/tableau/tableauRestError.js';
import { getCombinationsOfBoundedContextInputs } from '../../utils/getCombinationsOfBoundedContextInputs.js';
import { mockDatasources } from './datasources/mockDatasources.js';
import { mockFlow, mockOutputSteps } from './flows/getFlow/mockFlow.js';
import { exportedForTesting } from './resourceAccessChecker.js';
import { getMockRequestHandlerExtra } from './toolContext.mock.js';
import { mockCustomView } from './views/mockCustomView.js';
import { mockView } from './views/mockView.js';
import { mockWorkbook } from './workbooks/mockWorkbook.js';

const { createResourceAccessChecker } = exportedForTesting;

const mocks = vi.hoisted(() => ({
  mockGetView: vi.fn(),
  mockGetCustomView: vi.fn(),
  mockGetWorkbook: vi.fn(),
  mockQueryDatasource: vi.fn(),
  mockListDatasources: vi.fn(),
  mockQueryFlow: vi.fn(),
  mockGraphql: vi.fn(),
}));

vi.mock('../../restApiInstance.js', () => ({
  useRestApi: vi.fn().mockImplementation(async ({ callback }) =>
    callback({
      viewsMethods: {
        getView: mocks.mockGetView,
        getCustomView: mocks.mockGetCustomView,
      },
      workbooksMethods: {
        getWorkbook: mocks.mockGetWorkbook,
      },
      datasourcesMethods: {
        queryDatasource: mocks.mockQueryDatasource,
        listDatasources: mocks.mockListDatasources,
      },
      flowsMethods: {
        queryFlow: mocks.mockQueryFlow,
      },
      metadataMethods: {
        graphql: mocks.mockGraphql,
      },
      siteId: 'test-site-id',
    }),
  ),
}));

describe('ResourceAccessChecker', () => {
  const extra = getMockRequestHandlerExtra();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isDatasourceAllowed', () => {
    const mockDatasource = mockDatasources.datasources[0];

    beforeEach(() => {
      mocks.mockQueryDatasource.mockResolvedValue(mockDatasource);
    });

    describe('allowed', () => {
      test.each(
        getCombinationsOfBoundedContextInputs({
          projectIds: [null, new Set([mockDatasource.project.id])],
          datasourceIds: [null, new Set([mockDatasource.id])],
          workbookIds: [null], // n/a for datasources
          viewIds: [null], // n/a for datasources
          tags: [null, new Set([mockDatasource.tags.tag[0].label])],
        }),
      )(
        'should return allowed when the bounded context is projectIds: $projectIds, datasourceIds: $datasourceIds, workbookIds: $workbookIds, viewIds: $viewIds, tags: $tags',
        async ({ projectIds, datasourceIds, workbookIds, viewIds, tags }) => {
          const resourceAccessChecker = createResourceAccessChecker({
            projectIds,
            datasourceIds,
            workbookIds,
            viewIds,
            tags,
          });

          expect(
            await resourceAccessChecker.isDatasourceAllowed({
              datasourceLuid: mockDatasource.id,
              extra,
            }),
            // The datasource is returned as `content` only when a project/tag scope forced a fetch,
            // so the caller can reuse it instead of querying again. Mirrors isWorkbookAllowed.
          ).toEqual({ allowed: true, content: projectIds || tags ? mockDatasource : undefined });

          const expectedNumberOfCalls = projectIds || tags ? 1 : 0;
          expect(mocks.mockQueryDatasource).toHaveBeenCalledTimes(expectedNumberOfCalls);
          expect(mocks.mockGraphql).not.toHaveBeenCalled();
          expect(mocks.mockListDatasources).not.toHaveBeenCalled();
        },
      );
    });

    describe('not allowed', () => {
      const notAllowedCombinations = getCombinationsOfBoundedContextInputs({
        projectIds: [null, new Set(['some-project-id'])],
        datasourceIds: [null, new Set(['some-datasource-id'])],
        workbookIds: [null], // n/a for datasources
        viewIds: [null], // n/a for datasources
        tags: [null, new Set(['some-tag-label'])],
      }).filter(({ projectIds, datasourceIds, workbookIds, viewIds, tags }) => {
        // Remove the combination where they are all null
        return (
          projectIds !== null ||
          datasourceIds !== null ||
          workbookIds !== null ||
          viewIds !== null ||
          tags !== null
        );
      });

      test.each(notAllowedCombinations)(
        'should return not allowed when the bounded context is projectIds: $projectIds, datasourceIds: $datasourceIds, workbookIds: $workbookIds, viewIds: $viewIds, tags: $tags',
        async ({ projectIds, datasourceIds, workbookIds, viewIds, tags }) => {
          const resourceAccessChecker = createResourceAccessChecker({
            projectIds,
            datasourceIds,
            workbookIds,
            viewIds,
            tags,
          });

          const sentences = [
            'The set of allowed data sources that can be queried is limited by the server configuration.',
          ];
          if (datasourceIds) {
            sentences.push(
              `Querying the datasource with LUID ${mockDatasource.id} is not allowed.`,
            );
          } else if (tags) {
            sentences.push(
              `The datasource with LUID ${mockDatasource.id} cannot be queried because it does not have one of the allowed tags.`,
            );
          } else if (projectIds) {
            sentences.push(
              `The datasource with LUID ${mockDatasource.id} cannot be queried because it does not belong to an allowed project.`,
            );
          }

          const expectedMessage = sentences.join(' ');

          expect(
            await resourceAccessChecker.isDatasourceAllowed({
              datasourceLuid: mockDatasource.id,
              extra,
            }),
          ).toEqual({
            allowed: false,
            message: expectedMessage,
          });

          const expectedNumberOfCalls = !datasourceIds && (projectIds || tags) ? 1 : 0;
          expect(mocks.mockQueryDatasource).toHaveBeenCalledTimes(expectedNumberOfCalls);
        },
      );

      it('should deny an embedded (project-less) datasource under a project allowlist', async () => {
        // Embedded (workbook) data sources have no project, so a project allowlist can't admit them;
        // fail closed with an embedded-specific message rather than throwing on `project.id`.
        mocks.mockQueryDatasource.mockResolvedValue({
          ...mockDatasource,
          project: undefined,
          parentType: 'Workbook',
        });

        const resourceAccessChecker = createResourceAccessChecker({
          projectIds: new Set(['some-project-id']),
          datasourceIds: null,
          workbookIds: null,
          viewIds: null,
          tags: null,
        });

        expect(
          await resourceAccessChecker.isDatasourceAllowed({
            datasourceLuid: mockDatasource.id,
            extra,
          }),
        ).toEqual({
          allowed: false,
          message: [
            'The set of allowed data sources that can be queried is limited by the server configuration.',
            `The datasource with LUID ${mockDatasource.id} cannot be queried because it is an embedded (workbook) data source, which cannot be matched against the allowed projects.`,
          ].join(' '),
        });
      });
    });

    describe('when Query Data Source is forbidden', () => {
      const allowedTag = mockDatasource.tags.tag[0].label;
      const allowedProjectId = mockDatasource.project.id;
      // Same name, different LUID: the list lookup must match on LUID, not name.
      const sameNameDatasource = { ...mockDatasources.datasources[1], name: mockDatasource.name };
      const baseMessage =
        'The set of allowed data sources that can be queried is limited by the server configuration.';

      function forbiddenError(status = 403): AxiosError {
        const error = new AxiosError(`Request failed with status code ${status}`);
        error.response = { status } as AxiosError['response'];
        return error;
      }

      function metadataResponse(
        nodes: Array<{ luid: string; name: string; tags: Array<string> }>,
      ): unknown {
        return {
          data: {
            publishedDatasourcesConnection: {
              nodes: nodes.map(({ tags, ...node }) => ({
                ...node,
                tags: tags.map((name) => ({ name })),
              })),
            },
          },
        };
      }

      function createChecker({
        projectIds = null,
        tags = null,
      }: {
        projectIds?: Set<string> | null;
        tags?: Set<string> | null;
      }): ReturnType<typeof createResourceAccessChecker> {
        return createResourceAccessChecker({
          projectIds,
          datasourceIds: null,
          workbookIds: null,
          viewIds: null,
          tags,
        });
      }

      const tagLookupFailedMessage = (status = 403): string =>
        [
          baseMessage,
          `An error occurred while checking if the datasource with LUID ${mockDatasource.id} has one of the allowed tags:`,
          `Request failed with status code ${status}`,
        ].join(' ');

      const projectLookupFailedMessage = (status = 403): string =>
        [
          baseMessage,
          `An error occurred while checking if the datasource with LUID ${mockDatasource.id} is in an allowed project:`,
          `Request failed with status code ${status}`,
        ].join(' ');

      const projectUndeterminedMessage = (): string =>
        `${baseMessage} The datasource with LUID ${mockDatasource.id} cannot be queried because its project could not be determined.`;

      beforeEach(() => {
        mocks.mockQueryDatasource.mockRejectedValue(forbiddenError());
        mocks.mockGraphql.mockResolvedValue(
          metadataResponse([
            { luid: mockDatasource.id, name: mockDatasource.name, tags: [allowedTag] },
          ]),
        );
        mocks.mockListDatasources.mockResolvedValue({
          pagination: mockDatasources.pagination,
          datasources: [sameNameDatasource, mockDatasource],
        });
      });

      it('should read the tags from the Metadata API and allow it when it has an allowed tag', async () => {
        expect(
          await createChecker({ tags: new Set([allowedTag]) }).isDatasourceAllowed({
            datasourceLuid: mockDatasource.id,
            extra,
          }),
        ).toEqual({ allowed: true, content: undefined });
        expect(mocks.mockGraphql.mock.calls[0][0]).toContain(`"${mockDatasource.id}"`);
        // Only the project check needs the list endpoint.
        expect(mocks.mockListDatasources).not.toHaveBeenCalled();
      });

      it('should read the tags from the Metadata API and disallow it when it has no allowed tag', async () => {
        expect(
          await createChecker({ tags: new Set(['other-tag']) }).isDatasourceAllowed({
            datasourceLuid: mockDatasource.id,
            extra,
          }),
        ).toEqual({
          allowed: false,
          message: `${baseMessage} The datasource with LUID ${mockDatasource.id} cannot be queried because it does not have one of the allowed tags.`,
        });
      });

      it('should read the tags from the Metadata API when the datasource name contains a comma', async () => {
        mocks.mockGraphql.mockResolvedValue(
          metadataResponse([
            { luid: mockDatasource.id, name: 'Sales, Finance', tags: [allowedTag] },
          ]),
        );

        expect(
          await createChecker({ tags: new Set([allowedTag]) }).isDatasourceAllowed({
            datasourceLuid: mockDatasource.id,
            extra,
          }),
        ).toEqual({ allowed: true, content: undefined });
        expect(mocks.mockListDatasources).not.toHaveBeenCalled();
      });

      it('should disallow the datasource when the Metadata API returns no tags', async () => {
        mocks.mockGraphql.mockResolvedValue(
          metadataResponse([{ luid: mockDatasource.id, name: mockDatasource.name, tags: [] }]),
        );

        expect(
          await createChecker({ tags: new Set([allowedTag]) }).isDatasourceAllowed({
            datasourceLuid: mockDatasource.id,
            extra,
          }),
        ).toEqual({
          allowed: false,
          message: `${baseMessage} The datasource with LUID ${mockDatasource.id} cannot be queried because it does not have one of the allowed tags.`,
        });
      });

      it('should find the datasource by name and allow it when it is in an allowed project', async () => {
        expect(
          await createChecker({
            projectIds: new Set([allowedProjectId]),
            tags: new Set([allowedTag]),
          }).isDatasourceAllowed({ datasourceLuid: mockDatasource.id, extra }),
        ).toEqual({ allowed: true, content: mockDatasource });
        expect(mocks.mockQueryDatasource).toHaveBeenCalledTimes(1);
        expect(mocks.mockGraphql).toHaveBeenCalledTimes(1);
        expect(mocks.mockListDatasources).toHaveBeenCalledTimes(1);
        expect(mocks.mockListDatasources).toHaveBeenCalledWith(
          expect.objectContaining({ filter: `name:eq:${mockDatasource.name}` }),
        );
      });

      it('should return the datasource found by name when only projects are configured', async () => {
        expect(
          await createChecker({ projectIds: new Set([allowedProjectId]) }).isDatasourceAllowed({
            datasourceLuid: mockDatasource.id,
            extra,
          }),
        ).toEqual({ allowed: true, content: mockDatasource });
      });

      it('should not look up the project when the Metadata API tags are not allowed', async () => {
        expect(
          await createChecker({
            projectIds: new Set([allowedProjectId]),
            tags: new Set(['other-tag']),
          }).isDatasourceAllowed({ datasourceLuid: mockDatasource.id, extra }),
        ).toEqual({
          allowed: false,
          message: `${baseMessage} The datasource with LUID ${mockDatasource.id} cannot be queried because it does not have one of the allowed tags.`,
        });
        expect(mocks.mockListDatasources).not.toHaveBeenCalled();
      });

      it('should find the datasource by name and disallow it when it is not in an allowed project', async () => {
        expect(
          await createChecker({ projectIds: new Set(['other-project-id']) }).isDatasourceAllowed({
            datasourceLuid: mockDatasource.id,
            extra,
          }),
        ).toEqual({
          allowed: false,
          message: `${baseMessage} The datasource with LUID ${mockDatasource.id} cannot be queried because it does not belong to an allowed project.`,
        });
      });

      it('should say the project could not be determined when the list finds no datasource with its LUID', async () => {
        mocks.mockListDatasources.mockResolvedValue({
          pagination: mockDatasources.pagination,
          datasources: [sameNameDatasource],
        });

        expect(
          await createChecker({ projectIds: new Set([allowedProjectId]) }).isDatasourceAllowed({
            datasourceLuid: mockDatasource.id,
            extra,
          }),
        ).toEqual({ allowed: false, message: projectUndeterminedMessage() });
      });

      it('should report the original error when the Metadata API does not return the datasource', async () => {
        mocks.mockGraphql.mockResolvedValue(metadataResponse([]));

        expect(
          await createChecker({ tags: new Set([allowedTag]) }).isDatasourceAllowed({
            datasourceLuid: mockDatasource.id,
            extra,
          }),
        ).toEqual({ allowed: false, message: tagLookupFailedMessage() });
        expect(mocks.mockListDatasources).not.toHaveBeenCalled();
      });

      it('should say the project could not be determined when the datasource name contains a comma', async () => {
        mocks.mockGraphql.mockResolvedValue(
          metadataResponse([{ luid: mockDatasource.id, name: 'Sales, Finance', tags: [] }]),
        );

        expect(
          await createChecker({ projectIds: new Set([allowedProjectId]) }).isDatasourceAllowed({
            datasourceLuid: mockDatasource.id,
            extra,
          }),
        ).toEqual({ allowed: false, message: projectUndeterminedMessage() });
        expect(mocks.mockListDatasources).not.toHaveBeenCalled();
      });

      it('should report the original error when the Metadata API request fails', async () => {
        mocks.mockGraphql.mockRejectedValue(new Error('SITE_CATALOG_DISABLED'));

        expect(
          await createChecker({ tags: new Set([allowedTag]) }).isDatasourceAllowed({
            datasourceLuid: mockDatasource.id,
            extra,
          }),
        ).toEqual({ allowed: false, message: tagLookupFailedMessage() });
      });

      it('should say the project could not be determined when the list request fails', async () => {
        mocks.mockListDatasources.mockRejectedValue(forbiddenError(400));

        expect(
          await createChecker({ projectIds: new Set([allowedProjectId]) }).isDatasourceAllowed({
            datasourceLuid: mockDatasource.id,
            extra,
          }),
        ).toEqual({ allowed: false, message: projectUndeterminedMessage() });
      });

      it('should report the original error from the project check when the Metadata API request fails', async () => {
        mocks.mockGraphql.mockRejectedValue(new Error('SITE_CATALOG_DISABLED'));

        expect(
          await createChecker({ projectIds: new Set([allowedProjectId]) }).isDatasourceAllowed({
            datasourceLuid: mockDatasource.id,
            extra,
          }),
        ).toEqual({ allowed: false, message: projectLookupFailedMessage() });
        expect(mocks.mockListDatasources).not.toHaveBeenCalled();
      });

      it('should name both checks in the error when projects and tags are configured and the fallback fails', async () => {
        mocks.mockGraphql.mockRejectedValue(new Error('SITE_CATALOG_DISABLED'));

        expect(
          await createChecker({
            projectIds: new Set([allowedProjectId]),
            tags: new Set([allowedTag]),
          }).isDatasourceAllowed({ datasourceLuid: mockDatasource.id, extra }),
        ).toEqual({
          allowed: false,
          message: [
            baseMessage,
            `An error occurred while checking if the datasource with LUID ${mockDatasource.id} is in an allowed project and has one of the allowed tags:`,
            'Request failed with status code 403',
          ].join(' '),
        });
      });

      it.each([
        ['TableauRestError', new TableauRestError({ code: '403004', summary: 'Forbidden' })],
        ['ZodiosError', new ZodiosError('Forbidden', undefined, undefined, forbiddenError())],
      ])('should fall back when the 403 is a %s', async (_, error) => {
        mocks.mockQueryDatasource.mockRejectedValue(error);

        expect(
          await createChecker({ tags: new Set([allowedTag]) }).isDatasourceAllowed({
            datasourceLuid: mockDatasource.id,
            extra,
          }),
        ).toEqual({ allowed: true, content: undefined });
      });

      it('should not fall back when the Query Data Source error is not a 403', async () => {
        mocks.mockQueryDatasource.mockRejectedValue(forbiddenError(500));

        expect(
          await createChecker({ tags: new Set([allowedTag]) }).isDatasourceAllowed({
            datasourceLuid: mockDatasource.id,
            extra,
          }),
        ).toEqual({ allowed: false, message: tagLookupFailedMessage(500) });
        expect(mocks.mockGraphql).not.toHaveBeenCalled();
      });

      it('should not fall back from the project check when the Query Data Source error is not a 403', async () => {
        mocks.mockQueryDatasource.mockRejectedValue(forbiddenError(500));

        expect(
          await createChecker({ projectIds: new Set([allowedProjectId]) }).isDatasourceAllowed({
            datasourceLuid: mockDatasource.id,
            extra,
          }),
        ).toEqual({ allowed: false, message: projectLookupFailedMessage(500) });
        expect(mocks.mockGraphql).not.toHaveBeenCalled();
      });

      it('should not fall back when Metadata API requests are disabled', async () => {
        const extraWithMetadataDisabled = getMockRequestHandlerExtra({
          getConfigWithOverrides: vi
            .fn()
            .mockResolvedValue(new OverridableConfig({ DISABLE_METADATA_API_REQUESTS: 'true' })),
        });

        expect(
          await createChecker({ tags: new Set([allowedTag]) }).isDatasourceAllowed({
            datasourceLuid: mockDatasource.id,
            extra: extraWithMetadataDisabled,
          }),
        ).toEqual({ allowed: false, message: tagLookupFailedMessage() });
        expect(mocks.mockGraphql).not.toHaveBeenCalled();
      });
    });
  });

  describe('isWorkbookAllowed', () => {
    beforeEach(() => {
      mocks.mockGetWorkbook.mockResolvedValue(mockWorkbook);
    });

    describe('allowed', () => {
      test.each(
        getCombinationsOfBoundedContextInputs({
          projectIds: [null, new Set([mockWorkbook.project.id])],
          datasourceIds: [null], // n/a for workbooks
          workbookIds: [null, new Set([mockWorkbook.id])],
          viewIds: [null], // n/a for workbooks
          tags: [null, new Set([mockWorkbook.tags.tag[0].label])],
        }),
      )(
        'should return allowed when the bounded context is projectIds: $projectIds, datasourceIds: $datasourceIds, workbookIds: $workbookIds, viewIds: $viewIds, tags: $tags',
        async ({ projectIds, datasourceIds, workbookIds, viewIds, tags }) => {
          const resourceAccessChecker = createResourceAccessChecker({
            projectIds,
            datasourceIds,
            workbookIds,
            viewIds,
            tags,
          });

          expect(
            await resourceAccessChecker.isWorkbookAllowed({
              workbookId: mockWorkbook.id,
              extra,
            }),
          ).toEqual({ allowed: true, content: projectIds || tags ? mockWorkbook : undefined });

          const expectedNumberOfCalls = projectIds || tags ? 1 : 0;
          expect(mocks.mockGetWorkbook).toHaveBeenCalledTimes(expectedNumberOfCalls);
        },
      );
    });

    describe('not allowed', () => {
      const notAllowedCombinations = getCombinationsOfBoundedContextInputs({
        projectIds: [null, new Set(['some-project-id'])],
        datasourceIds: [null], // n/a for workbooks
        workbookIds: [null, new Set(['some-workbook-id'])],
        viewIds: [null], // n/a for workbooks
        tags: [null, new Set(['some-tag-label'])],
      }).filter(({ projectIds, datasourceIds, workbookIds, viewIds, tags }) => {
        // Remove the combination where they are all null
        return (
          projectIds !== null ||
          datasourceIds !== null ||
          workbookIds !== null ||
          viewIds !== null ||
          tags !== null
        );
      });

      test.each(notAllowedCombinations)(
        'should return not allowed when the bounded context is projectIds: $projectIds, datasourceIds: $datasourceIds, workbookIds: $workbookIds, viewIds: $viewIds, tags: $tags',
        async ({ projectIds, datasourceIds, workbookIds, viewIds, tags }) => {
          const resourceAccessChecker = createResourceAccessChecker({
            projectIds,
            datasourceIds,
            workbookIds,
            viewIds,
            tags,
          });

          const sentences = [
            'The set of allowed workbooks that can be queried is limited by the server configuration.',
          ];
          if (workbookIds) {
            sentences.push(`Querying the workbook with LUID ${mockWorkbook.id} is not allowed.`);
          } else if (projectIds) {
            sentences.push(
              `The workbook with LUID ${mockWorkbook.id} cannot be queried because it does not belong to an allowed project.`,
            );
          } else if (tags) {
            sentences.push(
              `The workbook with LUID ${mockWorkbook.id} cannot be queried because it does not have one of the allowed tags.`,
            );
          }

          const expectedMessage = sentences.join(' ');

          expect(
            await resourceAccessChecker.isWorkbookAllowed({
              workbookId: mockWorkbook.id,
              extra,
            }),
          ).toEqual({
            allowed: false,
            message: expectedMessage,
          });

          const expectedNumberOfCalls = !workbookIds && (projectIds || tags) ? 1 : 0;
          expect(mocks.mockGetWorkbook).toHaveBeenCalledTimes(expectedNumberOfCalls);
        },
      );
    });
  });

  describe('isFlowAllowed', () => {
    beforeEach(() => {
      mocks.mockQueryFlow.mockResolvedValue({ flow: mockFlow, outputSteps: mockOutputSteps });
    });

    describe('allowed', () => {
      // Flows are gated only by project and tag bounded contexts (there is no
      // dedicated `flowIds` set), so datasourceIds / workbookIds are n/a here.
      test.each(
        getCombinationsOfBoundedContextInputs({
          projectIds: [null, new Set([mockFlow.project.id])],
          datasourceIds: [null], // n/a for flows
          workbookIds: [null], // n/a for flows
          viewIds: [null], // n/a for flows
          tags: [null, new Set([mockFlow.tags.tag[0].label])],
        }),
      )(
        'should return allowed when the bounded context is projectIds: $projectIds, datasourceIds: $datasourceIds, workbookIds: $workbookIds, tags: $tags',
        async ({ projectIds, datasourceIds, workbookIds, viewIds, tags }) => {
          const resourceAccessChecker = createResourceAccessChecker({
            projectIds,
            datasourceIds,
            workbookIds,
            viewIds,
            tags,
          });

          // The checker returns the fetched flow as `content` (so get-flow can
          // reuse it) only when it actually had to fetch the flow to evaluate a
          // project or tag filter.
          const expectedContent =
            projectIds || tags ? { flow: mockFlow, outputSteps: mockOutputSteps } : undefined;

          expect(await resourceAccessChecker.isFlowAllowed({ flowId: mockFlow.id, extra })).toEqual(
            { allowed: true, content: expectedContent },
          );

          // Call again to confirm each invocation re-evaluates the flow (the
          // checker holds no result cache).
          expect(await resourceAccessChecker.isFlowAllowed({ flowId: mockFlow.id, extra })).toEqual(
            { allowed: true, content: expectedContent },
          );

          // With project or tag filtering, the flow is fetched once per invocation, so two invocations call the "Query Flow" API twice.
          const expectedNumberOfCalls = projectIds || tags ? 2 : 0;
          expect(mocks.mockQueryFlow).toHaveBeenCalledTimes(expectedNumberOfCalls);
        },
      );
    });

    describe('not allowed', () => {
      const notAllowedCombinations = getCombinationsOfBoundedContextInputs({
        projectIds: [null, new Set(['some-project-id'])],
        datasourceIds: [null], // n/a for flows
        workbookIds: [null], // n/a for flows
        viewIds: [null], // n/a for flows
        tags: [null, new Set(['some-tag-label'])],
      }).filter(({ projectIds, datasourceIds, workbookIds, tags }) => {
        // Remove the combination where they are all null
        return (
          projectIds !== null || datasourceIds !== null || workbookIds !== null || tags !== null
        );
      });

      test.each(notAllowedCombinations)(
        'should return not allowed when the bounded context is projectIds: $projectIds, datasourceIds: $datasourceIds, workbookIds: $workbookIds, tags: $tags',
        async ({ projectIds, datasourceIds, workbookIds, viewIds, tags }) => {
          const resourceAccessChecker = createResourceAccessChecker({
            projectIds,
            datasourceIds,
            workbookIds,
            viewIds,
            tags,
          });

          const sentences = [
            'The set of allowed flows that can be queried is limited by the server configuration.',
          ];
          // The project check runs before the tag check, so a project mismatch
          // wins when both filters are set.
          if (projectIds) {
            sentences.push(
              `The flow with LUID ${mockFlow.id} cannot be queried because it does not belong to an allowed project.`,
            );
          } else if (tags) {
            sentences.push(
              `The flow with LUID ${mockFlow.id} cannot be queried because it does not have one of the allowed tags.`,
            );
          }

          const expectedMessage = sentences.join(' ');

          expect(await resourceAccessChecker.isFlowAllowed({ flowId: mockFlow.id, extra })).toEqual(
            {
              allowed: false,
              message: expectedMessage,
            },
          );

          expect(await resourceAccessChecker.isFlowAllowed({ flowId: mockFlow.id, extra })).toEqual(
            {
              allowed: false,
              message: expectedMessage,
            },
          );

          // Project/tag filtering disables caching, so the "Query Flow" API is called each time.
          const expectedNumberOfCalls = projectIds || tags ? 2 : 0;
          expect(mocks.mockQueryFlow).toHaveBeenCalledTimes(expectedNumberOfCalls);
        },
      );
    });
  });

  describe('isViewAllowed', () => {
    beforeEach(() => {
      mocks.mockGetView.mockResolvedValue(mockView);
    });

    describe('allowed', () => {
      test.each(
        getCombinationsOfBoundedContextInputs({
          projectIds: [null, new Set([mockView.project.id])],
          datasourceIds: [null], // n/a for views
          workbookIds: [null, new Set([mockView.workbook.id])],
          viewIds: [null, new Set([mockView.id])],
          tags: [null, new Set([mockView.tags.tag[0].label])],
        }),
      )(
        'should return allowed when the bounded context is projectIds: $projectIds, datasourceIds: $datasourceIds, workbookIds: $workbookIds, viewIds: $viewIds, tags: $tags',
        async ({ projectIds, datasourceIds, workbookIds, viewIds, tags }) => {
          const resourceAccessChecker = createResourceAccessChecker({
            projectIds,
            datasourceIds,
            workbookIds,
            viewIds,
            tags,
          });

          expect(
            await resourceAccessChecker.isViewAllowed({
              viewId: mockView.id,
              extra,
            }),
          ).toEqual({
            allowed: true,
            content: workbookIds || projectIds || tags ? mockView : undefined,
          });

          // viewIds is a synchronous Set lookup; only workbook/project/tag checks fetch the view.
          const expectedNumberOfCalls = workbookIds || projectIds || tags ? 1 : 0;
          expect(mocks.mockGetView).toHaveBeenCalledTimes(expectedNumberOfCalls);
        },
      );
    });

    describe('not allowed', () => {
      const notAllowedCombinations = getCombinationsOfBoundedContextInputs({
        projectIds: [null, new Set(['some-project-id'])],
        datasourceIds: [null], // n/a for views
        workbookIds: [null, new Set(['some-workbook-id'])],
        viewIds: [null, new Set(['some-view-id'])],
        tags: [null, new Set(['some-tag-label'])],
      }).filter(({ projectIds, datasourceIds, workbookIds, viewIds, tags }) => {
        // Remove the combination where they are all null
        return (
          projectIds !== null ||
          datasourceIds !== null ||
          workbookIds !== null ||
          viewIds !== null ||
          tags !== null
        );
      });

      test.each(notAllowedCombinations)(
        'should return not allowed when the bounded context is projectIds: $projectIds, datasourceIds: $datasourceIds, workbookIds: $workbookIds, viewIds: $viewIds, tags: $tags',
        async ({ projectIds, datasourceIds, workbookIds, viewIds, tags }) => {
          const resourceAccessChecker = createResourceAccessChecker({
            projectIds,
            datasourceIds,
            workbookIds,
            viewIds,
            tags,
          });

          const sentences = [
            'The set of allowed views that can be queried is limited by the server configuration.',
          ];
          // Order must match the production order in _isViewAllowed:
          // viewIds → workbookIds → projectIds → tags.
          if (viewIds) {
            sentences.push(`Querying the view with LUID ${mockView.id} is not allowed.`);
          } else if (workbookIds) {
            sentences.push(
              `The view with LUID ${mockView.id} cannot be queried because it does not belong to an allowed workbook.`,
            );
          } else if (projectIds) {
            sentences.push(
              `The view with LUID ${mockView.id} cannot be queried because it does not belong to an allowed project.`,
            );
          } else if (tags) {
            sentences.push(
              `The view with LUID ${mockView.id} cannot be queried because it does not have one of the allowed tags.`,
            );
          }

          const expectedMessage = sentences.join(' ');

          expect(
            await resourceAccessChecker.isViewAllowed({
              viewId: mockView.id,
              extra,
            }),
          ).toEqual({
            allowed: false,
            message: expectedMessage,
          });

          // viewIds short-circuits before any getView() call.
          const expectedNumberOfCalls = !viewIds && (workbookIds || projectIds || tags) ? 1 : 0;
          expect(mocks.mockGetView).toHaveBeenCalledTimes(expectedNumberOfCalls);
        },
      );
    });
  });

  describe('isCustomViewAllowed', () => {
    beforeEach(() => {
      mocks.mockGetCustomView.mockResolvedValue(mockCustomView);
      mocks.mockGetView.mockResolvedValue(mockView);
    });

    it('should allow when the underlying published view is allowed', async () => {
      const resourceAccessChecker = createResourceAccessChecker({
        projectIds: null,
        datasourceIds: null,
        workbookIds: null,
        viewIds: null,
        tags: null,
      });

      expect(
        await resourceAccessChecker.isCustomViewAllowed({
          customViewId: mockCustomView.id,
          extra,
        }),
      ).toEqual({ allowed: true });

      // When no filtering is enabled, we don't need to resolve the underlying view.
      expect(mocks.mockGetCustomView).not.toHaveBeenCalled();
    });

    it('should not allow the custom view when resolving it fails', async () => {
      const resourceAccessChecker = createResourceAccessChecker({
        projectIds: null,
        datasourceIds: null,
        workbookIds: new Set(['some-workbook-id']),
        viewIds: null,
        tags: null,
      });

      // mock getCustomView to throw an error
      mocks.mockGetCustomView.mockRejectedValue(new Error('Custom view not found'));

      expect(
        await resourceAccessChecker.isCustomViewAllowed({
          customViewId: 'some-custom-view-id',
          extra,
        }),
      ).toEqual({
        allowed: false,
        message: [
          'The set of allowed views that can be queried is limited by the server configuration.',
          'An error occurred while checking if the custom view with LUID some-custom-view-id belongs to an allowed view.',
          'Please verify that the custom view LUID is correct and you have access to it.',
          'Custom view not found',
        ].join(' '),
      });
    });

    it('should not allow when the underlying view is excluded by workbook id gate', async () => {
      const resourceAccessChecker = createResourceAccessChecker({
        projectIds: null,
        datasourceIds: null,
        workbookIds: new Set(['some-workbook-id']),
        viewIds: null,
        tags: null,
      });

      expect(
        await resourceAccessChecker.isCustomViewAllowed({
          customViewId: mockCustomView.id,
          extra,
        }),
      ).toEqual({
        allowed: false,
        message: [
          'The set of allowed views that can be queried is limited by the server configuration.',
          `The view with LUID ${mockView.id} cannot be queried because it does not belong to an allowed workbook.`,
        ].join(' '),
      });
    });

    it('should not allow when the underlying view is excluded by project id gate', async () => {
      const resourceAccessChecker = createResourceAccessChecker({
        projectIds: new Set(['some-project-id']),
        datasourceIds: null,
        workbookIds: null,
        viewIds: null,
        tags: null,
      });

      expect(
        await resourceAccessChecker.isCustomViewAllowed({
          customViewId: mockCustomView.id,
          extra,
        }),
      ).toEqual({
        allowed: false,
        message: [
          'The set of allowed views that can be queried is limited by the server configuration.',
          `The view with LUID ${mockView.id} cannot be queried because it does not belong to an allowed project.`,
        ].join(' '),
      });
    });

    it('should not allow when the underlying view is excluded by tag gate', async () => {
      const resourceAccessChecker = createResourceAccessChecker({
        projectIds: null,
        datasourceIds: null,
        workbookIds: null,
        viewIds: null,
        tags: new Set(['some-tag-label']),
      });

      expect(
        await resourceAccessChecker.isCustomViewAllowed({
          customViewId: mockCustomView.id,
          extra,
        }),
      ).toEqual({
        allowed: false,
        message: [
          'The set of allowed views that can be queried is limited by the server configuration.',
          `The view with LUID ${mockView.id} cannot be queried because it does not have one of the allowed tags.`,
        ].join(' '),
      });
    });

    it('should not allow when the underlying view is excluded by view id gate', async () => {
      const resourceAccessChecker = createResourceAccessChecker({
        projectIds: null,
        datasourceIds: null,
        workbookIds: null,
        viewIds: new Set(['some-other-view-id']),
        tags: null,
      });

      expect(
        await resourceAccessChecker.isCustomViewAllowed({
          customViewId: mockCustomView.id,
          extra,
        }),
      ).toEqual({
        allowed: false,
        message: [
          'The set of allowed views that can be queried is limited by the server configuration.',
          `Querying the view with LUID ${mockView.id} is not allowed.`,
        ].join(' '),
      });

      // The custom view must be resolved to look up its underlying view id.
      expect(mocks.mockGetCustomView).toHaveBeenCalledTimes(1);
      // viewIds short-circuits inside _isViewAllowed, so getView is not called.
      expect(mocks.mockGetView).not.toHaveBeenCalled();
    });

    it('should allow when only viewIds is set and the underlying view matches', async () => {
      const resourceAccessChecker = createResourceAccessChecker({
        projectIds: null,
        datasourceIds: null,
        workbookIds: null,
        viewIds: new Set([mockView.id]),
        tags: null,
      });

      expect(
        await resourceAccessChecker.isCustomViewAllowed({
          customViewId: mockCustomView.id,
          extra,
        }),
      ).toEqual({ allowed: true });

      expect(mocks.mockGetCustomView).toHaveBeenCalledTimes(1);
      expect(mocks.mockGetView).not.toHaveBeenCalled();
    });
  });
});
