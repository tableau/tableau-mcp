// Review artifacts that must never become published pages.
//
// Shared by the public docs generators (tool catalog, llms.txt) so they keep
// agreeing with docs.exclude in docusaurus.config.ts and the publish exclude
// list without each file restating the hex-glob. Lives under docs/ so it
// survives publishing to the public mirror (the skills folder does not).
//
// Dependency-free ESM. Node >= 18.

export const NONPUBLISHABLE_GLOBS = Object.freeze([
  '**/*_[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f].md',
  '**/*.[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f].md',
  '**/*_DRAFT.md',
  '**/*.DRAFT.md',
  '**/*_OLD.md',
  '**/*.OLD.md',
]);

export const NONPUBLISH_RE = /(?:[._][0-9a-f]{12}|[._]DRAFT|[._]OLD)\.md$/;

export const isNonPublishable = (name) => NONPUBLISH_RE.test(String(name));
