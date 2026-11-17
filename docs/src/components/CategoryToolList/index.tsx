import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import type { PropSidebarItem } from '@docusaurus/plugin-content-docs';
import Heading from '@theme/Heading';
import { type ReactNode, useMemo } from 'react';

import rawCatalog from '@site/src/data/toolCatalog.json';
import styles from './styles.module.css';

// Entry shape produced by docs/scripts/generateToolCatalog.mjs (a build-time
// projection of the tool doc pages). Same data the top-level ToolCatalog reads.
type ToolEntry = {
  toolName: string;
  title: string;
  summary: string;
  toolType: string;
  toolCategory: string;
  toolCategoryDescription: string;
  docPath: string;
};

const catalog = rawCatalog as ToolEntry[];
const byDocPath = new Map(catalog.map((entry) => [entry.docPath, entry]));
// Tool names are globally unique (they key docs/src/data/toolTaxonomy.json), so the
// last route segment is a safe fallback join when a docPath does not match exactly.
const byToolName = new Map(catalog.map((entry) => [entry.toolName, entry]));

type ListEntry = { docPath: string; title: string; summary: string };

/**
 * Plain list of the tools in one category, rendered by the swizzled
 * DocCategoryGeneratedIndexPage in place of the default card grid.
 *
 * `items` is the category's own sidebar items, so the set and the order always
 * match the left nav. Titles and summaries come from the generated tool catalog,
 * which derives them from each page's H1 and opening sentence — the same strings
 * the top-level tool catalog shows.
 */
export default function CategoryToolList({ items }: { items: PropSidebarItem[] }): ReactNode {
  const {
    siteConfig: { baseUrl },
  } = useDocusaurusContext();

  const entries = useMemo<ListEntry[]>(() => {
    // Sidebar hrefs are permalinks and carry the baseUrl; catalog docPaths do not.
    const base = baseUrl.replace(/\/+$/, '');
    return items.flatMap((item) => {
      const href = 'href' in item ? item.href : undefined;
      if (!href) return [];
      const docPath = base && href.startsWith(`${base}/`) ? href.slice(base.length) : href;
      const tool = byDocPath.get(docPath) ?? byToolName.get(docPath.split('/').pop() ?? '');
      const label = 'label' in item ? item.label : undefined;
      const title = tool?.title ?? label;
      if (!title) return [];
      return [{ docPath, title, summary: tool?.summary ?? '' }];
    });
  }, [items, baseUrl]);

  if (entries.length === 0) {
    return null;
  }

  return (
    <div className={styles.root}>
      <Heading as="h2" className={styles.heading}>
        This category contains the tools:
      </Heading>
      <ul className={styles.list}>
        {entries.map((entry) => (
          <li key={entry.docPath}>
            <Link to={entry.docPath} className={styles.title}>
              {entry.title}
            </Link>
            {entry.summary && (
              <span className={styles.summary}>
                : {entry.summary}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
