export function escapeXmlAttribute(value: string): string {
  return (
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      // Numeric char ref, not the named &apos; - &apos; is a valid XML 1.0 entity but is absent from
      // the HTML predefined set and the Tableau publish endpoint's parser rejects it (a name like
      // O'Brien then 400s). &#39; is universally accepted.
      .replace(/'/g, '&#39;')
  );
}
