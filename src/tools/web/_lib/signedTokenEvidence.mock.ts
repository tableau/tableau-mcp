/**
 * Test helper: the two Config fields SignedTokenEvidence reads (its only secret source is
 * getConfig()). Unit tests that mock getConfig() spread this into the mocked object so
 * `vi.stubEnv('MUTATION_TOKEN_SECRET', ...)` keeps modelling "replicas with the same secret". Mirrors
 * Config's own normalization (trimmed, '' when unset). Call it inside the mocked getConfig() body so
 * it reads the environment at call time, not at mock-factory time.
 */
import type { Config } from '../../../config.js';

export function mutationTokenConfigFromEnv(): Pick<
  Config,
  'mutationTokenSecret' | 'mutationTokenSecretPrevious'
> {
  return {
    mutationTokenSecret: process.env.MUTATION_TOKEN_SECRET?.trim() ?? '',
    mutationTokenSecretPrevious: process.env.MUTATION_TOKEN_SECRET_PREVIOUS?.trim() ?? '',
  };
}
