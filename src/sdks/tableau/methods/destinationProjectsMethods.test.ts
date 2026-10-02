import { describe, expect, it, vi } from 'vitest';

import { destinationProjectSchema } from '../types/project.js';
import DestinationProjectsMethods from './destinationProjectsMethods.js';

const pagination = { pageNumber: 1, pageSize: 100, totalAvailable: 1 };

function getMethods(
  queryDestinationProjects: ReturnType<typeof vi.fn>,
): DestinationProjectsMethods {
  const methods = new DestinationProjectsMethods(
    'http://test',
    { type: 'Bearer', token: 'test' },
    {},
  );
  // @ts-expect-error - Mocking private property
  methods._apiClient = { queryDestinationProjects };
  return methods;
}

describe('DestinationProjectsMethods', () => {
  describe('queryDestinationProjects', () => {
    it('should join sourceIds into a comma-separated query value', async () => {
      const queryDestinationProjects = vi.fn().mockResolvedValue({
        pagination,
        destinationProjects: { destinationProject: [] },
      });

      await getMethods(queryDestinationProjects).queryDestinationProjects({
        siteId: 'site-1',
        contentType: 'project',
        sourceIds: ['a', 'b'],
        filter: 'name:eq:Finance',
        pageSize: 1000,
        pageNumber: 2,
      });

      expect(queryDestinationProjects).toHaveBeenCalledWith(
        expect.objectContaining({
          params: { siteId: 'site-1' },
          queries: {
            contentType: 'project',
            sourceIds: 'a,b',
            filter: 'name:eq:Finance',
            pageSize: 1000,
            pageNumber: 2,
          },
        }),
      );
    });

    it('should omit empty sourceIds and filter', async () => {
      const queryDestinationProjects = vi.fn().mockResolvedValue({
        pagination,
        destinationProjects: { destinationProject: [] },
      });

      await getMethods(queryDestinationProjects).queryDestinationProjects({
        siteId: 'site-1',
        contentType: 'workbook',
        sourceIds: [],
        filter: '',
      });

      expect(queryDestinationProjects).toHaveBeenCalledWith(
        expect.objectContaining({
          queries: expect.objectContaining({ sourceIds: undefined, filter: undefined }),
        }),
      );
    });

    it('should return an empty projects array when the API returns none', async () => {
      const queryDestinationProjects = vi.fn().mockResolvedValue({
        pagination: { ...pagination, totalAvailable: 0 },
        destinationProjects: {},
      });

      const result = await getMethods(queryDestinationProjects).queryDestinationProjects({
        siteId: 'site-1',
        contentType: 'workbook',
      });

      expect(result.projects).toEqual([]);
      expect(result.pagination.totalAvailable).toBe(0);
    });
  });

  describe('destinationProjectSchema', () => {
    it('should parse string booleans and numbers from the REST response', () => {
      const parsed = destinationProjectSchema.parse({
        id: 'p1',
        name: 'Default',
        topLevelProject: 'true',
        isDefaultProject: 'false',
        childProjectCount: '3',
        status: 'VALID',
        owner: { id: 'u1', name: 'admin' },
      });

      expect(parsed).toMatchObject({
        topLevelProject: true,
        isDefaultProject: false,
        childProjectCount: 3,
        status: 'VALID',
      });
    });

    it('should reject an unknown status', () => {
      expect(() =>
        destinationProjectSchema.parse({ id: 'p1', name: 'Default', status: 'MAYBE' }),
      ).toThrow();
    });
  });
});
