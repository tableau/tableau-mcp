import type * as Preset from '@docusaurus/preset-classic';
import type { Config } from '@docusaurus/types';
import { themes as prismThemes } from 'prism-react-renderer';

// Retired tool pages: their URLs are kept alive and pointed at the release notes,
// which is the one page that explains where the tool went. Maintained by
// .cursor/skills/format-tool-doc/scripts/retire-tool-page.mjs — a JSON data file so
// the tooling never has to edit this config.
import retiredToolRedirects from './src/data/retiredToolRedirects.json';
import { OFFICIAL_ORIGIN, outboundEnvFromGithubOrigin } from './src/extLinks/resolve';
import remarkExtLinks from './src/remark/extLinks.mjs';
import remarkVariables, { substituteVariables } from './src/remark/variables.mjs';
import sortToolsSidebar from './src/sidebar/sortToolsSidebar.mjs';

// The official public GitHub Pages origin. Any build whose GITHUB_ORIGIN is not
// this value is treated as an unofficial (e.g. an internal enterprise preview)
// build: it is served under a different base path and marked noIndex so it
// cannot be crawled or mistaken for the public site. Defaults preserve the
// public build.
const githubOrigin = process.env.GITHUB_ORIGIN ?? OFFICIAL_ORIGIN;
const isOfficial = githubOrigin === OFFICIAL_ORIGIN;
const basePath = process.env.GITHUB_BASE_PATH ?? '/tableau-mcp';
const baseUrl = basePath.endsWith('/') ? basePath : `${basePath}/`;
// Outbound sibling-docs env is independent of chrome: unset GITHUB_ORIGIN
// (local start/build) selects stage bases, even though chrome defaults official.
const extLinkEnv = outboundEnvFromGithubOrigin(process.env.GITHUB_ORIGIN);

