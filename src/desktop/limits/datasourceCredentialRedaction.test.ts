import { redactDatasourceCredentials } from './datasourceCredentialRedaction.js';

describe('redactDatasourceCredentials', () => {
  it('preserves datasource XML byte-for-byte when it has no credential attributes', () => {
    const xml =
      '<?xml version="1.0"?>\n' +
      '<datasource name="Sales">\n  <connection class="snowflake" server="example"/>\n</datasource>';

    expect(redactDatasourceCredentials(xml)).toBe(xml);
  });

  it.each([
    ['password', 'password-value'],
    ['oauth-access-token', 'access-token-value'],
    ['refresh_token', 'refresh-token-value'],
    ['x:clientSecret', 'client-secret-value'],
    ['connection-api-key', 'api-key-value'],
  ])('redacts a non-empty %s attribute value', (name, value) => {
    const xml = `<datasource xmlns:x="urn:test"><connection ${name}='${value}' server="safe"/></datasource>`;
    const redacted = redactDatasourceCredentials(xml);

    expect(redacted).toContain(`${name}=''`);
    expect(redacted).toContain('server="safe"');
    expect(redacted).not.toContain(value);
  });

  it('does not interpret credential-like text in comments, CDATA, or processing instructions', () => {
    const xml =
      '<?tableau password="instruction"?>' +
      '<datasource><!-- password="comment" --><![CDATA[password="content"]]>' +
      '<connection password="secret"/></datasource>';

    expect(redactDatasourceCredentials(xml)).toBe(
      '<?tableau password="instruction"?>' +
        '<datasource><!-- password="comment" --><![CDATA[password="content"]]>' +
        '<connection password=""/></datasource>',
    );
  });

  it.each([
    ['url', 'https://example.invalid/data?access_token=url-secret&safe=value'],
    ['connection-string', 'Server=example.invalid;Password=connection-secret;Database=safe'],
    ['properties', 'safe=value&oauth%5Faccess%5Ftoken=encoded-secret'],
  ])('redacts the complete %s attribute when its value embeds credentials', (name, value) => {
    const xml = `<datasource><connection ${name}="${value}" class="safe"/></datasource>`;
    const redacted = redactDatasourceCredentials(xml);

    expect(redacted).toContain(`${name}=""`);
    expect(redacted).toContain('class="safe"');
    expect(redacted).not.toContain(value);
    expect(redacted).not.toContain('url-secret');
    expect(redacted).not.toContain('connection-secret');
    expect(redacted).not.toContain('encoded-secret');
  });
});
