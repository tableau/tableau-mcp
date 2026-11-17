import Link from '@docusaurus/Link';
import { type ReactNode, useMemo, useState } from 'react';

import rawCatalog from '@site/src/data/toolCatalog.json';
import styles from './styles.module.css';

// Entry shape produced by docs/scripts/generateToolCatalog.mjs (a build-time
// projection of the tool doc pages).
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

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function toggle<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}

type CategoryGroup = { category: string; description: string; items: ToolEntry[] };

/**
 * Auto-updating, filterable list of tools for a single tool home (Web Tools
 * or Desktop Tools). Rendered by the swizzled DocCategoryGeneratedIndexPage
 * in place of the default cards + paginator. `toolType` is fixed by the page, so
 * there is no tool-type facet here — only keyword + category filters.
 */
export default function ToolCatalog({ toolType }: { toolType: string }): ReactNode {
  const scoped = useMemo(
    () => catalog.filter((entry) => entry.toolType === toolType),
    [toolType],
  );

  const allCategories = useMemo(
    () => uniqueSorted(scoped.map((entry) => entry.toolCategory)),
    [scoped],
  );

  const [keyword, setKeyword] = useState('');
  // Empty set = no constraint (show all categories). Checked values are OR'd.
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(() => new Set());

  const allSelected =
    allCategories.length > 0 && allCategories.every((c) => selectedCategories.has(c));
  const hasActiveFilter = selectedCategories.size > 0 || keyword.trim() !== '';

  const clearAll = () => {
    setSelectedCategories(new Set());
    setKeyword('');
  };

  const setAllCategories = (select: boolean) => {
    setSelectedCategories(select ? new Set(allCategories) : new Set());
  };

  const groups = useMemo<CategoryGroup[]>(() => {
    const kw = keyword.trim().toLowerCase();
    const byCategory = new Map<string, ToolEntry[]>();
    for (const entry of scoped) {
      if (selectedCategories.size > 0 && !selectedCategories.has(entry.toolCategory)) continue;
      if (kw) {
        const haystack =
          `${entry.title} ${entry.summary} ${entry.toolCategory} ${entry.toolName}`.toLowerCase();
        if (!haystack.includes(kw)) continue;
      }
      if (!byCategory.has(entry.toolCategory)) byCategory.set(entry.toolCategory, []);
      byCategory.get(entry.toolCategory)!.push(entry);
    }
    return Array.from(byCategory.keys())
      .sort((a, b) => a.localeCompare(b))
      .map((category) => {
        const items = byCategory.get(category)!.sort((a, b) => a.title.localeCompare(b.title));
        return { category, description: items[0]?.toolCategoryDescription ?? '', items };
      });
  }, [scoped, keyword, selectedCategories]);

  const matchCount = useMemo(
    () => groups.reduce((n, g) => n + g.items.length, 0),
    [groups],
  );

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headerTop}>
          <span className={styles.headerTitle}>Filter tools</span>
          <span className={styles.count}>
            {matchCount} of {scoped.length}
          </span>
          <button
            type="button"
            className={styles.pill}
            onClick={clearAll}
            disabled={!hasActiveFilter}
          >
            Reset
          </button>
        </div>

        <div className={styles.field}>
          <span className={styles.fieldLabel}>Keyword</span>
          <input
            type="text"
            className={styles.keyword}
            value={keyword}
            placeholder="Filter by name, description, or category..."
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>

        {allCategories.length > 1 && (
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Category</span>
            <div className={styles.categoryFacet}>
              <button
                type="button"
                className={`${styles.allButton}${allSelected ? ` ${styles.allButtonActive}` : ''}`}
                onClick={() => setAllCategories(!allSelected)}
              >
                All
              </button>
              <div className={styles.checks}>
                {allCategories.map((category) => (
                  <label key={category} className={styles.check}>
                    <input
                      type="checkbox"
                      checked={selectedCategories.has(category)}
                      onChange={() => setSelectedCategories((prev) => toggle(prev, category))}
                    />
                    {category}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {groups.length === 0 ? (
        <p className={styles.empty}>No tools match the selected filters.</p>
      ) : (
        groups.map((group) => (
          <section key={group.category} className={styles.category}>
            <h2 className={styles.categoryHeading}>
              <span className={styles.categoryName}>{group.category}</span>
              {group.description && (
                <span className={styles.categoryDesc}> {group.description}</span>
              )}
            </h2>
            <ul className={styles.list}>
              {group.items.map((entry) => (
                <li key={entry.toolName}>
                  <Link to={entry.docPath} className={styles.title}>
                    {entry.title}
                  </Link>{' '}
                  <span className={styles.summary}>{entry.summary}</span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
