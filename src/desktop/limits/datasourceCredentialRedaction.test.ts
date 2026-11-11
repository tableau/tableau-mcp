import {
  containsRedactedCredentialSentinel,
  redactDatasourceCredentials,
  REDACTED_CREDENTIAL_SENTINEL,
} from './datasourceCredentialRedaction.js';

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

    expect(redacted).toContain(`${name}='${REDACTED_CREDENTIAL_SENTINEL}'`);
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
        `<connection password="${REDACTED_CREDENTIAL_SENTINEL}"/></datasource>`,
    );
  });

  it.each([
    ['url', 'https://example.invalid/data?access_token=url-secret&safe=value'],
    ['connection-string', 'Server=example.invalid;Password=connection-secret;Database=safe'],
    ['connection-string', 'Server=example.invalid; Password = whitespace-secret;Database=safe'],
    ['odbc-connect-string', 'UID=user;PWD=pwd-secret'],
    ['properties', 'safe=value&oauth%5Faccess%5Ftoken=encoded-secret'],
    ['odbc-connect-string-extras', 'safe=value&oauth%5Faccess%5Ftoken=encoded-secret'],
    ['one-time-sql', 'SET a=1;token=sql-secret'],
  ])('redacts the complete %s attribute when its value embeds credentials', (name, value) => {
    const xml = `<datasource><connection ${name}="${value}" class="safe"/></datasource>`;
    const redacted = redactDatasourceCredentials(xml);

    expect(redacted).toContain(`${name}="${REDACTED_CREDENTIAL_SENTINEL}"`);
    expect(redacted).toContain('class="safe"');
    expect(redacted).not.toContain(value);
    expect(redacted).not.toContain('url-secret');
    expect(redacted).not.toContain('sql-secret');
    expect(redacted).not.toContain('connection-secret');
    expect(redacted).not.toContain('whitespace-secret');
    expect(redacted).not.toContain('pwd-secret');
    expect(redacted).not.toContain('encoded-secret');
  });

  it('keeps calc formulas, captions and names that look like credential pairs on non-connection tags', () => {
    const xml =
      "<datasource caption='pwd=1' name='token=1'>" +
      "<column caption='pwd=1' name='[Token]'><calculation formula='[Token]=1'/></column>" +
      "<relation name='token=1' caption='pwd=1'/></datasource>";

    expect(redactDatasourceCredentials(xml)).toBe(xml);
  });

  it('redacts credentials on prefixed connection tags but not on names that merely end in connection', () => {
    const redacted = redactDatasourceCredentials(
      "<_.fcp.SomeFlag.true...connection password='s'/><x:connection token='t'/>",
    );
    const plain = "<datasource-connection password='s'/>";

    expect(redacted).toBe(
      `<_.fcp.SomeFlag.true...connection password='${REDACTED_CREDENTIAL_SENTINEL}'/>` +
        `<x:connection token='${REDACTED_CREDENTIAL_SENTINEL}'/>`,
    );
    expect(redactDatasourceCredentials(plain)).toBe(plain);
  });

  it('redacts a credential value that spans a newline', () => {
    const redacted = redactDatasourceCredentials(
      "<connection password='a&#10;b' server='s'/><named-connection token='a\nb'/>",
    );

    expect(redacted).toBe(
      `<connection password='${REDACTED_CREDENTIAL_SENTINEL}' server='s'/>` +
        `<named-connection token='${REDACTED_CREDENTIAL_SENTINEL}'/>`,
    );
  });

  it('does not touch credential-named attributes outside connection tags', () => {
    const xml = "<datasource password='x'><column token='y'/></datasource>";

    expect(redactDatasourceCredentials(xml)).toBe(xml);
  });

  it('detects the sentinel and nothing else', () => {
    expect(
      containsRedactedCredentialSentinel(
        `<connection password='${REDACTED_CREDENTIAL_SENTINEL}'/>`,
      ),
    ).toBe(true);
    expect(containsRedactedCredentialSentinel("<connection password=''/>")).toBe(false);
  });

  it('redacts a connection tag holding a million spaces in under a second', () => {
    const xml = `<connection${' '.repeat(1_000_000)}/>`;
    const start = Date.now();

    expect(redactDatasourceCredentials(xml)).toBe(xml);
    expect(Date.now() - start).toBeLessThan(1000);
  }, 20_000);
});