const config: Config = {
  title: 'Tableau MCP',
  tagline: "Tableau's official MCP Server. Helping Agents see and understand data.",
  favicon: 'img/favicon.ico',
  trailingSlash: false,

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  // Set the production url of your site here. Overridable via GITHUB_ORIGIN so
  // an internal enterprise preview build can target a GitHub Enterprise Pages
  // origin; defaults to the official public origin.
  url: githubOrigin,
  // Set the /<baseUrl>/ pathname under which your site is served. Overridable
  // via GITHUB_BASE_PATH for the internal preview; defaults to '/tableau-mcp/'.
  baseUrl,

  // Keep internal/preview builds out of search engines; the public build indexes.
  noIndex: !isOfficial,

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: 'tableau', // Usually your GitHub org/user name.
  projectName: 'tableau-mcp', // Usually your repo name.
  deploymentBranch: 'main',

  onBrokenLinks: 'throw',
  onBrokenAnchors: 'throw',
  markdown: {
    mermaid: true,
    // Substitute `%token%` in the raw file before MDX compile so inline/fenced
    // code sees the expanded value, not the slug.
    preprocessor: ({ fileContent }) => substituteVariables(fileContent),
    // parseMarkdownFile builds the OG/meta excerpt from this returned `content`,
    // and that path never runs the MDX preprocessor or remark plugins — so the
    // first paragraph's `%coming_release%` would otherwise leak into <meta name=description>.
    parseFrontMatter: async ({ filePath, fileContent, defaultParseFrontMatter }) => {
      const parsed = await defaultParseFrontMatter({ filePath, fileContent });
      const frontMatter: { [key: string]: unknown } = {};
      for (const [key, value] of Object.entries(parsed.frontMatter)) {
        frontMatter[key] = typeof value === 'string' ? substituteVariables(value) : value;
      }
      return { frontMatter, content: substituteVariables(parsed.content) };
    },
    hooks: {
      onBrokenMarkdownLinks: 'throw',
    },
  },
  themes: ['@docusaurus/theme-mermaid'],

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  customFields: {
    extLinkEnv,
  },

  // Path is origin-absolute under baseUrl. A leading-slash `/llms.txt` would
  // resolve to tableau.github.io/llms.txt and 404; a page-relative `llms.txt`
  // would resolve to /docs/llms.txt on every doc page. `{baseUrl}llms.txt` is
  // the discovery copy generateLlmsTxt.mjs writes to static/llms.txt.
  headTags: [
    {
      tagName: 'link',
      attributes: {
        rel: 'describedby',
        href: `${baseUrl}llms.txt`,
        type: 'text/plain',
      },
    },
  ],

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          // Must run before Docusaurus' default remark plugins: the built-in link
          // resolver parses link URLs (and rejects a `%`-containing slug as an
          // invalid percent-escape), so ext:// rewrites and variable substitution
          // have to happen first. extLinks runs ahead of variables.
          beforeDefaultRemarkPlugins: [remarkExtLinks, remarkVariables],
          // Alpha-sort the Web Tools and Desktop Tools sub-folders;
          // every other nav level keeps its manual position/filename ordering.
          sidebarItemsGenerator: sortToolsSidebar,
          exclude: [
            // Docusaurus' own defaults (GlobExcludeDefault). Setting `exclude`
            // replaces rather than extends them, so they are repeated here.
            '**/_*.{js,jsx,ts,tsx,md,mdx}',
            '**/_*/**',
            '**/*.test.{js,jsx,ts,tsx}',
            '**/__tests__/**',
            // Review artifacts, not pages. Pin archives are snapshots of a page as it
            // stood at a source pin, named with that pin's 12-char hash
            // (`activate-sheet_abdd5aa26851.md`); drafts and `OLD` copies are
            // self-describing. Excluding them here keeps them out of the sidebar,
            // sitemap, tool catalog, and NDA PDF in one place instead of each consumer
            // filtering separately. They stay on disk for side-by-side review.
            '**/*_[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f].md',
            '**/*.[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f].md',
            '**/*_DRAFT.md',
            '**/*.DRAFT.md',
            '**/*_OLD.md',
            '**/*.OLD.md',
          ],
        },
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  // Preserve bookmarks/SEO after docs/docs/tools -> service-tools -> web-tools,
  // and external-client-tools -> desktop-tools.
  // Plugin emits HTML redirect pages for static hosts (GitHub Pages) and client-side
  // redirects for in-app navigation.
  plugins: [
    [
      '@docusaurus/plugin-client-redirects',
      {
        // Static redirects for routes that no longer exist. createRedirects below
        // cannot cover these: it maps aliases onto pages that are still built, and a
        // retired tool's page is gone.
        redirects: [
          ...retiredToolRedirects.map(({ from, to }) => ({ from, to })),
          // Developers / Extras used to be generated-index routes at /docs/category/<slug>.
          { from: '/docs/category/developers', to: '/docs/developers' },
          { from: '/docs/category/extras', to: '/docs/extras' },
          { from: '/docs/category/service-tools', to: '/docs/category/web-tools' },
          { from: '/docs/category/external-client-tools', to: '/docs/category/desktop-tools' },
          // The public site still serves this page under tools/workbooks. The workshop
          // page lives with the other Desktop workbook tools, so the same-path alias
          // from /docs/tools to /docs/web-tools does not cover it.
          {
            from: '/docs/tools/workbooks/publish-workbook',
            to: '/docs/desktop-tools/workbook/publish-workbook',
          },
        ],
        createRedirects(existingPath: string) {
          const aliases: string[] = [];
          if (existingPath.includes('/docs/web-tools')) {
            aliases.push(existingPath.replace('/docs/web-tools', '/docs/service-tools'));
            aliases.push(existingPath.replace('/docs/web-tools', '/docs/tools'));
          }
          if (existingPath.includes('/docs/desktop-tools')) {
            aliases.push(
              existingPath.replace('/docs/desktop-tools', '/docs/external-client-tools'),
            );
          }
          // Preserve bookmarks after renaming mcp-authoring-expertise -> tableau-authoring.
          if (existingPath.includes('/tableau-authoring')) {
            aliases.push(existingPath.replace('/tableau-authoring', '/mcp-authoring-expertise'));
          }
          return aliases.length ? aliases : undefined;
        },
      },
    ],
  ],

  themeConfig: {
    docs: {
      sidebar: {
        autoCollapseCategories: true,
      },
    },
    // Replace with your project's social card
    navbar: {
      title: 'Tableau MCP',
      logo: {
        alt: 'Tableau MCP Logo',
        src: 'img/tableau.svg',
        srcDark: 'img/tableau_white.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'documentationSidebar',
          position: 'left',
          label: 'Documentation',
        },
        {
          href: 'https://github.com/tableau/tableau-mcp',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      copyright: `Copyright ©${new Date().getFullYear()} Salesforce, Inc. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
