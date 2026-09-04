import { RestApiArgs } from '../../restApiInstance.js';
import {
  checkRegistrationConditions,
  RegistrationCondition,
  RegistrationContext,
} from './registrationConditions.js';

describe('checkRegistrationConditions', () => {
  // restApiArgs is only consulted by the (not-yet-implemented) capability lookups; the decision
  // logic under test reads/writes `context`, so a minimal stub is sufficient here.
  const restApiArgs = {} as unknown as RestApiArgs;

  it('is met when there are no conditions to satisfy', async () => {
    const context: RegistrationContext = {};
    await expect(checkRegistrationConditions([], context, restApiArgs)).resolves.toEqual({
      registrationConditionsMet: true,
    });
  });

  it('is met when a required capability is already satisfied in context', async () => {
    // Pre-populated context models a capability resolved earlier in the same registration pass.
    const context: RegistrationContext = { isPulseEnabled: true };
    await expect(
      checkRegistrationConditions(['RequiresPulse'], context, restApiArgs),
    ).resolves.toEqual({ registrationConditionsMet: true });
  });

  it('reports the failing condition when a required capability is disabled in context (fail-closed)', async () => {
    const context: RegistrationContext = { isPulseEnabled: false };
    await expect(
      checkRegistrationConditions(['RequiresPulse'], context, restApiArgs),
    ).resolves.toEqual({ registrationConditionsMet: false, failingCondition: 'RequiresPulse' });
  });

  it('does not re-resolve a capability already present in context (memoized across tools)', async () => {
    // If the `=== undefined` guard were missing, the lookup would overwrite this with the
    // not-yet-implemented default (false). Getting "met" back proves the re-fetch is short-circuited.
    const context: RegistrationContext = { hasPulsePremium: true };
    await expect(
      checkRegistrationConditions(['RequiresPulsePremium'], context, restApiArgs),
    ).resolves.toEqual({ registrationConditionsMet: true });
  });

  it('requires every condition — one unmet condition hides the tool and names it', async () => {
    const context: RegistrationContext = { isPulseEnabled: true, hasPulsePremium: false };
    await expect(
      checkRegistrationConditions(['RequiresPulse', 'RequiresPulsePremium'], context, restApiArgs),
    ).resolves.toEqual({
      registrationConditionsMet: false,
      failingCondition: 'RequiresPulsePremium',
    });
  });

  it('is met when every condition is satisfied', async () => {
    const context: RegistrationContext = { isPulseEnabled: true, hasPulsePremium: true };
    await expect(
      checkRegistrationConditions(['RequiresPulse', 'RequiresPulsePremium'], context, restApiArgs),
    ).resolves.toEqual({ registrationConditionsMet: true });
  });

  it('fails closed with MissingConditionCheck on an unrecognized condition', async () => {
    // Only reachable via an unsound cast (the union type excludes it), but the runtime guard must
    // hide the tool rather than expose it, and flag it as a missing check.
    const context: RegistrationContext = {};
    await expect(
      checkRegistrationConditions(['Nonsense' as RegistrationCondition], context, restApiArgs),
    ).resolves.toEqual({
      registrationConditionsMet: false,
      failingCondition: 'MissingConditionCheck',
    });
  });

  it('is fail-closed until a capability lookup is implemented, memoizing the unresolved result', async () => {
    // The Pulse lookups are not yet implemented (near-term roadmap); until then an unresolved
    // capability resolves to "unavailable" and is memoized so it is looked up at most once per pass.
    const context: RegistrationContext = {};
    await expect(
      checkRegistrationConditions(['RequiresPulse'], context, restApiArgs),
    ).resolves.toEqual({ registrationConditionsMet: false, failingCondition: 'RequiresPulse' });
    expect(context.isPulseEnabled).toBe(false);
  });
});
