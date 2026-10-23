import { createDashboardReadbackDiagnoser } from './dashboardViewpoints.js';

// Verbatim Desktop readback from the live apply-dashboard probe (filter zone, caption added to the column).
const desktopDashboard = `<dashboard enable-sort-zone-taborder='true' name='Dashboard 1'>
      <style />
      <size maxheight='800' maxwidth='1000' minheight='800' minwidth='1000' />
      <datasources>
        <datasource caption='gross-margin-calc' name='federated.csv040059ff380b040059ff380b' />
      </datasources>
      <datasource-dependencies datasource='federated.csv040059ff380b040059ff380b'>
        <column-instance column='[product_line]' derivation='None' name='[none:product_line:nk]' pivot='key' type='nominal' />
        <column caption='Product Line' datatype='string' name='[product_line]' role='dimension' type='nominal' />
      </datasource-dependencies>
      <zones>
        <zone h='100000' id='4' type-v2='layout-basic' w='100000' x='0' y='0'>
          <zone h='100000' id='3' param='horz' type-v2='layout-flow' w='100000' x='0' y='0'>
            <zone h='100000' id='5' name='Total Revenue' w='13000' x='0' y='0'>
              <layout-cache fixed-size-w='130' type-h='fixed' type-w='fixed' />
            </zone>
            <zone h='100000' id='6' name='Revenue by Product per Period' w='26200' x='13000' y='0'>
              <layout-cache fixed-size-w='262' type-h='fixed' type-w='fixed' />
            </zone>
            <zone h='100000' id='7' name='Revenue by Product per Period' param='[federated.csv040059ff380b040059ff380b].[none:product_line:nk]' type-v2='filter' values='database' w='16000' x='39200' y='0'>
              <zone-style>
                <format attr='border-color' value='#444444' />
                <format attr='border-style' value='none' />
                <format attr='border-width' value='0' />
                <format attr='background-color' value='#ffffff' />
              </zone-style>
            </zone>
          </zone>
        </zone>
      </zones>
      <devicelayouts>
        <devicelayout auto-generated='true' name='Phone'>
          <size maxheight='700' minheight='700' sizing-mode='vscroll' />
          <zones>
            <zone h='100000' id='2' type-v2='layout-basic' w='100000' x='0' y='0'>
              <zone h='84000' id='1' param='vert' type-v2='layout-flow' w='84000' x='8000' y='8000' />
              <zone-style>
                <format attr='border-color' value='#444444' />
                <format attr='border-style' value='none' />
                <format attr='border-width' value='0' />
                <format attr='margin' value='8' />
              </zone-style>
            </zone>
          </zones>
        </devicelayout>
      </devicelayouts>
      <simple-id uuid='{6E18F4D1-6BE3-4FAE-8C86-C78541D56535}' />
    </dashboard>`;

const DS = 'federated.csv040059ff380b040059ff380b';
const uuid = '{6E18F4D1-6BE3-4FAE-8C86-C78541D56535}';
const sheets = ['Revenue by Product per Period', 'Total Revenue'];
const zones = (widths: [number, number, number]): string => `<zones>
    <zone h='100000' id='4' type-v2='layout-basic' w='100000' x='0' y='0'>
      <zone h='100000' id='3' param='horz' type-v2='layout-flow' w='100000' x='0' y='0'>
        <zone h='100000' id='5' name='Total Revenue' w='${widths[0]}' x='0' y='0'></zone>
        <zone h='100000' id='6' name='Revenue by Product per Period' w='${widths[1]}' x='${widths[0]}' y='0'></zone>
        <zone h='100000' id='7' name='Revenue by Product per Period' param='[${DS}].[none:product_line:nk]' type-v2='filter' values='database' w='${widths[2]}' x='${widths[0] + widths[1]}' y='0' />
      </zone>
    </zone>
  </zones>`;
const submittedZones = zones([30000, 50000, 20000]);
const desktopZones = zones([13000, 26200, 16000]);
const style = '<style />';
const size = "<size maxheight='800' maxwidth='1000' minheight='800' minwidth='1000' />";
const datasources = `<datasources><datasource caption='gross-margin-calc' name='${DS}' /></datasources>`;
const column = "<column datatype='string' name='[product_line]' role='dimension' type='nominal' />";
const instance =
  "<column-instance column='[product_line]' derivation='None' name='[none:product_line:nk]' pivot='key' type='nominal' />";
