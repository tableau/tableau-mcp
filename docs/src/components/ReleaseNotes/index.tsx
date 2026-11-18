import Link from '@docusaurus/Link';
import { type ReactNode, useMemo, useState } from 'react';

import rawEntries from '@site/src/data/releaseNotes.json';
import rawSiteContent from '@site/src/data/releaseSiteContent.json';
import styles from './styles.module.css';

type ChangeType = 'ADD' | 'UPDATE' | 'DEPRECATE' | 'RETIRE';

type ReleaseNoteEntry = {
  title: string;
  summary: string;
  date: string;
  changeType: ChangeType;
  toolCategory: string;
  // Distinguishes where the tool runs: 'Web Tools' vs 'Desktop Tools'.
  toolType: string;
  toolName: string;
  docPath: string | null;
  // Optional: package version at the change's source pin (not displayed).
  version?: string;
  // Git pin: SHA of the initial commit that introduced this change (source-pin provenance).
  sourceCommit?: string;
};

const entries = rawEntries as ReleaseNoteEntry[];

// Per-release "Highlights": a short, hand-curated overview shown atop a release's
// stack of tool changes — major additions (e.g. a new tool family), page/docs
// updates, and site features. Curated in releaseSiteContent.json, kept separate
// from the derived tool changelog below it.
type SiteContentEntry = {
  date: string;
  summary: string;
};

const siteContent = rawSiteContent as SiteContentEntry[];

const CHANGE_TYPE_ORDER: ChangeType[] = ['ADD', 'UPDATE', 'DEPRECATE', 'RETIRE'];

const TOOL_TYPE_ORDER: string[] = ['Web Tools', 'Desktop Tools'];

const badgeClass: Record<ChangeType, string> = {
  ADD: styles.badgeAdd,
  UPDATE: styles.badgeUpdate,
  DEPRECATE: styles.badgeDeprecate,
  RETIRE: styles.badgeRetire,
};

function formatMonthYear(isoDate: string): string {
  // Parse as UTC so the rendered month is stable regardless of the reader's timezone.
  const [year, month] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(year, (month ?? 1) - 1, 1));
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

function sortWithinCategory(items: ReleaseNoteEntry[]): ReleaseNoteEntry[] {
  return [...items].sort(
    (a, b) =>
      CHANGE_TYPE_ORDER.indexOf(a.changeType) - CHANGE_TYPE_ORDER.indexOf(b.changeType) ||
      a.title.localeCompare(b.title),
  );
}

type CategoryGroup = { category: string; items: ReleaseNoteEntry[] };
type ToolTypeGroup = { toolType: string; categories: CategoryGroup[] };
type MonthGroup = { key: string; label: string; toolTypes: ToolTypeGroup[] };

function toolTypeRank(toolType: string): number {
  const i = TOOL_TYPE_ORDER.indexOf(toolType);
  return i === -1 ? TOOL_TYPE_ORDER.length : i;
}

function groupByMonthThenToolTypeThenCategory(items: ReleaseNoteEntry[]): MonthGroup[] {
  // month -> toolType -> category -> entries
  const byMonth = new Map<string, Map<string, Map<string, ReleaseNoteEntry[]>>>();
  const monthLabel = new Map<string, string>();
  for (const item of items) {
    const monthKey = item.date.slice(0, 7);
    if (!byMonth.has(monthKey)) {
      byMonth.set(monthKey, new Map());
      monthLabel.set(monthKey, formatMonthYear(item.date));
    }
    const byToolType = byMonth.get(monthKey)!;
    if (!byToolType.has(item.toolType)) byToolType.set(item.toolType, new Map());
    const byCategory = byToolType.get(item.toolType)!;
    if (!byCategory.has(item.toolCategory)) byCategory.set(item.toolCategory, []);
    byCategory.get(item.toolCategory)!.push(item);
  }

  return Array.from(byMonth.keys())
    .sort((a, b) => b.localeCompare(a)) // newest month first
    .map((monthKey) => ({
      key: monthKey,
      label: monthLabel.get(monthKey)!,
      toolTypes: Array.from(byMonth.get(monthKey)!.entries())
        .sort((a, b) => toolTypeRank(a[0]) - toolTypeRank(b[0]) || a[0].localeCompare(b[0]))
        .map(([toolType, byCategory]) => ({
          toolType,
          categories: Array.from(byCategory.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([category, catItems]) => ({ category, items: sortWithinCategory(catItems) })),
        })),
    }));
}

function ChangeBadge({ type }: { type: ChangeType }): ReactNode {
  return <span className={`${styles.badge} ${badgeClass[type]}`}>{type}</span>;
}

