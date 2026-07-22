import { Ok } from 'ts-results-es';

import type { Pagination, PulsePagination } from '../sdks/tableau/types/pagination.js';
import { getPage, paginate, paginateWithMetadata, pulsePaginate } from './paginate.js';

describe('paginate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return data from a single page when no more data is available', async () => {
    const mockData = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const mockPagination: Pagination = {
      pageNumber: 1,
      pageSize: 10,
      totalAvailable: 3,
    };

    const getDataFn = vi.fn().mockResolvedValue({
      pagination: mockPagination,
      data: mockData,
    });

    const result = await paginate({
      pageConfig: { pageSize: 10, pageNumber: 1 },
      getDataFn,
    });

    expect(result).toEqual(mockData);
    expect(getDataFn).toHaveBeenCalledTimes(1);
    expect(getDataFn).toHaveBeenCalledWith({ pageSize: 10, pageNumber: 1 });
  });

  it('should paginate through multiple pages when more data is available', async () => {
    const page1Data = [{ id: 1 }, { id: 2 }];
    const page2Data = [{ id: 3 }, { id: 4 }];
    const page3Data = [{ id: 5 }];

    const getDataFn = vi
      .fn()
      .mockResolvedValueOnce({
        pagination: { pageNumber: 1, pageSize: 2, totalAvailable: 5 },
        data: page1Data,
      })
      .mockResolvedValueOnce({
        pagination: { pageNumber: 2, pageSize: 2, totalAvailable: 5 },
        data: page2Data,
      })
      .mockResolvedValueOnce({
        pagination: { pageNumber: 3, pageSize: 2, totalAvailable: 5 },
        data: page3Data,
      });

    const result = await paginate({
      pageConfig: { pageSize: 2, pageNumber: 1 },
      getDataFn,
    });

    expect(result).toEqual([...page1Data, ...page2Data, ...page3Data]);
    expect(getDataFn).toHaveBeenCalledTimes(3);
    expect(getDataFn).toHaveBeenNthCalledWith(1, { pageSize: 2, pageNumber: 1 });
    expect(getDataFn).toHaveBeenNthCalledWith(2, { pageSize: 2, pageNumber: 2 });
    expect(getDataFn).toHaveBeenNthCalledWith(3, { pageSize: 2, pageNumber: 3 });
  });

  it('should respect the limit parameter and stop paginating when limit is reached', async () => {
    const page1Data = [{ id: 1 }, { id: 2 }];
    const page2Data = [{ id: 3 }, { id: 4 }];

    const getDataFn = vi
      .fn()
      .mockResolvedValueOnce({
        pagination: { pageNumber: 1, pageSize: 2, totalAvailable: 4 },
        data: page1Data,
      })
      .mockResolvedValueOnce({
        pagination: { pageNumber: 2, pageSize: 2, totalAvailable: 4 },
        data: page2Data,
      });

    const result = await paginate({
      pageConfig: { pageSize: 2, pageNumber: 1, limit: 3 },
      getDataFn,
    });

    expect(result).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(result).toHaveLength(3);
    expect(getDataFn).toHaveBeenCalledTimes(2);
  });

  it('should throw an error when no more data is available during pagination', async () => {
    const page1Data = [{ id: 1 }, { id: 2 }];

    const getDataFn = vi
      .fn()
      .mockResolvedValueOnce({
        pagination: { pageNumber: 1, pageSize: 2, totalAvailable: 10 },
        data: page1Data,
      })
      .mockResolvedValueOnce({
        pagination: { pageNumber: 2, pageSize: 2, totalAvailable: 10 },
        data: [], // No more data
      });

    await expect(
      paginate({
        pageConfig: { pageSize: 2, pageNumber: 1 },
        getDataFn,
      }),
    ).rejects.toThrow(
      'No more data available. Last fetched page number: 1, Total available: 10, Total fetched: 2',
    );

    expect(getDataFn).toHaveBeenCalledTimes(2);
  });

  it('should handle empty pageConfig (all optional fields)', async () => {
    const mockData = [{ id: 1 }];
    const mockPagination: Pagination = {
      pageNumber: 1,
      pageSize: 10,
      totalAvailable: 1,
    };

    const getDataFn = vi.fn().mockResolvedValue({
      pagination: mockPagination,
      data: mockData,
    });

    const result = await paginate({
      pageConfig: {},
      getDataFn,
    });

    expect(result).toEqual(mockData);
    expect(getDataFn).toHaveBeenCalledWith({});
  });

  it('should validate pageConfig and throw error for invalid values', async () => {
    const getDataFn = vi.fn();

    // Test with invalid pageSize (0)
    await expect(
      paginate({
        pageConfig: { pageSize: 0, pageNumber: 1 },
        getDataFn,
      }),
    ).rejects.toThrow('Number must be greater than 0');

    // Test with invalid pageNumber (0)
    await expect(
      paginate({
        pageConfig: { pageSize: 10, pageNumber: 0 },
        getDataFn,
      }),
    ).rejects.toThrow('Number must be greater than 0');

    // Test with invalid limit (0)
    await expect(
      paginate({
        pageConfig: { pageSize: 10, pageNumber: 1, limit: 0 },
        getDataFn,
      }),
    ).rejects.toThrow('Number must be greater than 0');

    // Test with negative values
    await expect(
      paginate({
        pageConfig: { pageSize: -1, pageNumber: 1 },
        getDataFn,
      }),
    ).rejects.toThrow('Number must be greater than 0');

    expect(getDataFn).not.toHaveBeenCalled();
  });

  it('should clamp pageSize to 1000 when a larger value is provided', async () => {
    const mockData = [{ id: 1 }];
    const mockPagination: Pagination = {
      pageNumber: 1,
      pageSize: 1000,
      totalAvailable: 1,
    };

    const getDataFn = vi.fn().mockResolvedValue({
      pagination: mockPagination,
      data: mockData,
    });

    const result = await paginate({
      pageConfig: { pageSize: 5000, pageNumber: 1 },
      getDataFn,
    });

    expect(result).toEqual(mockData);
    expect(getDataFn).toHaveBeenCalledWith({ pageSize: 1000, pageNumber: 1 });
  });

  it('should not clamp pageSize when it is at or below 1000', async () => {
    const mockData = [{ id: 1 }];
    const mockPagination: Pagination = {
      pageNumber: 1,
      pageSize: 500,
      totalAvailable: 1,
    };

    const getDataFn = vi.fn().mockResolvedValue({
      pagination: mockPagination,
      data: mockData,
    });

    const result = await paginate({
      pageConfig: { pageSize: 500, pageNumber: 1 },
      getDataFn,
    });

    expect(result).toEqual(mockData);
    expect(getDataFn).toHaveBeenCalledWith({ pageSize: 500, pageNumber: 1 });
  });

  it('should handle case where totalAvailable equals data length after first page', async () => {
    const mockData = [{ id: 1 }, { id: 2 }];
    const mockPagination: Pagination = {
      pageNumber: 1,
      pageSize: 2,
      totalAvailable: 2,
    };

    const getDataFn = vi.fn().mockResolvedValue({
      pagination: mockPagination,
      data: mockData,
    });

    const result = await paginate({
      pageConfig: { pageSize: 2, pageNumber: 1 },
      getDataFn,
    });

    expect(result).toEqual(mockData);
    expect(getDataFn).toHaveBeenCalledTimes(1);
  });

  it('should handle case where limit is exactly equal to data length', async () => {
    const page1Data = [{ id: 1 }, { id: 2 }];
    const page2Data = [{ id: 3 }, { id: 4 }];

    const getDataFn = vi
      .fn()
      .mockResolvedValueOnce({
        pagination: { pageNumber: 1, pageSize: 2, totalAvailable: 4 },
        data: page1Data,
      })
      .mockResolvedValueOnce({
        pagination: { pageNumber: 2, pageSize: 2, totalAvailable: 4 },
        data: page2Data,
      });

    const result = await paginate({
      pageConfig: { pageSize: 2, pageNumber: 1, limit: 4 },
      getDataFn,
    });

    expect(result).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
    expect(result).toHaveLength(4);
    expect(getDataFn).toHaveBeenCalledTimes(2);
  });

  it('should handle case where limit is greater than total available data', async () => {
    const mockData = [{ id: 1 }, { id: 2 }];
    const mockPagination: Pagination = {
      pageNumber: 1,
      pageSize: 2,
      totalAvailable: 2,
    };

    const getDataFn = vi.fn().mockResolvedValue({
      pagination: mockPagination,
      data: mockData,
    });

    const result = await paginate({
      pageConfig: { pageSize: 2, pageNumber: 1, limit: 10 },
      getDataFn,
    });

    expect(result).toEqual(mockData);
    expect(result).toHaveLength(2);
    expect(getDataFn).toHaveBeenCalledTimes(1);
  });

  it('should handle complex pagination with multiple pages and limit', async () => {
    const page1Data = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const page2Data = [{ id: 4 }, { id: 5 }, { id: 6 }];
    const page3Data = [{ id: 7 }, { id: 8 }, { id: 9 }];

    const getDataFn = vi
      .fn()
      .mockResolvedValueOnce({
        pagination: { pageNumber: 1, pageSize: 3, totalAvailable: 9 },
        data: page1Data,
      })
      .mockResolvedValueOnce({
        pagination: { pageNumber: 2, pageSize: 3, totalAvailable: 9 },
        data: page2Data,
      })
      .mockResolvedValueOnce({
        pagination: { pageNumber: 3, pageSize: 3, totalAvailable: 9 },
        data: page3Data,
      });

    const result = await paginate({
      pageConfig: { pageSize: 3, pageNumber: 1, limit: 7 },
      getDataFn,
    });

    expect(result).toEqual([
      { id: 1 },
      { id: 2 },
      { id: 3 },
      { id: 4 },
      { id: 5 },
      { id: 6 },
      { id: 7 },
    ]);
    expect(result).toHaveLength(7);
    expect(getDataFn).toHaveBeenCalledTimes(3);
  });
});

