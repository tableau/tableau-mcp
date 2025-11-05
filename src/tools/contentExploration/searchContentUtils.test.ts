import { OrderBy, SearchContentFilter } from '../../sdks/tableau/types/contentExploration.js';
import invariant from '../../utils/invariant.js';
import { mockSearchContentResponse } from './searchContent.test.js';
import {
  buildFilterString,
  buildOrderByString,
  constrainSearchContent,
  reduceSearchContentResponse,
} from './searchContentUtils.js';

describe('searchContentUtils', () => {
  describe('buildOrderByString', () => {
    it('should build order by string with single method', () => {
      const orderBy: OrderBy = [{ method: 'hitsTotal' }];
      const result = buildOrderByString(orderBy);
      expect(result).toBe('hitsTotal');
    });

    it('should build order by string with method and direction', () => {
      const orderBy: OrderBy = [{ method: 'hitsTotal', sortDirection: 'desc' }];
      const result = buildOrderByString(orderBy);
      expect(result).toBe('hitsTotal:desc');
    });

    it('should build order by string with multiple methods', () => {
      const orderBy: OrderBy = [
        { method: 'hitsTotal', sortDirection: 'desc' },
        { method: 'hitsSmallSpanTotal', sortDirection: 'asc' },
      ];
      const result = buildOrderByString(orderBy);
      expect(result).toBe('hitsTotal:desc,hitsSmallSpanTotal:asc');
    });

    it('should skip duplicate methods', () => {
      const orderBy: OrderBy = [
        { method: 'hitsTotal', sortDirection: 'desc' },
        { method: 'hitsTotal', sortDirection: 'asc' }, // duplicate
        { method: 'hitsSmallSpanTotal' },
      ];
      const result = buildOrderByString(orderBy);
      expect(result).toBe('hitsTotal:desc,hitsSmallSpanTotal');
    });

    it('should handle method without sortDirection', () => {
      const orderBy: OrderBy = [
        { method: 'hitsTotal', sortDirection: 'desc' },
        { method: 'hitsSmallSpanTotal' }, // no sortDirection
      ];
      const result = buildOrderByString(orderBy);
      expect(result).toBe('hitsTotal:desc,hitsSmallSpanTotal');
    });

    it('should handle all supported methods', () => {
      const orderBy: OrderBy = [
        { method: 'hitsTotal' },
        { method: 'hitsSmallSpanTotal' },
        { method: 'hitsMediumSpanTotal' },
        { method: 'hitsLargeSpanTotal' },
        { method: 'downstreamWorkbookCount' },
      ];
      const result = buildOrderByString(orderBy);
      expect(result).toBe(
        'hitsTotal,hitsSmallSpanTotal,hitsMediumSpanTotal,hitsLargeSpanTotal,downstreamWorkbookCount',
      );
    });
  });

  describe('buildFilterString', () => {
    it('should build filter string with single content type', () => {
      const filter: SearchContentFilter = { contentTypes: ['workbook'] };
      const result = buildFilterString(filter);
      expect(result).toBe('type:eq:workbook');
    });

    it('should build filter string with multiple content types', () => {
      const filter: SearchContentFilter = { contentTypes: ['workbook', 'datasource'] };
      const result = buildFilterString(filter);
      expect(result).toBe('type:in:[workbook,datasource]');
    });

    it('should deduplicate content types', () => {
      const filter: SearchContentFilter = {
        contentTypes: ['workbook', 'workbook', 'datasource'],
      };
      const result = buildFilterString(filter);
      expect(result).toBe('type:in:[workbook,datasource]');
    });

    it('should build filter string with single owner ID', () => {
      const filter: SearchContentFilter = { ownerIds: [123] };
      const result = buildFilterString(filter);
      expect(result).toBe('ownerId:eq:123');
    });

    it('should build filter string with multiple owner IDs', () => {
      const filter: SearchContentFilter = { ownerIds: [123, 456] };
      const result = buildFilterString(filter);
      expect(result).toBe('ownerId:in:[123,456]');
    });

    it('should deduplicate owner IDs', () => {
      const filter: SearchContentFilter = { ownerIds: [123, 123, 456] };
      const result = buildFilterString(filter);
      expect(result).toBe('ownerId:in:[123,456]');
    });

    it('should build filter string with single modified time', () => {
      const filter: SearchContentFilter = { modifiedTime: ['2024-01-01T00:00:00Z'] };
      const result = buildFilterString(filter);
      expect(result).toBe('modifiedTime:eq:2024-01-01T00:00:00Z');
    });

    it('should build filter string with multiple modified times', () => {
      const filter: SearchContentFilter = {
        modifiedTime: ['2024-01-01T00:00:00Z', '2024-01-02T00:00:00Z'],
      };
      const result = buildFilterString(filter);
      expect(result).toBe('modifiedTime:in:[2024-01-01T00:00:00Z,2024-01-02T00:00:00Z]');
    });

    it('should deduplicate modified times', () => {
      const filter: SearchContentFilter = {
        modifiedTime: ['2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z', '2024-01-02T00:00:00Z'],
      };
      const result = buildFilterString(filter);
      expect(result).toBe('modifiedTime:in:[2024-01-01T00:00:00Z,2024-01-02T00:00:00Z]');
    });

    it('should build filter string with modified time range (start and end)', () => {
      const filter: SearchContentFilter = {
        modifiedTime: {
          startDate: '2024-01-01T00:00:00Z',
          endDate: '2024-01-31T23:59:59Z',
        },
      };
      const result = buildFilterString(filter);
      expect(result).toBe(
        'modifiedTime:gte:2024-01-01T00:00:00Z,modifiedTime:lte:2024-01-31T23:59:59Z',
      );
    });

    it('should handle reversed date range by swapping dates', () => {
      const filter: SearchContentFilter = {
        modifiedTime: {
          startDate: '2024-01-31T23:59:59Z', // later date
          endDate: '2024-01-01T00:00:00Z', // earlier date
        },
      };
      const result = buildFilterString(filter);
      expect(result).toBe(
        'modifiedTime:gte:2024-01-01T00:00:00Z,modifiedTime:lte:2024-01-31T23:59:59Z',
      );
    });

    it('should build filter string with only start date', () => {
      const filter: SearchContentFilter = {
        modifiedTime: {
          startDate: '2024-01-01T00:00:00Z',
        },
      };
      const result = buildFilterString(filter);
      expect(result).toBe('modifiedTime:gte:2024-01-01T00:00:00Z');
    });

    it('should build filter string with only end date', () => {
      const filter: SearchContentFilter = {
        modifiedTime: {
          endDate: '2024-01-31T23:59:59Z',
        },
      };
      const result = buildFilterString(filter);
      expect(result).toBe('modifiedTime:lte:2024-01-31T23:59:59Z');
    });

    it('should build complex filter string with all parameters', () => {
      const filter: SearchContentFilter = {
        contentTypes: ['workbook', 'datasource'],
        ownerIds: [123, 456],
        modifiedTime: {
          startDate: '2024-01-01T00:00:00Z',
          endDate: '2024-01-31T23:59:59Z',
        },
      };
      const result = buildFilterString(filter);
      expect(result).toBe(
        'type:in:[workbook,datasource],ownerId:in:[123,456],modifiedTime:gte:2024-01-01T00:00:00Z,modifiedTime:lte:2024-01-31T23:59:59Z',
      );
    });

    it('should return empty string for empty filter', () => {
      const filter = {} as any;
      const result = buildFilterString(filter);
      expect(result).toBe('');
    });
  });

  describe('reduceSearchContentResponse', () => {
    it('should reduce search content response with full item data', () => {
      const response = {
        total: 1,
        items: [
          {
            uri: 'test-uri',
            content: {
              type: 'workbook',
              luid: 'test-luid',
              title: 'Test Workbook',
              ownerName: 'John Doe',
              ownerId: 123,
              ownerEmail: 'john@example.com',
              projectName: 'Finance',
              containerName: 'Finance',
              hitsTotal: 150,
              hitsSmallSpanTotal: 10,
              hitsMediumSpanTotal: 25,
              hitsLargeSpanTotal: 50,
              favoritesTotal: 5,
              modifiedTime: '2024-01-15T10:30:00Z',
              createdTime: '2023-12-01T09:00:00Z',
              tags: ['dashboard', 'sales'],
              comments: ['Great dashboard!'],
              fields: ['Sales', 'Region'],
              extraProperty: 'should not be included',
            },
          },
        ],
      };

      const result = reduceSearchContentResponse(response);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: 'workbook',
        luid: 'test-luid',
        title: 'Test Workbook',
        ownerName: 'John Doe',
        ownerId: 123,
        projectName: 'Finance',
        containerName: 'Finance',
        totalViewCount: 150,
        viewCountLastMonth: 10,
        favoritesTotal: 5,
        modifiedTime: '2024-01-15T10:30:00Z',
        tags: ['dashboard', 'sales'],
        comments: ['Great dashboard!'],
      });

      // Should not include extraProperty
      expect(result[0]).not.toHaveProperty('extraProperty');
    });

    it('should handle items with partial data', () => {
      const response = {
        total: 1,
        items: [
          {
            uri: 'test-uri',
            content: {
              type: 'datasource',
              title: 'Test Datasource',
              ownerId: 456,
            },
          },
        ],
      };

      const result = reduceSearchContentResponse(response);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: 'datasource',
        title: 'Test Datasource',
        ownerId: 456,
      });
    });

    it('should handle zero values for numeric fields', () => {
      const response = {
        total: 1,
        items: [
          {
            uri: 'test-uri',
            content: {
              type: 'view',
              title: 'Test View',
              hitsTotal: 0,
              hitsSmallSpanTotal: 0,
              hitsMediumSpanTotal: 0,
              hitsLargeSpanTotal: 0,
              favoritesTotal: 0,
              hitsLastTwoWeeksTotal: 0,
            },
          },
        ],
      };

      const result = reduceSearchContentResponse(response);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: 'view',
        title: 'Test View',
        totalViewCount: 0,
        viewCountLastMonth: 0,
        favoritesTotal: 0,
      });
    });

    it('should handle empty arrays for tags and comments', () => {
      const response = {
        total: 1,
        items: [
          {
            uri: 'test-uri',
            content: {
              type: 'workbook',
              title: 'Test Workbook',
              tags: [],
              comments: [],
            },
          },
        ],
      };

      const result = reduceSearchContentResponse(response);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: 'workbook',
        title: 'Test Workbook',
      });

      // Empty arrays should not be included
      expect(result[0]).not.toHaveProperty('tags');
      expect(result[0]).not.toHaveProperty('comments');
    });

    it('should handle response with no items', () => {
      const response = {
        total: 0,
        items: undefined,
      };

      const result = reduceSearchContentResponse(response);
      expect(result).toEqual([]);
    });

    it('should handle response with empty items array', () => {
      const response = {
        total: 0,
        items: [],
      };

      const result = reduceSearchContentResponse(response);
      expect(result).toEqual([]);
    });

    it('should map containerName to parentWorkbookName for views', () => {
      const response = {
        total: 1,
        items: [
          {
            uri: 'test-uri',
            content: {
              type: 'view',
              title: 'Test View',
              containerName: 'Parent Workbook',
              ownerId: 123,
            },
          },
        ],
      };

      const result = reduceSearchContentResponse(response);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: 'view',
        title: 'Test View',
        parentWorkbookName: 'Parent Workbook',
        ownerId: 123,
      });

      // Should not have containerName for views
      expect(result[0]).not.toHaveProperty('containerName');
    });

    it('should map containerName normally for non-views', () => {
      const response = {
        total: 1,
        items: [
          {
            uri: 'test-uri',
            content: {
              type: 'workbook',
              title: 'Test Workbook',
              containerName: 'Finance Project',
              ownerId: 123,
            },
          },
        ],
      };

      const result = reduceSearchContentResponse(response);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        type: 'workbook',
        title: 'Test Workbook',
        containerName: 'Finance Project',
        ownerId: 123,
      });

      // Should not have parentWorkbookName for non-views
      expect(result[0]).not.toHaveProperty('parentWorkbookName');
    });

    it('should handle multiple items', () => {
      const response = {
        total: 2,
        items: [
          {
            uri: 'test-uri-1',
            content: {
              type: 'workbook',
              title: 'Workbook 1',
              ownerId: 123,
            },
          },
          {
            uri: 'test-uri-2',
            content: {
              type: 'datasource',
              title: 'Datasource 1',
              ownerId: 456,
            },
          },
        ],
      };

      const result = reduceSearchContentResponse(response);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        type: 'workbook',
        title: 'Workbook 1',
        ownerId: 123,
      });
      expect(result[1]).toEqual({
        type: 'datasource',
        title: 'Datasource 1',
        ownerId: 456,
      });
    });
  });

  describe('constrainSearchContent', () => {
    it('should return empty result when no items are found', () => {
      const result = constrainSearchContent({
        items: [],
        boundedContext: {
          projectIds: null,
          datasourceIds: null,
          workbookIds: null,
        },
      });

      invariant(result.type === 'empty');
      expect(result.message).toBe(
        'No search results were found. Either none exist or you do not have permission to view them.',
      );
    });

    it('should return empty result when all items were filtered out by the bounded context', () => {
      const items = reduceSearchContentResponse(mockSearchContentResponse);

      const result = constrainSearchContent({
        items,
        boundedContext: {
          projectIds: new Set(['123']),
          datasourceIds: null,
          workbookIds: null,
        },
      });

      invariant(result.type === 'empty');
      expect(result.message).toBe(
        [
          'The set of allowed content that can be queried is limited by the server configuration.',
          'While search results were found, they were all filtered out by the server configuration.',
        ].join(' '),
      );
    });

    it('should return success result when no items were filtered out by the bounded context', () => {
      const items = reduceSearchContentResponse(mockSearchContentResponse);

      const result = constrainSearchContent({
        items,
        boundedContext: {
          projectIds: null,
          datasourceIds: null,
          workbookIds: null,
        },
      });

      invariant(result.type === 'success');
      expect(result.result).toBe(items);
    });

    it('should return success result when some items were filtered out by allowed projects in the bounded context', () => {
      const items = reduceSearchContentResponse(mockSearchContentResponse);
      const result = constrainSearchContent({
        items,
        boundedContext: {
          projectIds: new Set(['123456']),
          datasourceIds: null,
          workbookIds: null,
        },
      });

      invariant(result.type === 'success');
      expect(result.result).toEqual([items[0]]);
    });

    it('should return success result when some items were filtered out by allowed datasources in the bounded context', () => {
      const items = reduceSearchContentResponse(mockSearchContentResponse);
      const result = constrainSearchContent({
        items,
        boundedContext: {
          projectIds: null,
          datasourceIds: new Set(['some-other-datasource-luid']),
          workbookIds: null,
        },
      });

      invariant(result.type === 'success');
      expect(result.result).toEqual([items[0]]);
    });

    it('should return success result when some items were filtered out by allowed workbooks in the bounded context', () => {
      const items = reduceSearchContentResponse(mockSearchContentResponse);
      const result = constrainSearchContent({
        items,
        boundedContext: {
          projectIds: null,
          datasourceIds: null,
          workbookIds: new Set(['some-other-workbook-luid']),
        },
      });

      invariant(result.type === 'success');
      expect(result.result).toEqual([items[1]]);
    });
  });
});
