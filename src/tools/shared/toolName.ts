export const sharedToolNames = ['build-worksheet-xml', 'validate-worksheet-xml'] as const;
export type SharedToolName = (typeof sharedToolNames)[number];