function TitleAndSummary({ entry }: { entry: ReleaseNoteEntry }): ReactNode {
  return (
    <>
      {entry.docPath ? (
        <Link to={entry.docPath} className={styles.title}>
          {entry.title}
        </Link>
      ) : (
        <span className={styles.title}>{entry.title}</span>
      )}{' '}
      <span className={styles.summary}>{entry.summary}</span>
    </>
  );
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

export default function ReleaseNotes(): ReactNode {
  const allChangeTypes = useMemo(
    () => CHANGE_TYPE_ORDER.filter((type) => entries.some((entry) => entry.changeType === type)),
    [],
  );
  // Categories grouped under their tool type (Web Tools first, then External
  // Client Tools). A category (e.g. "Workbooks") can exist under both types, so
  // selections are keyed by `toolType::category` to keep the two distinct.
  const categoryGroups = useMemo(() => {
    const byType = new Map<string, Set<string>>();
    for (const entry of entries) {
      if (!byType.has(entry.toolType)) byType.set(entry.toolType, new Set());
      byType.get(entry.toolType)!.add(entry.toolCategory);
    }
    return Array.from(byType.keys())
      .sort((a, b) => {
        const rank = (t: string) => {
          const i = TOOL_TYPE_ORDER.indexOf(t);
          return i === -1 ? TOOL_TYPE_ORDER.length : i;
        };
        return rank(a) - rank(b) || a.localeCompare(b);
      })
      .map((toolType) => ({ toolType, categories: uniqueSorted([...byType.get(toolType)!]) }));
  }, []);

  // Distinct release dates, newest first, for the "release" dropdown.
  const allReleases = useMemo(
    () =>
      Array.from(new Set(entries.map((entry) => entry.date)))
        .sort((a, b) => b.localeCompare(a))
        .map((date) => ({ date, label: formatMonthYear(date) })),
    [],
  );

  const [keyword, setKeyword] = useState('');
  // '' = All releases (no date constraint).
  const [selectedRelease, setSelectedRelease] = useState('');
  // Empty set = no constraint for that facet (show all). Checked values are OR'd
  // within a facet; facets are AND'd together; keyword is AND'd on top.
  const [selectedTypes, setSelectedTypes] = useState<Set<string>>(() => new Set());
  // Keyed by `toolType::category`.
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(() => new Set());

  const hasActiveFilter =
    selectedTypes.size > 0 ||
    selectedCategories.size > 0 ||
    selectedRelease !== '' ||
    keyword.trim() !== '';

  const clearAll = () => {
    setSelectedTypes(new Set());
    setSelectedCategories(new Set());
    setSelectedRelease('');
    setKeyword('');
  };

  // Bulk add/remove a group's category keys (used by the per-tool-type "All" button).
  const setGroupSelection = (keys: string[], select: boolean) => {
    setSelectedCategories((prev) => {
      const next = new Set(prev);
      for (const key of keys) {
        if (select) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  };

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return entries.filter((entry) => {
      if (selectedRelease && entry.date !== selectedRelease) return false;
      if (selectedTypes.size > 0 && !selectedTypes.has(entry.changeType)) return false;
      if (
        selectedCategories.size > 0 &&
        !selectedCategories.has(`${entry.toolType}::${entry.toolCategory}`)
      ) {
        return false;
      }
      if (kw) {
        const haystack =
          `${entry.title} ${entry.summary} ${entry.toolCategory} ${entry.toolName}`.toLowerCase();
        if (!haystack.includes(kw)) return false;
      }
      return true;
    });
  }, [keyword, selectedRelease, selectedTypes, selectedCategories]);

  const months = useMemo(() => groupByMonthThenToolTypeThenCategory(filtered), [filtered]);

  // Site-content synopsis is global to a release (not a tool), so it honors only
  // the release + keyword filters, not the change-type/category tool facets.
  const siteByMonth = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    const byMonth = new Map<string, SiteContentEntry[]>();
    for (const entry of siteContent) {
      if (selectedRelease && entry.date !== selectedRelease) continue;
      if (kw && !entry.summary.toLowerCase().includes(kw)) continue;
      const monthKey = entry.date.slice(0, 7);
      if (!byMonth.has(monthKey)) byMonth.set(monthKey, []);
      byMonth.get(monthKey)!.push(entry);
    }
    return byMonth;
  }, [keyword, selectedRelease]);

  // Ordered month keys to render (newest first): every month with matching tool
  // changes, plus site-content-only months — but only surface a tool-less month
  // when no tool facet is narrowing the view, so a category/type filter never
  // conjures an otherwise-empty release section.
  const toolFacetActive = selectedTypes.size > 0 || selectedCategories.size > 0;
  const monthOrder = useMemo(() => {
    const keys = new Set(months.map((m) => m.key));
    if (!toolFacetActive) for (const key of siteByMonth.keys()) keys.add(key);
    return Array.from(keys).sort((a, b) => b.localeCompare(a));
  }, [months, siteByMonth, toolFacetActive]);

  const monthByKey = useMemo(() => new Map(months.map((m) => [m.key, m])), [months]);

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.headerTop}>
          <span className={styles.headerTitle}>Filter changes</span>
          <select
            className={styles.release}
            value={selectedRelease}
            onChange={(e) => setSelectedRelease(e.target.value)}
            aria-label="Release"
          >
            <option value="">All releases</option>
            {allReleases.map((r) => (
              <option key={r.date} value={r.date}>
                {r.label}
              </option>
            ))}
          </select>
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
            placeholder="Filter by title, description, category, or tool name..."
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>

        {allChangeTypes.length > 1 && (
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Change type</span>
            <div className={styles.checks}>
              {allChangeTypes.map((type) => (
                <label key={type} className={styles.check}>
                  <input
                    type="checkbox"
                    checked={selectedTypes.has(type)}
                    onChange={() => setSelectedTypes((prev) => toggle(prev, type))}
                  />
                  <ChangeBadge type={type} />
                </label>
              ))}
            </div>
          </div>
        )}

        <div className={styles.field}>
          <span className={styles.fieldLabel}>Category</span>
          <div className={styles.groups}>
            {categoryGroups.map((group) => {
              const keys = group.categories.map((cat) => `${group.toolType}::${cat}`);
              const allSelected = keys.length > 0 && keys.every((k) => selectedCategories.has(k));
              return (
                <div key={group.toolType} className={styles.group}>
                  <div className={styles.groupHeader}>
                    <span className={styles.groupLabel}>{group.toolType}</span>
                    <button
                      type="button"
                      className={`${styles.allButton}${allSelected ? ` ${styles.allButtonActive}` : ''}`}
                      onClick={() => setGroupSelection(keys, !allSelected)}
                    >
                      All
                    </button>
                  </div>
                  <div className={styles.checks}>
                    {group.categories.map((cat) => {
                      const key = `${group.toolType}::${cat}`;
                      return (
                        <label key={key} className={styles.check}>
                          <input
                            type="checkbox"
                            checked={selectedCategories.has(key)}
                            onChange={() => setSelectedCategories((prev) => toggle(prev, key))}
                          />
                          {cat}
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {monthOrder.length === 0 ? (
        <p className={styles.empty}>No changes match the selected filters.</p>
      ) : (
        monthOrder.map((monthKey) => {
          const month = monthByKey.get(monthKey);
          const site = siteByMonth.get(monthKey) ?? [];
          return (
            <section key={monthKey} className={styles.month}>
              <h2 className={styles.monthHeading}>
                {month?.label ?? formatMonthYear(`${monthKey}-01`)}
              </h2>
              {site.length > 0 && (
                <div className={styles.synopsis}>
                  <span className={styles.synopsisLabel}>Highlights</span>
                  {site.length === 1 ? (
                    <p className={styles.synopsisText}>{site[0].summary}</p>
                  ) : (
                    <ul className={styles.synopsisList}>
                      {site.map((entry, i) => (
                        <li key={i}>{entry.summary}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
              {(month?.toolTypes ?? []).map((typeGroup) => (
                <div key={typeGroup.toolType} className={styles.toolTypeGroup}>
                  <h3 className={styles.toolTypeHeading}>{typeGroup.toolType}</h3>
                  <ul className={styles.list}>
                    {typeGroup.categories.map((group) =>
                      group.items.length === 1 ? (
                        <li key={group.category}>
                          <span className={styles.category}>{group.category}</span>{' '}
                          <ChangeBadge type={group.items[0].changeType} />{' '}
                          <TitleAndSummary entry={group.items[0]} />
                        </li>
                      ) : (
                        <li key={group.category}>
                          <span className={styles.category}>{group.category}</span>
                          <ul className={styles.sublist}>
                            {group.items.map((entry) => (
                              <li key={`${entry.toolName}-${entry.changeType}`}>
                                <ChangeBadge type={entry.changeType} />{' '}
                                <TitleAndSummary entry={entry} />
                              </li>
                            ))}
                          </ul>
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              ))}
            </section>
          );
        })
      )}
    </div>
  );
}
