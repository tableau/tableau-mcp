import { ServerInfo } from '../../../sdks/tableau/types/serverInfo.js';
import { supportsCollections } from './collectionsCapability.js';

const info = (restApiVersion: string, product = '2026.2.0'): ServerInfo => ({
  restApiVersion,
  productVersion: { value: product, build: 'release-build' },
});

describe('Collections deployment capability', () => {
  it('accepts Cloud REST 3.28 without equating it to a Server release', () => {
    expect(supportsCollections('https://10ay.online.tableau.com', info('3.28', '2026.1.0'))).toBe(
      true,
    );
  });

  it('rejects older Cloud', () => {
    expect(supportsCollections('https://10ay.online.tableau.com', info('3.27'))).toBe(false);
  });

  it('rejects Server 2026.1 even at REST 3.28', () => {
    expect(supportsCollections('https://tableau.example.com', info('3.28', '2026.1.0'))).toBe(
      false,
    );
  });

  it('accepts Server 2026.2 at its documented API version', () => {
    expect(supportsCollections('https://tableau.example.com', info('3.29'))).toBe(true);
  });

  it('fails closed for unknown product versions and development builds', () => {
    for (const product of ['unknown', '0.0.0', '2026.2', '2026.1.0']) {
      expect(supportsCollections('https://tableau.example.com', info('3.30', product))).toBe(false);
    }
  });

  it('does not mistake a lookalike domain for Cloud', () => {
    expect(
      supportsCollections('https://online.tableau.com.evil.example', info('3.28', '2026.1.0')),
    ).toBe(false);
  });

  it('fails closed for invalid server URLs or REST versions', () => {
    expect(supportsCollections('not a URL', info('3.29'))).toBe(false);
    for (const version of ['unknown', '3', '3.28-preview']) {
      expect(supportsCollections('https://10ay.online.tableau.com', info(version))).toBe(false);
    }
  });
});
