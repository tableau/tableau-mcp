import type { Pagination } from '../sdks/tableau/types/pagination.js';
import { paginate } from './paginate.js';

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
