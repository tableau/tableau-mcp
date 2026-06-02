import { describe, expect, it, vi } from 'vitest';

import UsersMethods from './usersMethods.js';

describe('UsersMethods', () => {
  describe('listUsers', () => {
    it('should return users and pagination from response', async () => {
      const mockApiClient = {
        listUsers: vi.fn().mockResolvedValue({
          pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 27000 },
          users: {
            user: [
              { id: 'u1', name: 'jsmith', siteRole: 'Creator' },
              { id: 'u2', name: 'asmith', siteRole: 'Viewer' },
            ],
          },
        }),
      };

      const usersMethods = new UsersMethods('http://test', { type: 'Bearer', token: 'test' }, {});
      // @ts-expect-error - Mocking private property
      usersMethods._apiClient = mockApiClient;

      const result = await usersMethods.listUsers({ siteId: 'site-1' });

      expect(result.users).toEqual([
        { id: 'u1', name: 'jsmith', siteRole: 'Creator' },
        { id: 'u2', name: 'asmith', siteRole: 'Viewer' },
      ]);
      expect(result.pagination).toEqual({
        pageNumber: 1,
        pageSize: 100,
        totalAvailable: 27000,
      });
    });

    it('should handle response without pagination', async () => {
      const mockApiClient = {
        listUsers: vi.fn().mockResolvedValue({
          users: {
            user: [
              { id: 'u1', name: 'jsmith', siteRole: 'Creator' },
              { id: 'u2', name: 'asmith', siteRole: 'Viewer' },
            ],
          },
        }),
      };

      const usersMethods = new UsersMethods('http://test', { type: 'Bearer', token: 'test' }, {});
      // @ts-expect-error - Mocking private property
      usersMethods._apiClient = mockApiClient;

      const result = await usersMethods.listUsers({ siteId: 'site-1' });

      expect(result.users).toEqual([
        { id: 'u1', name: 'jsmith', siteRole: 'Creator' },
        { id: 'u2', name: 'asmith', siteRole: 'Viewer' },
      ]);
      expect(result.pagination).toBeUndefined();
    });

    it('should return single user from normalized response', async () => {
      const mockApiClient = {
        listUsers: vi.fn().mockResolvedValue({
          users: {
            user: [{ id: 'u1', name: 'jsmith', siteRole: 'Creator' }],
          },
        }),
      };

      const usersMethods = new UsersMethods('http://test', { type: 'Bearer', token: 'test' }, {});
      // @ts-expect-error - Mocking private property
      usersMethods._apiClient = mockApiClient;

      const result = await usersMethods.listUsers({ siteId: 'site-1' });

      expect(result.users).toEqual([{ id: 'u1', name: 'jsmith', siteRole: 'Creator' }]);
    });

    it('should return empty array when no users exist', async () => {
      const mockApiClient = {
        listUsers: vi.fn().mockResolvedValue({
          users: {
            user: [],
          },
        }),
      };

      const usersMethods = new UsersMethods('http://test', { type: 'Bearer', token: 'test' }, {});
      // @ts-expect-error - Mocking private property
      usersMethods._apiClient = mockApiClient;

      const result = await usersMethods.listUsers({ siteId: 'site-1' });

      expect(result.users).toEqual([]);
    });

    it('should handle users with full profile information', async () => {
      const mockApiClient = {
        listUsers: vi.fn().mockResolvedValue({
          pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 1 },
          users: {
            user: [
              {
                id: 'u1',
                name: 'jsmith',
                siteRole: 'Creator',
                email: 'john.smith@example.com',
                fullName: 'John Smith',
                lastLogin: '2026-05-20T10:30:00Z',
                authSetting: 'SAML',
                locale: 'en_US',
                language: 'en',
              },
            ],
          },
        }),
      };

      const usersMethods = new UsersMethods('http://test', { type: 'Bearer', token: 'test' }, {});
      // @ts-expect-error - Mocking private property
      usersMethods._apiClient = mockApiClient;

      const result = await usersMethods.listUsers({ siteId: 'site-1' });

      expect(result.users[0]).toEqual({
        id: 'u1',
        name: 'jsmith',
        siteRole: 'Creator',
        email: 'john.smith@example.com',
        fullName: 'John Smith',
        lastLogin: '2026-05-20T10:30:00Z',
        authSetting: 'SAML',
        locale: 'en_US',
        language: 'en',
      });
    });

    it('should handle users with different site roles', async () => {
      const mockApiClient = {
        listUsers: vi.fn().mockResolvedValue({
          pagination: { pageNumber: 1, pageSize: 100, totalAvailable: 5 },
          users: {
            user: [
              { id: 'u1', name: 'admin', siteRole: 'ServerAdministrator' },
              { id: 'u2', name: 'creator', siteRole: 'Creator' },
              { id: 'u3', name: 'explorer', siteRole: 'Explorer' },
              { id: 'u4', name: 'viewer', siteRole: 'Viewer' },
              { id: 'u5', name: 'inactive', siteRole: 'Unlicensed' },
            ],
          },
        }),
      };

      const usersMethods = new UsersMethods('http://test', { type: 'Bearer', token: 'test' }, {});
      // @ts-expect-error - Mocking private property
      usersMethods._apiClient = mockApiClient;

      const result = await usersMethods.listUsers({ siteId: 'site-1' });

      expect(result.users).toHaveLength(5);
      expect(result.users[0].siteRole).toBe('ServerAdministrator');
      expect(result.users[4].siteRole).toBe('Unlicensed');
      expect(result.pagination?.totalAvailable).toBe(5);
    });
  });
});
