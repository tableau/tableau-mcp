import { parseFlowPackage } from './flowPackage.js';
import { analyzePrepScript, MAX_PREP_SCRIPT_BYTES } from './prepScriptAnalysis.js';
import fixtures from './prepScriptAnalysis.test.fixtures.json';
import { matchPrepScriptContext, packagedScriptReferences } from './prepScriptBindings.js';

const scriptId = '22222222-2222-4222-8222-222222222222';
describe('source-guided embedded Prep script analysis', () => {
  it('decodes Python reference literals without evaluating code and keeps comprehensions conditional', () => {
    const escaped = "def transform(data):\n data['Total'] = data['Price\\'local']\n return data\n";
    expect(
      analyzePrepScript(Buffer.from(escaped), 'python').functions.transform.outputs.Total.inputs,
    ).toEqual(["Price'local"]);
    const expression =
      "def transform(data):\n data['Total'] = [x for x in data['Price']]\n return data\n";
    expect(
      analyzePrepScript(Buffer.from(expression), 'python').functions.transform.outputs.Total,
    ).toEqual({ inputs: ['Price'], status: 'candidate' });
  });
  it.each(['python', 'r'] as const)(
    'reads %s literal schemas and explicit dependencies without returning source text',
    (language) => {
      const source = language === 'python' ? fixtures.pythonSource : fixtures.rSource;
      const evidence = analyzePrepScript(Buffer.from(source), language);
      expect(evidence.fields).toEqual({ Total: 'real' });
      expect(evidence.schemaStatus).toBe('static-declaration');
      expect(evidence.functions.transform.outputs.Total).toEqual({
        inputs: ['Price', 'Qty'],
        status: 'static',
      });
      expect(evidence.nativeExecutionVerified).toBe(false);
      expect(JSON.stringify(evidence)).not.toContain(source);
    },
  );
  it('resolves sequential input versions rather than reporting a replaced column as an origin', () => {
    const evidence = analyzePrepScript(
      Buffer.from(
        "def transform(data):\n data['Price'] = data['Qty']\n data['Total'] = data['Price'] * 2\n return data\n",
      ),
      'python',
    );
    expect(evidence.functions.transform.outputs.Total.inputs).toEqual(['Qty']);
  });
  it.each(['python', 'r'] as const)('recognizes an exact %s identity function', (language) => {
    const source =
      language === 'python'
        ? 'def transform(data):\n return data\n'
        : 'transform <- function(data) { return(data) }';
    const result = analyzePrepScript(Buffer.from(source), language);
    expect(result.schemaStatus).toBe('missing');
    expect(result.functions.transform.returnsInput).toBe(true);
  });
  it('follows a literal returned Python DataFrame by each output expression', () => {
    const result = analyzePrepScript(
      Buffer.from(
        "def transform(data):\n return pd.DataFrame({'Total': data['Price'] * data['Qty'], 'Constant': 1})\n",
      ),
      'python',
    );
    expect(result.functions.transform.outputs.Total.inputs).toEqual(['Price', 'Qty']);
    expect(result.functions.transform.outputs.Constant.inputs).toEqual([]);
  });
  it('isolates the schema function from helpers, dead constructors, comments and literal decoys', () => {
    const source =
      "# get_output_schema DataFrame({'Secret': prep_int()})\ndef helper(data):\n return pd.DataFrame({'Unused': 1})\n" +
      fixtures.pythonSource;
    expect(analyzePrepScript(Buffer.from(source), 'python').fields).toEqual({ Total: 'real' });
    const dynamic =
      '# get_output_schema DataFrame\ndef get_output_schema():\n return remote_schema()\n';
    expect(analyzePrepScript(Buffer.from(dynamic), 'python')).toMatchObject({
      fields: {},
      schemaStatus: 'dynamic',
    });
  });
  it.each([
    ['', 'dynamic'],
    [', check.names=FALSE', 'static-declaration'],
  ])('respects R automatic name repair (%s)', (option, status) => {
    const source =
      'getOutputSchema <- function() { return(data.frame(`Name with space`=prep_string()' +
      option +
      ')) }';
    expect(analyzePrepScript(Buffer.from(source), 'r').schemaStatus).toBe(status);
  });
  it('keeps function calls, dynamic selectors and their sequential descendants as candidates', () => {
    const source =
      "def transform(data):\n data['Price'] = remote(data['Qty'])\n data['Total'] = data['Price'] * 2\n data['Dynamic'] = data[column]\n return data\n";
    const result = analyzePrepScript(Buffer.from(source), 'python');
    expect(result.functions.transform.outputs.Total).toEqual({
      inputs: ['Qty'],
      status: 'candidate',
    });
    expect(result.functions.transform.outputs.Dynamic.status).toBe('candidate');
  });
  it.each([
    Buffer.from([255]),
    Buffer.alloc(MAX_PREP_SCRIPT_BYTES + 1),
    Buffer.from('x=' + '['.repeat(40001)),
  ])('bounds invalid/oversized inputs without executing any source', (bytes) => {
    const result = analyzePrepScript(bytes, 'python');
    expect(result.fields).toEqual({});
    expect(['limited', 'invalid-or-dynamic']).toContain(result.schemaStatus);
  });
  it.each(['python', 'r'] as const)(
    'matches the %s package attachment to its exact node and language',
    (language) => {
      const result = parseFlowPackage(Buffer.from(fixtures[language], 'base64'));
      expect(result.scriptContext?.scripts[scriptId].fields).toEqual({ Total: 'real' });
      const context = matchPrepScriptContext(
        result.document,
        result.document,
        result.scriptContext!,
      );
      expect(context.scripts[scriptId].sourceSha256).toHaveLength(64);
      expect(JSON.stringify(result.scriptContext)).not.toMatch(
        /NEVER_RETURN|import pandas|return\(data\)/,
      );
    },
  );
  it.each(['ambiguousPaths', 'wrongOwner', 'wrongLanguage', 'largeScript'] as const)(
    'never opens or guesses a source for %s',
    (fixture) => {
      const parsed = parseFlowPackage(Buffer.from(fixtures[fixture], 'base64'));
      expect(Object.keys(parsed.scriptContext?.scripts ?? {})).toEqual([]);
    },
  );
  it('refuses mismatched function/path settings and duplicate native nodes between API/package reads', () => {
    const parsed = parseFlowPackage(Buffer.from(fixtures.python, 'base64'));
    const changed = structuredClone(parsed.document);
    changed.nodes![scriptId].executionParameters = { scriptFunctionName: 'different' };
    expect(matchPrepScriptContext(changed, parsed.document, parsed.scriptContext!).scripts).toEqual(
      {},
    );
    changed.nodes!.duplicate = structuredClone(changed.nodes![scriptId]);
    expect(packagedScriptReferences(changed)).toEqual([]);
  });
});