// ----------------------------------------------------------------------------
// paginateWithMetadata — exposes totalAvailable + truncatedByLimit
// ----------------------------------------------------------------------------
// Existing callers using `paginate` only get an array of items back; that
// shape can't distinguish "you got everything" from "a configured limit cut
// you off and more exist server-side". `paginateWithMetadata` surfaces both
// `totalAvailable` and `truncatedByLimit` so callers can emit a structured
// truncation signal (e.g. `list-flows`' `mcp.resultInfo.truncated` /
// `truncationReason`) when the user's request was silently capped.
describe('paginateWithMetadata', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns truncatedByLimit=false and the full set when no limit is set', async () => {
    const data = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const getDataFn = vi.fn().mockResolvedValue({
      pagination: { pageNumber: 1, pageSize: 10, totalAvailable: 3 },
      data,
    });

    const result = await paginateWithMetadata({
      pageConfig: { pageSize: 10, pageNumber: 1 },
      getDataFn,
    });

    expect(result).toEqual({ items: data, totalAvailable: 3, truncatedByLimit: false });
  });

  it('returns truncatedByLimit=true when the limit cuts off available items', async () => {
    // Single-page query where Tableau says totalAvailable=10 but the limit
    // only lets us return 5: that's the canonical admin-cap-style trim.
    const data = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];
    const getDataFn = vi.fn().mockResolvedValue({
      pagination: { pageNumber: 1, pageSize: 5, totalAvailable: 10 },
      data,
    });

    const result = await paginateWithMetadata({
      pageConfig: { pageSize: 5, pageNumber: 1, limit: 5 },
      getDataFn,
    });

    expect(result).toEqual({ items: data, totalAvailable: 10, truncatedByLimit: true });
  });

  it('returns truncatedByLimit=true after multi-page pagination is cut by limit mid-page', async () => {
    // Limit of 3 across pages of size 2: page 1 fetches 2, page 2 fetches 2,
    // post-loop slice trims to 3. totalAvailable is 4, so result is truncated.
    const getDataFn = vi
      .fn()
      .mockResolvedValueOnce({
        pagination: { pageNumber: 1, pageSize: 2, totalAvailable: 4 },
        data: [{ id: 1 }, { id: 2 }],
      })
      .mockResolvedValueOnce({
        pagination: { pageNumber: 2, pageSize: 2, totalAvailable: 4 },
        data: [{ id: 3 }, { id: 4 }],
      });

    const result = await paginateWithMetadata({
      pageConfig: { pageSize: 2, pageNumber: 1, limit: 3 },
      getDataFn,
    });

    expect(result).toEqual({
      items: [{ id: 1 }, { id: 2 }, { id: 3 }],
      totalAvailable: 4,
      truncatedByLimit: true,
    });
  });

  it('returns truncatedByLimit=false when limit equals totalAvailable exactly (regression guard)', async () => {
    // Boundary case: passing `limit: 4` with totalAvailable=4 must NOT be
    // misreported as truncated. truncatedByLimit is strictly "more exists".
    const getDataFn = vi
      .fn()
      .mockResolvedValueOnce({
        pagination: { pageNumber: 1, pageSize: 2, totalAvailable: 4 },
        data: [{ id: 1 }, { id: 2 }],
      })
      .mockResolvedValueOnce({
        pagination: { pageNumber: 2, pageSize: 2, totalAvailable: 4 },
        data: [{ id: 3 }, { id: 4 }],
      });

    const result = await paginateWithMetadata({
      pageConfig: { pageSize: 2, pageNumber: 1, limit: 4 },
      getDataFn,
    });

    expect(result.truncatedByLimit).toBe(false);
    expect(result.totalAvailable).toBe(4);
    expect(result.items).toHaveLength(4);
  });

  it('returns truncatedByLimit=false when limit > totalAvailable', async () => {
    const data = [{ id: 1 }, { id: 2 }];
    const getDataFn = vi.fn().mockResolvedValue({
      pagination: { pageNumber: 1, pageSize: 10, totalAvailable: 2 },
      data,
    });

    const result = await paginateWithMetadata({
      pageConfig: { pageSize: 10, pageNumber: 1, limit: 100 },
      getDataFn,
    });

    expect(result).toEqual({ items: data, totalAvailable: 2, truncatedByLimit: false });
  });
});

