import { Ok } from 'ts-results-es';

import type { Pagination, PulsePagination } from '../sdks/tableau/types/pagination.js';
import { paginate, pulsePaginate } from './paginate.js';

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
