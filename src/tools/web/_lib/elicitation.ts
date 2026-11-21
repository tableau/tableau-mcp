import type { TableauWebRequestHandlerExtra } from '../toolContext.js';

/**
 * Whether this request's client can show an elicitation form, so a tool may pass a form to
 * `requestInput`. Reads the capabilities sent on the request itself (2026-07-28), else those from
 * initialize (2025).
 */
export function clientSupportsFormElicitation(
  extra: Pick<TableauWebRequestHandlerExtra, 'clientCapabilities' | 'server'>,
): boolean {
  const elicitation = (extra.clientCapabilities ?? extra.server.capabilities)?.elicitation;
  // A bare `elicitation: {}` predates the form/url split and means form support.
  return (
    elicitation !== undefined &&
    (elicitation.form !== undefined || Object.keys(elicitation).length === 0)
  );
}