describe('paginate (delegates to paginateWithMetadata)', () => {
  // Regression guard: paginate is now a thin wrapper over paginateWithMetadata.
  // Make sure it still behaves identically to its prior contract — items only.
  it('returns just the items array (matches existing public contract)', async () => {
    const data = [{ id: 1 }, { id: 2 }];
    const getDataFn = vi.fn().mockResolvedValue({
      pagination: { pageNumber: 1, pageSize: 10, totalAvailable: 2 },
      data,
    });

    const result = await paginate({
      pageConfig: { pageSize: 10, pageNumber: 1 },
      getDataFn,
    });

    expect(result).toEqual(data);
    expect(Array.isArray(result)).toBe(true);
  });
});

// ----------------------------------------------------------------------------
// getPage — single-page fetch with a global offset ceiling
// ----------------------------------------------------------------------------
// Unlike `paginate`, `getPage` fetches exactly ONE page (no loop). It
// always requests a full MAX_PAGE_SIZE page so absolute offsets stay stable,
// then applies an optional global `maxResultLimit` offset ceiling and an
// optional per-page `limit` trim. `totalAvailable` is capped to
// `maxResultLimit` so it reflects the number of items actually reachable.
describe('getPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults pageNumber to 1 and requests a full page', async () => {
    const data = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const getDataFn = vi.fn().mockResolvedValue({
      pagination: { pageNumber: 1, pageSize: 1000, totalAvailable: 3 },
      data,
    });

    const result = await getPage({ getDataFn });

    expect(result).toEqual({
      data,
      totalAvailable: 3,
    });
    expect(getDataFn).toHaveBeenCalledTimes(1);
    expect(getDataFn).toHaveBeenCalledWith({ pageSize: 1000, pageNumber: 1 });
  });

  it('passes the explicit pageNumber to getDataFn with pageSize=1000', async () => {
    const data = [{ id: 42 }];
    const getDataFn = vi.fn().mockResolvedValue({
      pagination: { pageNumber: 5, pageSize: 1000, totalAvailable: 4001 },
      data,
    });

    await getPage({ pageNumber: 5, getDataFn });

    expect(getDataFn).toHaveBeenCalledTimes(1);
    expect(getDataFn).toHaveBeenCalledWith({ pageSize: 1000, pageNumber: 5 });
  });

  it('calls getDataFn exactly once (never loops even when more pages exist)', async () => {
    // totalAvailable (5000) far exceeds this page's data, but getPage must
    // NOT loop to fetch the rest — it returns only the single requested page.
    const data = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
    const getDataFn = vi.fn().mockResolvedValue({
      pagination: { pageNumber: 1, pageSize: 1000, totalAvailable: 5000 },
      data,
    });

    const result = await getPage({ pageNumber: 1, getDataFn });

    expect(getDataFn).toHaveBeenCalledTimes(1);
    expect(result.data).toHaveLength(1000);
    expect(result.totalAvailable).toBe(5000);
  });

  it('trims within a page via limit without capping totalAvailable', async () => {
    // A per-page `limit` is a caller-side trim, not a server cap, so it must
    // not affect the reported `totalAvailable`.
    const data = Array.from({ length: 100 }, (_, i) => ({ id: i }));
    const getDataFn = vi.fn().mockResolvedValue({
      pagination: { pageNumber: 1, pageSize: 1000, totalAvailable: 100 },
      data,
    });

    const result = await getPage({ limit: 10, getDataFn });

    expect(result.data).toHaveLength(10);
    expect(result.data).toEqual(data.slice(0, 10));
    expect(result.totalAvailable).toBe(100);
  });

  describe('maxResultLimit=8700 offset ceiling', () => {
    const maxResultLimit = 8700;

    it('page 8 returns a full 1000 items and caps totalAvailable to 8700 (offset 7000..7999)', async () => {
      const data = Array.from({ length: 1000 }, (_, i) => ({ id: 7000 + i }));
      const getDataFn = vi.fn().mockResolvedValue({
        pagination: { pageNumber: 8, pageSize: 1000, totalAvailable: 10000 },
        data,
      });

      const result = await getPage({ pageNumber: 8, maxResultLimit, getDataFn });

      expect(result.data).toHaveLength(1000);
      expect(result.totalAvailable).toBe(8700);
    });

    it('page 9 is trimmed to 700 items and caps totalAvailable to 8700 (offset 8000, cap at 8700)', async () => {
      const data = Array.from({ length: 1000 }, (_, i) => ({ id: 8000 + i }));
      const getDataFn = vi.fn().mockResolvedValue({
        pagination: { pageNumber: 9, pageSize: 1000, totalAvailable: 10000 },
        data,
      });

      const result = await getPage({ pageNumber: 9, maxResultLimit, getDataFn });

      expect(result.data).toHaveLength(700);
      expect(result.data).toEqual(data.slice(0, 700));
      expect(result.totalAvailable).toBe(8700);
    });

    it('page 10 is trimmed to 0 items and caps totalAvailable to 8700 (offset 9000, past the cap)', async () => {
      const data = Array.from({ length: 1000 }, (_, i) => ({ id: 9000 + i }));
      const getDataFn = vi.fn().mockResolvedValue({
        pagination: { pageNumber: 10, pageSize: 1000, totalAvailable: 10000 },
        data,
      });

      const result = await getPage({ pageNumber: 10, maxResultLimit, getDataFn });

      expect(result.data).toHaveLength(0);
      expect(result.totalAvailable).toBe(8700);
    });
  });

  it('with maxResultLimit null, totalAvailable equals the raw server total', async () => {
    const data = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
    const getDataFn = vi.fn().mockResolvedValue({
      pagination: { pageNumber: 1, pageSize: 1000, totalAvailable: 5000 },
      data,
    });

    const result = await getPage({ pageNumber: 1, maxResultLimit: null, getDataFn });

    expect(result.totalAvailable).toBe(5000);
    expect(result.data).toHaveLength(1000);
  });

  it('does NOT cap totalAvailable below the raw total for a naturally short final page', async () => {
    // Final page of a data set: fewer than 1000 items because the data ran out,
    // NOT because a server cap trimmed it. maxResultLimit (10000) exceeds the
    // raw total, so totalAvailable stays at the raw total.
    const data = Array.from({ length: 250 }, (_, i) => ({ id: 4000 + i }));
    const getDataFn = vi.fn().mockResolvedValue({
      pagination: { pageNumber: 5, pageSize: 1000, totalAvailable: 4250 },
      data,
    });

    const result = await getPage({ pageNumber: 5, maxResultLimit: 10000, getDataFn });

    expect(result.data).toHaveLength(250);
    expect(result.totalAvailable).toBe(4250);
  });

  it('validates pageNumber and limit (> 0, limit <= MAX_PAGE_SIZE) before calling getDataFn', async () => {
    const getDataFn = vi.fn();

    // pageNumber must be > 0
    await expect(getPage({ pageNumber: 0, getDataFn })).rejects.toThrow(
      'Number must be greater than 0',
    );

    // limit must be > 0
    await expect(getPage({ limit: 0, getDataFn })).rejects.toThrow('Number must be greater than 0');

    // limit may not exceed MAX_PAGE_SIZE (1000)
    await expect(getPage({ limit: 1001, getDataFn })).rejects.toThrow(
      'Number must be less than or equal to 1000',
    );

    expect(getDataFn).not.toHaveBeenCalled();
  });
});