const dependencies = (content: string, datasource = DS): string =>
  `<datasource-dependencies datasource='${datasource}'>${content}</datasource-dependencies>`;
const simpleId = `<simple-id uuid='${uuid}' />`;

const wrap = (dashboard: string): string =>
  `<workbook><dashboards>${dashboard}</dashboards><windows><window class='dashboard' name='Dashboard 1'><viewpoints>${sheets.map((name) => `<viewpoint name='${name}' />`).join('')}</viewpoints></window></windows></workbook>`;
const submit = (...sections: string[]): string =>
  `<dashboard enable-sort-zone-taborder='true' name='Dashboard 1'>${sections.join('')}</dashboard>`;
const diagnose = (submitted: string, actual = desktopDashboard): string | undefined =>
  createDashboardReadbackDiagnoser(wrap(submitted), 'Dashboard 1')(wrap(actual));
/** Desktop's dashboard with its dependency block replaced, for strictness cases. */
const desktopWith = (dependencyBlocks: string): string =>
  desktopDashboard.replace(
    /<datasource-dependencies[\s\S]*?<\/datasource-dependencies>/,
    dependencyBlocks,
  );
const geometryReason =
  'zone 3 ("horz"): child widths are [13000, 26200, 16000] in Desktop and do not fill the 100000 units (1000px) available. ' +
  "Desktop sized unpinned zones to their content. FIX: pin every child of zone 3: zone 5 is-fixed='true' fixed-size='300', zone 6 is-fixed='true' fixed-size='500', zone 7 is-fixed='true' fixed-size='200' " +
  "(px; each child's margins add to its fixed-size, and the total fills the 1000px container)";

describe('dashboard readback ignores section order that Desktop owns', () => {
  it('reports the real geometry reason for the probe fragment, not section order', () => {
    expect(
      diagnose(
        submit(style, size, submittedZones, datasources, dependencies(column + instance), simpleId),
      ),
    ).toBe(geometryReason);
  });

  it('matches the same pair once the zones carry the widths Desktop fixed', () => {
    expect(
      diagnose(
        submit(style, size, desktopZones, datasources, dependencies(column + instance), simpleId),
      ),
    ).toBeUndefined();
  });

  it('matches when the submission omits datasources and dependencies that Desktop adds', () => {
    expect(diagnose(submit(style, size, desktopZones, simpleId))).toBeUndefined();
  });

  it('matches two datasource-dependencies blocks in swapped order', () => {
    const second = dependencies(column, 'other-ds');
    const actual = desktopWith(second + dependencies(column + instance));
    expect(
      diagnose(
        submit(size, desktopZones, dependencies(column + instance), second, simpleId),
        actual,
      ),
    ).toBeUndefined();
  });
});

