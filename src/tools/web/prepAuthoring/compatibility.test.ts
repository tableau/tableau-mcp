import { prepCompatibility } from './compatibility.js';

describe('Prep publication compatibility notices', () => {
  const none = { hasScriptSteps: false, hasInputUnion: false, hasFileInputs: false };
  it('marks Cloud script flows unsupported independently of structural validity', () => {
    const result = prepCompatibility({ ...none, hasScriptSteps: true }, 'cloud', 'tflx');
    expect(result.publicationReadiness).toBe('unsupported');
    expect(result.notices.map((n) => n.code)).toEqual(['CLOUD_SCRIPT_STEPS_UNSUPPORTED']);
    expect(result.notices[0].source).toContain('help.tableau.com');
  });
  it.each(['server', 'builder'] as const)(
    'retains service prerequisites for %s instead of claiming local-only support',
    (target) => {
      const result = prepCompatibility({ ...none, hasScriptSteps: true }, target, 'tfl');
      expect(result.publicationReadiness).toBe('requires-runtime-verification');
      expect(result.notices[0].code).toBe('SCRIPT_SERVICE_REQUIRED');
      expect(result.notices[0].message).toContain('Server can run');
    },
  );
  it('separates input-union web execution, TFLX new-file intake and Cloud refresh', () => {
    const result = prepCompatibility(
      { ...none, hasInputUnion: true, hasFileInputs: true },
      'cloud',
      'tflx',
    );
    expect(result.notices.map((n) => n.code)).toEqual([
      'INPUT_UNION_AUTHORING_BUILDER',
      'PACKAGED_UNION_NEW_FILES',
      'CLOUD_FILE_REFRESH',
    ]);
    expect(result.notices[0].message).toContain('can be scheduled to run on the web');
  });
  it('does not attach packaged or Cloud-only warnings to a native Server TFL', () => {
    const result = prepCompatibility(
      { ...none, hasInputUnion: true, hasFileInputs: true },
      'server',
      'tfl',
    );
    expect(result.notices.map((n) => n.code)).toEqual(['INPUT_UNION_AUTHORING_BUILDER']);
  });
  it('never upgrades an ordinary structurally valid file to execution/publish proof', () => {
    expect(prepCompatibility(none, 'cloud', 'tflx')).toEqual({
      publicationReadiness: 'requires-runtime-verification',
      notices: [],
    });
  });
});