describe('pulsePaginate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return data from a single page when no more data is available', async () => {
    const mockData = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const mockPagination: PulsePagination = {
      next_page_token: undefined,
    };

    const getDataFn = vi.fn().mockResolvedValue(
      new Ok({
        pagination: mockPagination,
        data: mockData,
      }),
    );

    const result = await pulsePaginate({
      config: {},
      getDataFn,
    });

    expect(result.unwrap()).toEqual(mockData);
    expect(getDataFn).toHaveBeenCalledTimes(1);
    expect(getDataFn).toHaveBeenCalledWith(undefined, undefined);
  });

  it('should paginate through multiple pages when more data is available', async () => {
    const page1Data = [{ id: 1 }, { id: 2 }];
    const page2Data = [{ id: 3 }, { id: 4 }];
    const page3Data = [{ id: 5 }];

    const getDataFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Ok({
          pagination: { next_page_token: 'token1' },
          data: page1Data,
        }),
      )
      .mockResolvedValueOnce(
        new Ok({
          pagination: { next_page_token: 'token2' },
          data: page2Data,
        }),
      )
      .mockResolvedValueOnce(
        new Ok({
          pagination: { next_page_token: undefined },
          data: page3Data,
        }),
      );

    const result = await pulsePaginate({
      config: {},
      getDataFn,
    });

    expect(result.unwrap()).toEqual([...page1Data, ...page2Data, ...page3Data]);
    expect(getDataFn).toHaveBeenCalledTimes(3);
    expect(getDataFn).toHaveBeenNthCalledWith(1, undefined, undefined);
    expect(getDataFn).toHaveBeenNthCalledWith(2, 'token1', undefined);
    expect(getDataFn).toHaveBeenNthCalledWith(3, 'token2', undefined);
  });

  it('should respect the limit parameter and stop paginating when limit is reached', async () => {
    const page1Data = [{ id: 1 }, { id: 2 }];
    const page2Data = [{ id: 3 }, { id: 4 }];

    const getDataFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Ok({
          pagination: { next_page_token: 'token1' },
          data: page1Data,
        }),
      )
      .mockResolvedValueOnce(
        new Ok({
          pagination: { next_page_token: undefined },
          data: page2Data,
        }),
      );

    const result = await pulsePaginate({
      config: { limit: 3 },
      getDataFn,
    });

    const unwrapped = result.unwrap();
    expect(unwrapped).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(unwrapped).toHaveLength(3);
    expect(getDataFn).toHaveBeenCalledTimes(2);
  });

  it('should throw an error when no more data is available during pagination', async () => {
    const page1Data = [{ id: 1 }, { id: 2 }];

    const getDataFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Ok({
          pagination: { next_page_token: 'token1' },
          data: page1Data,
        }),
      )
      .mockResolvedValueOnce(
        new Ok({
          pagination: { next_page_token: 'token2' },
          data: [], // No more data
        }),
      );

    await expect(
      pulsePaginate({
        config: {},
        getDataFn,
      }),
    ).rejects.toThrow('No more data available. Total fetched: 2');

    expect(getDataFn).toHaveBeenCalledTimes(2);
  });

  it('should validate config and throw error for invalid limit value', async () => {
    const getDataFn = vi.fn();

    // Test with invalid limit (0)
    await expect(
      pulsePaginate({
        config: { limit: 0 },
        getDataFn,
      }),
    ).rejects.toThrow('Number must be greater than 0');

    // Test with negative limit
    await expect(
      pulsePaginate({
        config: { limit: -1 },
        getDataFn,
      }),
    ).rejects.toThrow('Number must be greater than 0');

    expect(getDataFn).not.toHaveBeenCalled();
  });

  it('should handle case where limit is exactly equal to data length', async () => {
    const page1Data = [{ id: 1 }, { id: 2 }];
    const page2Data = [{ id: 3 }, { id: 4 }];

    const getDataFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Ok({
          pagination: { next_page_token: 'token1' },
          data: page1Data,
        }),
      )
      .mockResolvedValueOnce(
        new Ok({
          pagination: { next_page_token: undefined },
          data: page2Data,
        }),
      );

    const result = await pulsePaginate({
      config: { limit: 4 },
      getDataFn,
    });

    const unwrapped = result.unwrap();
    expect(unwrapped).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]);
    expect(unwrapped).toHaveLength(4);
    expect(getDataFn).toHaveBeenCalledTimes(2);
  });

  it('should handle case where limit is greater than total available data', async () => {
    const mockData = [{ id: 1 }, { id: 2 }];
    const mockPagination: PulsePagination = {
      next_page_token: undefined,
    };

    const getDataFn = vi.fn().mockResolvedValue(
      new Ok({
        pagination: mockPagination,
        data: mockData,
      }),
    );

    const result = await pulsePaginate({
      config: { limit: 10 },
      getDataFn,
    });

    const unwrapped = result.unwrap();
    expect(unwrapped).toEqual(mockData);
    expect(unwrapped).toHaveLength(2);
    expect(getDataFn).toHaveBeenCalledTimes(1);
  });

  it('should handle complex pagination with multiple pages and limit', async () => {
    const page1Data = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const page2Data = [{ id: 4 }, { id: 5 }, { id: 6 }];
    const page3Data = [{ id: 7 }, { id: 8 }, { id: 9 }];

    const getDataFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Ok({
          pagination: { next_page_token: 'token1' },
          data: page1Data,
        }),
      )
      .mockResolvedValueOnce(
        new Ok({
          pagination: { next_page_token: 'token2' },
          data: page2Data,
        }),
      )
      .mockResolvedValueOnce(
        new Ok({
          pagination: { next_page_token: undefined },
          data: page3Data,
        }),
      );

    const result = await pulsePaginate({
      config: { limit: 7 },
      getDataFn,
    });

    const unwrapped = result.unwrap();
    expect(unwrapped).toEqual([
      { id: 1 },
      { id: 2 },
      { id: 3 },
      { id: 4 },
      { id: 5 },
      { id: 6 },
      { id: 7 },
    ]);
    expect(unwrapped).toHaveLength(7);
    expect(getDataFn).toHaveBeenCalledTimes(3);
  });

  it('should handle undefined config', async () => {
    const mockData = [{ id: 1 }];
    const mockPagination: PulsePagination = {
      next_page_token: undefined,
    };

    const getDataFn = vi.fn().mockResolvedValue(
      new Ok({
        pagination: mockPagination,
        data: mockData,
      }),
    );

    const result = await pulsePaginate({
      config: undefined,
      getDataFn,
    });

    expect(result.unwrap()).toEqual(mockData);
    expect(getDataFn).toHaveBeenCalledWith(undefined, undefined);
  });

  it('should pass pageSize parameter to getDataFn when specified', async () => {
    const mockData = [{ id: 1 }, { id: 2 }];
    const mockPagination: PulsePagination = {
      next_page_token: undefined,
    };

    const getDataFn = vi.fn().mockResolvedValue(
      new Ok({
        pagination: mockPagination,
        data: mockData,
      }),
    );

    const result = await pulsePaginate({
      config: { pageSize: 50 },
      getDataFn,
    });

    expect(result.unwrap()).toEqual(mockData);
    expect(getDataFn).toHaveBeenCalledTimes(1);
    expect(getDataFn).toHaveBeenCalledWith(undefined, 50);
  });

  it('should pass pageSize parameter through pagination', async () => {
    const page1Data = [{ id: 1 }, { id: 2 }];
    const page2Data = [{ id: 3 }, { id: 4 }];

    const getDataFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Ok({
          pagination: { next_page_token: 'token1' },
          data: page1Data,
        }),
      )
      .mockResolvedValueOnce(
        new Ok({
          pagination: { next_page_token: undefined },
          data: page2Data,
        }),
      );

    const result = await pulsePaginate({
      config: { pageSize: 100 },
      getDataFn,
    });

    expect(result.unwrap()).toEqual([...page1Data, ...page2Data]);
    expect(getDataFn).toHaveBeenCalledTimes(2);
    expect(getDataFn).toHaveBeenNthCalledWith(1, undefined, 100);
    expect(getDataFn).toHaveBeenNthCalledWith(2, 'token1', 100);
  });

  it('should use smart pageSize with limit applied', async () => {
    // Simulate: First call returns 2 items, but total_available is 10
    // With limit of 5, smart pageSize should be min(10 - 2, 5 - 2) = 3
    const page1Data = [{ id: 1 }, { id: 2 }];
    const page2Data = [{ id: 3 }, { id: 4 }, { id: 5 }];

    const getDataFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Ok({
          pagination: {
            next_page_token: 'token1',
            total_available: 10,
          },
          data: page1Data,
        }),
      )
      .mockResolvedValueOnce(
        new Ok({
          pagination: {
            next_page_token: undefined,
            total_available: 10,
          },
          data: page2Data,
        }),
      );

    const result = await pulsePaginate({
      config: { limit: 5 },
      getDataFn,
    });

    expect(result.unwrap()).toEqual([...page1Data, ...page2Data]);
    expect(getDataFn).toHaveBeenCalledTimes(2);
    // First call: no pageSize specified (uses API default)
    expect(getDataFn).toHaveBeenNthCalledWith(1, undefined, undefined);
    // Second call: smart pageSize = min(10 - 2, 5 - 2) = 3
    expect(getDataFn).toHaveBeenNthCalledWith(2, 'token1', 3);
  });

  it('should use smart pageSize when no limit specified', async () => {
    // With no limit, smart pageSize should be total_available - already_fetched
    const page1Data = [{ id: 1 }, { id: 2 }];
    const page2Data = [{ id: 3 }, { id: 4 }, { id: 5 }];

    const getDataFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Ok({
          pagination: {
            next_page_token: 'token1',
            total_available: 5,
          },
          data: page1Data,
        }),
      )
      .mockResolvedValueOnce(
        new Ok({
          pagination: {
            next_page_token: undefined,
            total_available: 5,
          },
          data: page2Data,
        }),
      );

    const result = await pulsePaginate({
      config: {},
      getDataFn,
    });

    expect(result.unwrap()).toEqual([...page1Data, ...page2Data]);
    expect(getDataFn).toHaveBeenCalledTimes(2);
    // First call: no pageSize specified
    expect(getDataFn).toHaveBeenNthCalledWith(1, undefined, undefined);
    // Second call: smart pageSize = 5 - 2 = 3
    expect(getDataFn).toHaveBeenNthCalledWith(2, 'token1', 3);
  });
});
