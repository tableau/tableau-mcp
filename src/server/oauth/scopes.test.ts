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
    it('should include tableau:mcp:tasks:read when adminToolsEnabled is true', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: true,
      } as any);

      const scopes = await getSupportedMcpScopes();
      expect(scopes).toContain('tableau:mcp:tasks:read');
    });

    it('should exclude tableau:mcp:tasks:read when adminToolsEnabled is false', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedMcpScopes();
      expect(scopes).not.toContain('tableau:mcp:tasks:read');
    });

    it('should include tableau:mcp:tasks:write when adminToolsEnabled is true', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: true,
      } as any);

      const scopes = await getSupportedMcpScopes();
      expect(scopes).toContain('tableau:mcp:tasks:write');
    });

    it('should exclude tableau:mcp:tasks:write when adminToolsEnabled is false', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedMcpScopes();
      expect(scopes).not.toContain('tableau:mcp:tasks:write');
    });

    it('should include tableau:mcp:jobs:read when adminToolsEnabled is true', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: true,
      } as any);

      const scopes = await getSupportedMcpScopes();
      expect(scopes).toContain('tableau:mcp:jobs:read');
    });

    it('should exclude tableau:mcp:jobs:read when adminToolsEnabled is false', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedMcpScopes();
      expect(scopes).not.toContain('tableau:mcp:jobs:read');
    });

    it('should include tableau:mcp:users:write when adminToolsEnabled is true', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: true,
      } as any);

      const scopes = await getSupportedMcpScopes();
      expect(scopes).toContain('tableau:mcp:users:write');
    });

    it('should exclude tableau:mcp:users:write when adminToolsEnabled is false', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedMcpScopes();
      expect(scopes).not.toContain('tableau:mcp:users:write');
    });

    it('should exclude tableau:mcp:content:delete when adminToolsEnabled is false', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedMcpScopes();
      expect(scopes).not.toContain('tableau:mcp:content:delete');
    });

    it('should include tableau:mcp:content:delete when adminToolsEnabled is true', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: true,
      } as any);

      const scopes = await getSupportedMcpScopes();
      expect(scopes).toContain('tableau:mcp:content:delete');
    });

    it('should include tableau:mcp:flow:read when flowToolsEnabled is true', async () => {
      mockGetConfig.mockReturnValue({
        flowToolsEnabled: true,
      } as any);

      const scopes = await getSupportedMcpScopes();
      expect(scopes).toContain('tableau:mcp:flow:read');
    });

    it('should exclude tableau:mcp:flow:read when flowToolsEnabled is false', async () => {
      mockGetConfig.mockReturnValue({
        flowToolsEnabled: false,
      } as any);

      const scopes = await getSupportedMcpScopes();
      expect(scopes).not.toContain('tableau:mcp:flow:read');
    });

    it('should always include other MCP scopes regardless of adminToolsEnabled', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedMcpScopes();
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
    it('should include tableau:tasks:read when adminToolsEnabled is true', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: true,
      } as any);

      const scopes = await getSupportedApiScopes();
      expect(scopes).toContain('tableau:tasks:read');
    });

    it('should exclude tableau:tasks:read when adminToolsEnabled is false', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedApiScopes();
      expect(scopes).not.toContain('tableau:tasks:read');
    });

    it('should include tableau:tasks:write when adminToolsEnabled is true', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: true,
      } as any);

      const scopes = await getSupportedApiScopes();
      expect(scopes).toContain('tableau:tasks:write');
    });

    it('should exclude tableau:tasks:write when adminToolsEnabled is false', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedApiScopes();
      expect(scopes).not.toContain('tableau:tasks:write');
    });

    it('should include tableau:jobs:read when adminToolsEnabled is true', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: true,
      } as any);

      const scopes = await getSupportedApiScopes();
      expect(scopes).toContain('tableau:jobs:read');
    });

    it('should exclude tableau:jobs:read when adminToolsEnabled is false', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedApiScopes();
      expect(scopes).not.toContain('tableau:jobs:read');
    });

    it('should include tableau:users:read when adminToolsEnabled is true', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: true,
      } as any);

      const scopes = await getSupportedApiScopes();
      expect(scopes).toContain('tableau:users:read');
    });

    it('should exclude tableau:users:read when adminToolsEnabled is false', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedApiScopes();
      expect(scopes).not.toContain('tableau:users:read');
    });

    it('should include tableau:flows:read when flowToolsEnabled is true', async () => {
      mockGetConfig.mockReturnValue({
        flowToolsEnabled: true,
      } as any);

      const scopes = await getSupportedApiScopes();
      expect(scopes).toContain('tableau:flows:read');
    });

    it('should exclude tableau:flows:read when flowToolsEnabled is false', async () => {
      mockGetConfig.mockReturnValue({
        flowToolsEnabled: false,
      } as any);

      const scopes = await getSupportedApiScopes();
      expect(scopes).not.toContain('tableau:flows:read');
    });

    it('should include tableau:flows:download when flowToolsEnabled is true', async () => {
      mockGetConfig.mockReturnValue({
        flowToolsEnabled: true,
      } as any);

      const scopes = await getSupportedApiScopes();
      expect(scopes).toContain('tableau:flows:download');
    });

    it('should exclude tableau:flows:download when flowToolsEnabled is false', async () => {
      mockGetConfig.mockReturnValue({
        flowToolsEnabled: false,
      } as any);

      const scopes = await getSupportedApiScopes();
      expect(scopes).not.toContain('tableau:flows:download');
    });

    it('should include tableau:users:update when adminToolsEnabled is true', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: true,
      } as any);

      const scopes = await getSupportedApiScopes();
      expect(scopes).toContain('tableau:users:update');
    });

    it('should exclude tableau:users:update when adminToolsEnabled is false', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedApiScopes();
      expect(scopes).not.toContain('tableau:users:update');
    });

    it('should always include other API scopes regardless of adminToolsEnabled', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedApiScopes();
      expect(scopes).toContain('tableau:content:read');
      expect(scopes).toContain('tableau:mcp_site_settings:read');
    });
  });

  describe('getSupportedScopes', () => {
    it('should return only MCP scopes when includeApiScopes is false', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: true,
      } as any);

      const scopes = await getSupportedScopes({ includeApiScopes: false });
      expect(scopes).toContain('tableau:mcp:datasource:read');
      expect(scopes).not.toContain('tableau:content:read');
    });

    it('should return both MCP and API scopes when includeApiScopes is true', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: true,
      } as any);

      const scopes = await getSupportedScopes({ includeApiScopes: true });
      expect(scopes).toContain('tableau:mcp:datasource:read');
      expect(scopes).toContain('tableau:content:read');
    });

    it('should respect adminToolsEnabled flag when includeApiScopes is true', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      const scopes = await getSupportedScopes({ includeApiScopes: true });
      expect(scopes).not.toContain('tableau:mcp:tasks:read');
      expect(scopes).not.toContain('tableau:mcp:tasks:write');
      expect(scopes).not.toContain('tableau:mcp:jobs:read');
      expect(scopes).not.toContain('tableau:tasks:read');
      expect(scopes).not.toContain('tableau:tasks:write');
      expect(scopes).not.toContain('tableau:jobs:read');
      expect(scopes).not.toContain('tableau:users:read');
      expect(scopes).not.toContain('tableau:mcp:users:write');
      expect(scopes).not.toContain('tableau:users:update');
    });
  });

  describe('isValidScope', () => {
    it('should return true for valid MCP scopes when adminToolsEnabled is true', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: true,
      } as any);

      await expect(isValidScope('tableau:mcp:tasks:read')).resolves.toBe(true);
      await expect(isValidScope('tableau:mcp:tasks:write')).resolves.toBe(true);
      await expect(isValidScope('tableau:mcp:jobs:read')).resolves.toBe(true);
      await expect(isValidScope('tableau:mcp:datasource:read')).resolves.toBe(true);
    });

    it('should return false for tableau:mcp:tasks:read when adminToolsEnabled is false', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      await expect(isValidScope('tableau:mcp:tasks:read')).resolves.toBe(false);
    });

    it('should return false for tableau:mcp:tasks:write when adminToolsEnabled is false', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      await expect(isValidScope('tableau:mcp:tasks:write')).resolves.toBe(false);
    });

    it('should return false for tableau:mcp:jobs:read when adminToolsEnabled is false', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      await expect(isValidScope('tableau:mcp:jobs:read')).resolves.toBe(false);
    });

    it('should return true for other valid MCP scopes when adminToolsEnabled is false', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: false,
      } as any);

      await expect(isValidScope('tableau:mcp:datasource:read')).resolves.toBe(true);
      await expect(isValidScope('tableau:mcp:workbook:read')).resolves.toBe(true);
    });

    it('should return false for invalid scopes', async () => {
      mockGetConfig.mockReturnValue({
        adminToolsEnabled: true,
      } as any);

      await expect(isValidScope('invalid:scope')).resolves.toBe(false);
      await expect(isValidScope('tableau:invalid:scope')).resolves.toBe(false);
    });
  });
});
