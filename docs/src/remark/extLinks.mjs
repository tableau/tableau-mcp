/**
 * Rewrite `[text](ext://site)` and `[text](ext://site/path)` markdown links to
 * `<ExtSiteLink site path>` JSX so Docusaurus' link resolver never sees the
 * custom protocol (it would throw under onBrokenMarkdownLinks).
 *
 * Must run in beforeDefaultRemarkPlugins, ahead of remarkVariables.
 *
 * Reference-style definitions (`[label]: ext://site`) are rejected: they cannot
 * carry the data attributes ExtSiteLink needs. Write an inline link instead.
 */

const EXT_PROTOCOL = /^ext:\/\/([^/]+)(?:\/(.*))?$/;
const VALID_SITES = new Set(['studio', 'eca', 'extensions', 'packages']);

export function parseExtProtocol(url) {
  const match = EXT_PROTOCOL.exec(url);
  if (!match) return null;
  const site = match[1];
  const path = (match[2] ?? '').replace(/^\/+/, '');
  if (!VALID_SITES.has(site)) {
    throw new Error(
      `Unknown ext:// site "${site}". Valid sites: ${[...VALID_SITES].join(', ')}`,
    );
  }
  return { site, path };
}

function toExtSiteLink(parsed, children) {
  const attributes = [{ type: 'mdxJsxAttribute', name: 'site', value: parsed.site }];
  if (parsed.path) {
    attributes.push({ type: 'mdxJsxAttribute', name: 'path', value: parsed.path });
  }
  return {
    type: 'mdxJsxTextElement',
    name: 'ExtSiteLink',
    attributes,
    children: children ?? [],
  };
}

function walk(node, index, parent) {
  if (node.type === 'link' && typeof node.url === 'string') {
    const parsed = parseExtProtocol(node.url);
    if (parsed && parent && typeof index === 'number') {
      parent.children[index] = toExtSiteLink(parsed, node.children);
      return;
    }
  }
  if (node.type === 'definition' && typeof node.url === 'string') {
    const parsed = parseExtProtocol(node.url);
    if (parsed) {
      throw new Error(
        `ext:// links cannot be used as reference definitions ([${node.identifier}]); ` +
          'write an inline [text](ext://site/path) link.',
      );
    }
  }
  if (Array.isArray(node.children)) {
    for (let i = 0; i < node.children.length; i++) {
      walk(node.children[i], i, node);
    }
  }
}

export default function remarkExtLinks() {
  return (tree) => {
    walk(tree);
  };
}
