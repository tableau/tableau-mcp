import { describe, expect, it } from 'vitest';

import { isNativeRedirectUri } from './isNativeRedirectUri.js';

describe('isNativeRedirectUri', () => {
  describe('loopback http (allowed)', () => {
    it('should allow http://localhost', () => {
      expect(isNativeRedirectUri('http://localhost:3000')).toBe(true);
    });

    it('should allow http://127.0.0.1', () => {
      expect(isNativeRedirectUri('http://127.0.0.1:3000')).toBe(true);
    });

    it('should allow http://[::1]', () => {
      expect(isNativeRedirectUri('http://[::1]:3000')).toBe(true);
    });
  });

  describe('custom schemes (allowed)', () => {
    it('should allow custom scheme cursor://', () => {
      expect(isNativeRedirectUri('cursor://cb')).toBe(true);
    });

    it('should allow custom scheme vscode://', () => {
      expect(isNativeRedirectUri('vscode://oauth/callback')).toBe(true);
    });

    it('should allow custom scheme systemprompt://', () => {
      expect(isNativeRedirectUri('systemprompt://auth')).toBe(true);
    });
  });

  describe('remote https (rejected)', () => {
    it('should reject https://example.com', () => {
      expect(isNativeRedirectUri('https://example.com/cb')).toBe(false);
    });

    it('should reject https://evil.example.com', () => {
      expect(isNativeRedirectUri('https://evil.example.com/cb')).toBe(false);
    });
  });

  describe('remote http (rejected)', () => {
    it('should reject http://example.com', () => {
      expect(isNativeRedirectUri('http://example.com/cb')).toBe(false);
    });

    it('should reject http://192.168.1.1', () => {
      expect(isNativeRedirectUri('http://192.168.1.1:3000')).toBe(false);
    });
  });

  describe('non-URLs (rejected)', () => {
    it('should reject non-URL string', () => {
      expect(isNativeRedirectUri('not-a-url')).toBe(false);
    });

    it('should reject emoji', () => {
      expect(isNativeRedirectUri('🍔')).toBe(false);
    });

    it('should reject non-string', () => {
      expect(isNativeRedirectUri(123 as any)).toBe(false);
    });
  });
});
