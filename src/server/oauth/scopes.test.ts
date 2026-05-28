import { describe, expect, it, vi } from 'vitest';

import * as configModule from '../../config.js';
import {
  getSupportedApiScopes,
  getSupportedMcpScopes,
  getSupportedScopes,
  isValidScope,
} from './scopes.js';

vi.mock('../../config.js', () => ({
  getConfig: vi.fn(),
}));

const mockGetConfig = vi.mocked(configModule.getConfig);

describe('scopes', () => {
  describe('getSupportedMcpScopes', () => {
    it('should include tableau:mcp:tasks:read when adminToolsEnabled is true', () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: true,
      } as any);

      const scopes = getSupportedMcpScopes();
      expect(scopes).toContain('tableau:mcp:tasks:read');
    });

    it('should exclude tableau:mcp:tasks:read when adminToolsEnabled is false', () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = getSupportedMcpScopes();
      expect(scopes).not.toContain('tableau:mcp:tasks:read');
    });

    it('should always include other MCP scopes regardless of adminToolsEnabled', () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = getSupportedMcpScopes();
      expect(scopes).toContain('tableau:mcp:datasource:read');
      expect(scopes).toContain('tableau:mcp:workbook:read');
      expect(scopes).toContain('tableau:mcp:view:read');
      expect(scopes).toContain('tableau:mcp:view:download');
      expect(scopes).toContain('tableau:mcp:pulse:read');
      expect(scopes).toContain('tableau:mcp:insight:create');
      expect(scopes).toContain('tableau:mcp:content:read');
    });
  });

  describe('getSupportedApiScopes', () => {
    it('should include tableau:tasks:read when adminToolsEnabled is true', () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: true,
      } as any);

      const scopes = getSupportedApiScopes();
      expect(scopes).toContain('tableau:tasks:read');
    });

    it('should exclude tableau:tasks:read when adminToolsEnabled is false', () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = getSupportedApiScopes();
      expect(scopes).not.toContain('tableau:tasks:read');
    });

    it('should include tableau:users:read when adminToolsEnabled is true', () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: true,
      } as any);

      const scopes = getSupportedApiScopes();
      expect(scopes).toContain('tableau:users:read');
    });

    it('should exclude tableau:users:read when adminToolsEnabled is false', () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = getSupportedApiScopes();
      expect(scopes).not.toContain('tableau:users:read');
    });

    it('should always include other API scopes regardless of adminToolsEnabled', () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = getSupportedApiScopes();
      expect(scopes).toContain('tableau:content:read');
      expect(scopes).toContain('tableau:mcp_site_settings:read');
    });
  });

  describe('getSupportedScopes', () => {
    it('should return only MCP scopes when includeApiScopes is false', () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: true,
      } as any);

      const scopes = getSupportedScopes({ includeApiScopes: false });
      expect(scopes).toContain('tableau:mcp:datasource:read');
      expect(scopes).not.toContain('tableau:content:read');
    });

    it('should return both MCP and API scopes when includeApiScopes is true', () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: true,
      } as any);

      const scopes = getSupportedScopes({ includeApiScopes: true });
      expect(scopes).toContain('tableau:mcp:datasource:read');
      expect(scopes).toContain('tableau:content:read');
    });

    it('should respect adminToolsEnabled flag when includeApiScopes is true', () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = getSupportedScopes({ includeApiScopes: true });
      expect(scopes).not.toContain('tableau:mcp:tasks:read');
      expect(scopes).not.toContain('tableau:tasks:read');
      expect(scopes).not.toContain('tableau:users:read');
    });
  });

  describe('isValidScope', () => {
    it('should return true for valid MCP scopes when adminToolsEnabled is true', () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: true,
      } as any);

      expect(isValidScope('tableau:mcp:tasks:read')).toBe(true);
      expect(isValidScope('tableau:mcp:datasource:read')).toBe(true);
    });

    it('should return false for tableau:mcp:tasks:read when adminToolsEnabled is false', () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      expect(isValidScope('tableau:mcp:tasks:read')).toBe(false);
    });

    it('should return true for other valid MCP scopes when adminToolsEnabled is false', () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      expect(isValidScope('tableau:mcp:datasource:read')).toBe(true);
      expect(isValidScope('tableau:mcp:workbook:read')).toBe(true);
    });

    it('should return false for invalid scopes', () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: true,
      } as any);

      expect(isValidScope('invalid:scope')).toBe(false);
      expect(isValidScope('tableau:invalid:scope')).toBe(false);
    });
  });
});
