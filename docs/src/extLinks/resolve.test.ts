import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  EXT_COMING_RELEASE,
  OFFICIAL_ORIGIN,
  buildExtLinkModel,
  classifyHostname,
  extLinkDataAttributes,
  hrefForViewer,
  joinBasePath,
  outboundEnvFromGithubOrigin,
  parseExtProtocol,
} from './resolve';

const STUDIO_STAGE = 'https://help.tableau.com/v0.0/api/studio-dev-guide/en-us/';
const STUDIO_PROD = 'https://help.tableau.com/current/api/studio-dev-guide/en-us/';
const EXT_PROD = 'https://tableau.github.io/extensions-api/';

describe('joinBasePath', () => {
  it('returns the base when path is empty (home)', () => {
    assert.equal(joinBasePath(STUDIO_STAGE), STUDIO_STAGE);
    assert.equal(joinBasePath(STUDIO_STAGE, ''), STUDIO_STAGE);
  });

  it('joins a relative path onto a trailing-slash base', () => {
    assert.equal(
      joinBasePath(STUDIO_STAGE, 'get-started-with-tableau-agent.html'),
      `${STUDIO_STAGE}get-started-with-tableau-agent.html`,
    );
  });

  it('strips a leading slash on the path', () => {
    assert.equal(joinBasePath(STUDIO_STAGE, '/foo.html'), `${STUDIO_STAGE}foo.html`);
  });

  it('keeps a hash fragment so Redoc operation anchors survive the join', () => {
    const ecaStage = 'https://help.tableau.com/v0.0/api/studio-api-ref/en-us/';
    assert.equal(
      joinBasePath(ecaStage, 'reference/index.html#tag/Worksheets/operation/listWorksheets'),
      `${ecaStage}reference/index.html#tag/Worksheets/operation/listWorksheets`,
    );
  });

  it('rejects an absolute URL in path so origin cannot change', () => {
    assert.throws(() => joinBasePath(STUDIO_STAGE, 'https://evil.example/x'), /relative/);
    assert.throws(() => joinBasePath(STUDIO_STAGE, '//evil.example/x'), /relative/);
  });
});

describe('parseExtProtocol', () => {
  it('parses home as site with empty path', () => {
    assert.deepEqual(parseExtProtocol('ext://studio'), { site: 'studio', path: '' });
  });

  it('parses site plus path', () => {
    assert.deepEqual(parseExtProtocol('ext://studio/foo/bar.html'), {
      site: 'studio',
      path: 'foo/bar.html',
    });
  });

  it('keeps a Redoc hash on an eca path', () => {
    assert.deepEqual(
      parseExtProtocol('ext://eca/reference/index.html#tag/Worksheets/operation/listWorksheets'),
      {
        site: 'eca',
        path: 'reference/index.html#tag/Worksheets/operation/listWorksheets',
      },
    );
  });

  it('returns null for a non-ext URL', () => {
    assert.equal(parseExtProtocol('https://example.com'), null);
  });

  it('throws on an unknown site', () => {
    assert.throws(() => parseExtProtocol('ext://unknown'), /Unknown ext:\/\/ site/);
  });
});

describe('outboundEnvFromGithubOrigin', () => {
  it('selects stage when GITHUB_ORIGIN is unset', () => {
    assert.equal(outboundEnvFromGithubOrigin(undefined), 'stage');
  });

  it('selects prod only for the explicit official origin', () => {
    assert.equal(outboundEnvFromGithubOrigin(OFFICIAL_ORIGIN), 'prod');
  });

  it('selects stage for a non-official origin', () => {
    assert.equal(
      outboundEnvFromGithubOrigin('https://preview.example.com'),
      'stage',
    );
  });
});

