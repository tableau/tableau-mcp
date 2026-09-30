export const localToolNames = [
  'inject-template',
  'read-cached-xml',
  'write-cached-xml',
  'list-fields',
] as const;
export type LocalToolName = (typeof localToolNames)[number];
