import { dashboardCreationPrerequisite } from './dashboardCreationPrerequisite.js';

describe('dashboard creation prerequisites', () => {
  it.each([undefined, '0.2.21'])('requires manual registration on API %s', (version) => {
    expect(dashboardCreationPrerequisite('D', ['A', 'B'], version)).toMatchObject({
      required: true,
      status: 'blocked',
      kind: 'manual',
    });
  });
  it('permits automatic registration on a supported Desktop build', () => {
    expect(dashboardCreationPrerequisite('D', ['A', 'B'], '0.2.22')).toMatchObject({
      required: false,
      status: 'ready',
      kind: 'native',
    });
  });
});