describe('classifyHostname', () => {
  it('treats tableau.github.io as prod', () => {
    assert.equal(classifyHostname('tableau.github.io'), 'prod');
  });

  it('treats help.tableau.com /current/ as prod and /v0.0/ as stage', () => {
    assert.equal(classifyHostname('help.tableau.com'), 'prod');
    assert.equal(
      classifyHostname('help.tableau.com', '/current/api/studio-dev-guide/en-us/'),
      'prod',
    );
    assert.equal(
      classifyHostname('help.tableau.com', '/v0.0/api/studio-dev-guide/en-us/'),
      'stage',
    );
  });

  it('treats localhost and tabint as stage', () => {
    assert.equal(classifyHostname('localhost'), 'stage');
    assert.equal(classifyHostname('127.0.0.1'), 'stage');
    assert.equal(classifyHostname('help.vnext.tabint.net'), 'stage');
  });

  it('returns unknown for an unrecognized host', () => {
    assert.equal(classifyHostname('example.com'), 'unknown');
  });
});

describe('buildExtLinkModel', () => {
  it('bakes the published eca bases (/v0.0/ is stage, /current/ is prod)', () => {
    const ecaStage = 'https://help.tableau.com/v0.0/api/studio-api-ref/en-us/';
    const ecaProd = 'https://help.tableau.com/current/api/studio-api-ref/en-us/';
    const stage = buildExtLinkModel('eca', '', 'stage');
    assert.equal(stage.href, ecaStage);
    assert.equal(stage.prodHref, ecaProd);
    const prod = buildExtLinkModel('eca', '', 'prod');
    assert.equal(prod.href, ecaProd);
  });

  it('bakes stage href for studio locally and still emits prod href', () => {
    const model = buildExtLinkModel('studio', 'docs/intro', 'stage');
    assert.equal(model.href, `${STUDIO_STAGE}docs/intro`);
    assert.equal(model.prodHref, `${STUDIO_PROD}docs/intro`);
    assert.equal(model.stageHref, `${STUDIO_STAGE}docs/intro`);
    assert.equal(model.coming, false);
    const attrs = extLinkDataAttributes(model);
    assert.equal(attrs['data-stage-href'], `${STUDIO_STAGE}docs/intro`);
    assert.equal(attrs['data-prod-href'], `${STUDIO_PROD}docs/intro`);
    assert.equal(attrs['data-ext-link'], 'studio');
    assert.equal(attrs['data-coming'], undefined);
  });

  it('omits data-stage-href on a prod bake', () => {
    const model = buildExtLinkModel('studio', '', 'prod');
    assert.equal(model.href, STUDIO_PROD);
    assert.equal(model.emitStageHref, false);
    const attrs = extLinkDataAttributes(model);
    assert.equal(attrs['data-stage-href'], undefined);
    assert.equal(attrs['data-prod-href'], STUDIO_PROD);
  });

  it('marks coming-soon on stage when the site has no stage base', () => {
    const model = buildExtLinkModel('extensions', '', 'stage');
    assert.equal(model.href, '#');
    assert.equal(model.coming, true);
    assert.equal(model.prodHref, EXT_PROD);
    assert.equal(model.stageHref, undefined);
    const attrs = extLinkDataAttributes(model);
    assert.equal(attrs['data-coming'], EXT_COMING_RELEASE);
    assert.equal(attrs['data-stage-href'], undefined);
    assert.equal(attrs['data-prod-href'], EXT_PROD);
  });

  it('navigates to prod on a prod bake even when stage is missing', () => {
    const model = buildExtLinkModel('extensions', '', 'prod');
    assert.equal(model.href, EXT_PROD);
    assert.equal(model.coming, false);
    const attrs = extLinkDataAttributes(model);
    assert.equal(attrs['data-stage-href'], undefined);
    assert.equal(attrs['data-coming'], EXT_COMING_RELEASE);
  });
});

describe('hrefForViewer', () => {
  it('rewrites a stage-baked studio link to prod on a prod host', () => {
    const model = buildExtLinkModel('studio', 'x.html', 'stage');
    assert.deepEqual(hrefForViewer(model, 'prod'), {
      href: `${STUDIO_PROD}x.html`,
      coming: false,
    });
  });

  it('keeps coming-soon on stage when stage base is missing', () => {
    const model = buildExtLinkModel('packages', '', 'prod');
    assert.deepEqual(hrefForViewer(model, 'stage'), { href: '#', coming: true });
    assert.deepEqual(hrefForViewer(model, 'prod'), {
      href: 'https://help.tableau.com/current/api/packages-guide/',
      coming: false,
    });
  });
});