describe('dashboard readback stays strict inside the identity-matched parents', () => {
  const sections = (deps: string, zoneXml = desktopZones): string =>
    submit(style, size, zoneXml, deps, simpleId);

  it('fails a submitted column that Desktop lacks', () => {
    const renamed = column.replace('[product_line]', '[region]');
    expect(diagnose(sections(dependencies(renamed + instance)))).toBe(
      '<column> "[region]" is missing in Desktop',
    );
  });

  it('fails a changed column attribute', () => {
    expect(
      diagnose(
        sections(dependencies(column.replace("role='dimension'", "role='measure'") + instance)),
      ),
    ).toBe('<column> "[product_line]": role is "dimension" in Desktop, "measure" submitted');
  });

  it('fails a column that appears twice in Desktop', () => {
    const actual = desktopWith(dependencies(column + column + instance));
    expect(diagnose(sections(dependencies(column + instance)), actual)).toBe(
      '<datasource-dependencies> has 3 child elements in Desktop, 2 submitted',
    );
    expect(diagnose(sections(dependencies(column + column)), actual)).toBe(
      '<column> "[product_line]" appears 2 times in Desktop',
    );
  });

  it('fails a submitted column twice against one in Desktop', () => {
    expect(diagnose(sections(dependencies(column + column + instance)))).toBe(
      '<datasource-dependencies> has 2 child elements in Desktop, 3 submitted',
    );
  });

  it('fails a keyless submitted column', () => {
    expect(diagnose(sections(dependencies("<column datatype='string' />" + instance)))).toBe(
      '<column> is missing in Desktop',
    );
  });

  it('fails a dependencies block for another datasource', () => {
    expect(diagnose(sections(dependencies(column + instance, 'other-ds')))).toBe(
      '<datasource-dependencies> "other-ds" is missing in Desktop',
    );
  });

  it('fails a dependencies block that Desktop has twice', () => {
    const actual = desktopWith(dependencies(column + instance) + dependencies(column + instance));
    expect(diagnose(sections(dependencies(column + instance)), actual)).toBe(
      '<dashboard> "Dashboard 1" has 6 child elements in Desktop, 5 submitted',
    );
  });

  it('fails the same dependencies block submitted twice against two in Desktop', () => {
    const twice = dependencies(column + instance);
    const actual = desktopWith(twice + twice);
    expect(diagnose(submit(style, size, desktopZones, twice, twice, simpleId), actual)).toBe(
      '<datasource-dependencies> "federated.csv040059ff380b040059ff380b" appears 2 times in Desktop',
    );
  });

  it('fails an extra column in Desktop when the submission uses the tag', () => {
    const actual = desktopWith(
      dependencies(column + instance + column.replace('[product_line]', '[extra]')),
    );
    expect(diagnose(sections(dependencies(column + instance)), actual)).toBe(
      '<datasource-dependencies> has 3 child elements in Desktop, 2 submitted',
    );
  });

  it('ignores an extra column-instance in Desktop when the submission has none', () => {
    expect(diagnose(sections(dependencies(column)))).toBeUndefined();
  });

  it('keeps zones positional: reordered sibling zones fail', () => {
    const swapped = desktopZones
      .replace("id='5' name='Total Revenue'", "id='X' name='Total Revenue'")
      .replace("id='6' name='Revenue by Product per Period'", "id='5' name='Total Revenue'")
      .replace("id='X' name='Total Revenue'", "id='6' name='Revenue by Product per Period'");
    expect(diagnose(sections(dependencies(column + instance), swapped))).toBe(
      'zone 6 ("Revenue by Product per Period"): id is "5" in Desktop, "6" submitted',
    );
  });

  it('keeps the children of <zones> positional', () => {
    const pair = (first: string, second: string): string =>
      `<zones><zone h='100000' id='${first}' type-v2='layout-basic' w='50000' x='0' y='0' /><zone h='100000' id='${second}' type-v2='layout-basic' w='50000' x='50000' y='0' /></zones>`;
    expect(
      diagnose(
        submit(pair('4', '8')),
        desktopDashboard.replace(/<zones>[\s\S]*?<\/zones>/, pair('8', '4')),
      ),
    ).toBe('zone 4: id is "8" in Desktop, "4" submitted');
  });

  it('fails a submitted column claimed twice against different Desktop columns', () => {
    const other = column.replace('[product_line]', '[b]');
    const actual = desktopWith(dependencies(column + other));
    expect(diagnose(sections(dependencies(column + column)), actual)).toBe(
      '<column> "[product_line]" is submitted more than once',
    );
  });

  it('fails a submitted column-instance claimed twice', () => {
    const other = instance.replace('[none:product_line:nk]', '[none:other:nk]');
    const actual = desktopWith(dependencies(column + instance + other));
    expect(diagnose(sections(dependencies(column + instance + instance)), actual)).toBe(
      '<column-instance> "[none:product_line:nk]" is submitted more than once',
    );
  });

  it('fails a dependencies block claimed twice against different Desktop blocks', () => {
    const block = dependencies(column + instance);
    const actual = desktopWith(block + dependencies(column, 'other-ds'));
    expect(diagnose(submit(style, size, desktopZones, block, block, simpleId), actual)).toBe(
      '<datasource-dependencies> "federated.csv040059ff380b040059ff380b" is submitted more than once',
    );
  });
});
