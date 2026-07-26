import { describe, expect, it } from 'vitest';

import { User } from '../../../sdks/tableau/types/user.js';
import {
  applyUserFilters,
  exportedForTesting,
  parseAndValidateUsersFilterString,
} from './usersFilterUtils.js';

const { getFieldValue, matchesFilter } = exportedForTesting;

const mockUser: User = {
  id: 'user-123',
  name: 'jsmith',
  siteRole: 'Creator',
  email: 'john.smith@example.com',
  fullName: 'John Smith',
  lastLogin: '2026-05-20T10:30:00Z',
  authSetting: 'SAML',
  locale: 'en_US',
  language: 'en',
};

describe('usersFilterUtils', () => {
  describe('parseAndValidateUsersFilterString', () => {
    it('should parse valid filter string', () => {
      const result = parseAndValidateUsersFilterString('id:eq:user-123');
      expect(result).toBe('id:eq:user-123');
    });

    it('should parse multiple filters', () => {
      const result = parseAndValidateUsersFilterString(
        'siteRole:eq:Creator,email:eq:test@example.com',
      );
      expect(result).toBe('siteRole:eq:Creator,email:eq:test@example.com');
    });

    it('should throw on invalid field', () => {
      expect(() => parseAndValidateUsersFilterString('invalidField:eq:value')).toThrow();
    });

    it('should throw on invalid operator for field', () => {
      expect(() => parseAndValidateUsersFilterString('id:gt:123')).toThrow();
    });
  });

  describe('getFieldValue', () => {
    it('should get top-level fields', () => {
      expect(getFieldValue(mockUser, 'id')).toBe('user-123');
      expect(getFieldValue(mockUser, 'name')).toBe('jsmith');
      expect(getFieldValue(mockUser, 'siteRole')).toBe('Creator');
    });

    it('should get user profile fields', () => {
      expect(getFieldValue(mockUser, 'email')).toBe('john.smith@example.com');
      expect(getFieldValue(mockUser, 'fullName')).toBe('John Smith');
      expect(getFieldValue(mockUser, 'lastLogin')).toBe('2026-05-20T10:30:00Z');
    });

    it('should return undefined for missing optional fields', () => {
      const minimalUser: User = { id: 'user-456', name: 'test' };
      expect(getFieldValue(minimalUser, 'email')).toBeUndefined();
      expect(getFieldValue(minimalUser, 'siteRole')).toBeUndefined();
    });
  });

  describe('matchesFilter', () => {
    describe('eq operator', () => {
      it('should match equal strings', () => {
        expect(matchesFilter('Creator', 'eq', 'Creator', 'siteRole')).toBe(true);
      });

      it('should not match different strings', () => {
        expect(matchesFilter('Creator', 'eq', 'Viewer', 'siteRole')).toBe(false);
      });
    });

    describe('in operator', () => {
      it('should match value in pipe-separated list', () => {
        expect(matchesFilter('Creator', 'in', 'Creator|Explorer|Viewer', 'siteRole')).toBe(true);
      });

      it('should not match value not in list', () => {
        expect(
          matchesFilter('ServerAdministrator', 'in', 'Creator|Explorer|Viewer', 'siteRole'),
        ).toBe(false);
      });
    });

    describe('comparison operators (date fields)', () => {
      it('should compare dates with lt', () => {
        expect(
          matchesFilter('2026-05-20T00:00:00Z', 'lt', '2026-05-25T00:00:00Z', 'lastLogin'),
        ).toBe(true);
        expect(
          matchesFilter('2026-05-30T00:00:00Z', 'lt', '2026-05-25T00:00:00Z', 'lastLogin'),
        ).toBe(false);
      });

      it('should compare dates with gt', () => {
        expect(
          matchesFilter('2026-05-30T00:00:00Z', 'gt', '2026-05-25T00:00:00Z', 'lastLogin'),
        ).toBe(true);
        expect(
          matchesFilter('2026-05-20T00:00:00Z', 'gt', '2026-05-25T00:00:00Z', 'lastLogin'),
        ).toBe(false);
        expect(
          matchesFilter('2026-05-25T00:00:00Z', 'gt', '2026-05-25T00:00:00Z', 'lastLogin'),
        ).toBe(false);
      });

      it('should compare dates with gte', () => {
        expect(
          matchesFilter('2026-05-25T00:00:00Z', 'gte', '2026-05-25T00:00:00Z', 'lastLogin'),
        ).toBe(true);
        expect(
          matchesFilter('2026-05-24T00:00:00Z', 'gte', '2026-05-25T00:00:00Z', 'lastLogin'),
        ).toBe(false);
      });

      it('should compare dates with lte', () => {
        expect(
          matchesFilter('2026-05-25T00:00:00Z', 'lte', '2026-05-25T00:00:00Z', 'lastLogin'),
        ).toBe(true);
        expect(
          matchesFilter('2026-05-26T00:00:00Z', 'lte', '2026-05-25T00:00:00Z', 'lastLogin'),
        ).toBe(false);
      });

      it('should handle fractional seconds in ISO 8601 dates', () => {
        expect(
          matchesFilter('2026-05-25T00:00:00.000Z', 'eq', '2026-05-25T00:00:00Z', 'lastLogin'),
        ).toBe(true);
        expect(
          matchesFilter('2026-05-25T00:00:00.500Z', 'gt', '2026-05-25T00:00:00Z', 'lastLogin'),
        ).toBe(true);
      });

      it('should handle timezone offsets in ISO 8601 dates', () => {
        expect(
          matchesFilter('2026-05-25T05:00:00+05:00', 'eq', '2026-05-25T00:00:00Z', 'lastLogin'),
        ).toBe(true);
      });
    });

    it('should return false for undefined/null values', () => {
      expect(matchesFilter(undefined, 'eq', 'value', 'name')).toBe(false);
      expect(matchesFilter(null as any, 'eq', 'value', 'name')).toBe(false);
    });

    describe('missing lastLogin (never signed in)', () => {
      const cutoff = '2025-01-01T00:00:00Z';

      it('should MATCH lt/lte — never-logged-in users are the most inactive', () => {
        expect(matchesFilter(undefined, 'lt', cutoff, 'lastLogin')).toBe(true);
        expect(matchesFilter(undefined, 'lte', cutoff, 'lastLogin')).toBe(true);
      });

      it('should NOT match gt/gte — they never logged in after any date', () => {
        expect(matchesFilter(undefined, 'gt', cutoff, 'lastLogin')).toBe(false);
        expect(matchesFilter(undefined, 'gte', cutoff, 'lastLogin')).toBe(false);
      });

      it('should NOT match eq — there is no date to equal', () => {
        expect(matchesFilter(undefined, 'eq', cutoff, 'lastLogin')).toBe(false);
      });
    });
  });

  describe('applyUserFilters', () => {
    const users: User[] = [
      mockUser,
      {
        id: 'user-456',
        name: 'asmith',
        siteRole: 'Viewer',
        email: 'alice.smith@example.com',
        fullName: 'Alice Smith',
        lastLogin: '2026-05-15T08:00:00Z',
        authSetting: 'ServerDefault',
        locale: 'en_GB',
        language: 'en',
      },
      {
        id: 'user-789',
        name: 'bjones',
        siteRole: 'Unlicensed',
        email: 'bob.jones@example.com',
        fullName: 'Bob Jones',
        lastLogin: '2024-12-01T12:00:00Z',
        authSetting: 'SAML',
        locale: 'en_US',
        language: 'en',
      },
    ];

    it('should return all users when no filter provided', () => {
      const result = applyUserFilters(users, undefined);
      expect(result).toEqual(users);
    });

    it('should filter by single field with eq', () => {
      const result = applyUserFilters(users, 'siteRole:eq:Creator');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('user-123');
    });

    it('should filter by siteRole with in operator', () => {
      const result = applyUserFilters(users, 'siteRole:in:Creator|Viewer');
      expect(result).toHaveLength(2);
      expect(result[0].siteRole).toBe('Creator');
      expect(result[1].siteRole).toBe('Viewer');
    });

    it('should filter by multiple conditions (AND)', () => {
      const result = applyUserFilters(users, 'siteRole:eq:Creator,email:eq:john.smith@example.com');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('user-123');
    });

    it('should return empty array when no users match', () => {
      const result = applyUserFilters(users, 'siteRole:eq:ServerAdministrator');
      expect(result).toHaveLength(0);
    });

    it('should filter by email', () => {
      const result = applyUserFilters(users, 'email:eq:alice.smith@example.com');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('asmith');
    });

    it('should filter inactive users by lastLogin', () => {
      const result = applyUserFilters(users, 'lastLogin:lt:2025-01-01T00:00:00Z');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('user-789');
    });

    it('should filter by fullName', () => {
      const result = applyUserFilters(users, 'fullName:eq:Alice Smith');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('user-456');
    });

    it('should reject a filter on an unsupported (un-fetched) field, not silently return empty', () => {
      // authSetting/locale/language/externalAuthUserId are no longer fetched, so
      // they are no longer filterable. Filtering on them must be REJECTED with a
      // validation error rather than silently matching nothing (which was the
      // original lastLogin bug class).
      expect(() => applyUserFilters(users, 'authSetting:eq:SAML')).toThrow(/authSetting/);
      expect(() => applyUserFilters(users, 'locale:eq:en_US')).toThrow(/locale/);
      // Rejection also flows through the shared parse/validate entrypoint.
      expect(() => parseAndValidateUsersFilterString('authSetting:eq:SAML')).toThrow(
        /Invalid enum value/,
      );
    });

    it('should handle complex inactive user query', () => {
      const result = applyUserFilters(
        users,
        'siteRole:eq:Unlicensed,lastLogin:lt:2025-01-01T00:00:00Z',
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('user-789');
    });

    it('should include never-logged-in users in lastLogin:lt (inactivity) queries', () => {
      const neverLoggedIn: User = {
        id: 'user-never',
        name: 'nlogin',
        siteRole: 'Explorer',
        email: 'never.login@example.com',
        // no lastLogin — provisioned but never signed in
      };
      const usersWithNever = [...users, neverLoggedIn];
      const result = applyUserFilters(usersWithNever, 'lastLogin:lt:2025-01-01T00:00:00Z');
      // user-789 (2024-12-01) plus the never-logged-in user
      expect(result.map((u) => u.id).sort()).toEqual(['user-789', 'user-never']);
    });

    it('should include never-logged-in users in lastLogin:lte queries', () => {
      const neverLoggedIn: User = { id: 'user-never', name: 'nlogin', siteRole: 'Explorer' };
      const result = applyUserFilters([neverLoggedIn], 'lastLogin:lte:2025-01-01T00:00:00Z');
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('user-never');
    });

    it('should exclude never-logged-in users from lastLogin:gt queries', () => {
      const neverLoggedIn: User = { id: 'user-never', name: 'nlogin', siteRole: 'Explorer' };
      const usersWithNever = [...users, neverLoggedIn];
      const result = applyUserFilters(usersWithNever, 'lastLogin:gt:2025-01-01T00:00:00Z');
      expect(result.map((u) => u.id)).not.toContain('user-never');
    });

    it('should find never-logged-in reclamation candidates by role and inactivity', () => {
      const neverLoggedIn: User = {
        id: 'user-never',
        name: 'nlogin',
        siteRole: 'Creator',
      };
      const usersWithNever = [...users, neverLoggedIn];
      const result = applyUserFilters(
        usersWithNever,
        'siteRole:eq:Creator,lastLogin:lt:2025-01-01T00:00:00Z',
      );
      // Only the never-logged-in Creator qualifies; user-123 (Creator) logged in recently.
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('user-never');
    });

    it('should support date range with same-field multiple conditions', () => {
      const result = applyUserFilters(
        users,
        'lastLogin:gt:2025-01-01T00:00:00Z,lastLogin:lt:2026-05-20T00:00:00Z',
      );
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('user-456');
    });
  });
});
