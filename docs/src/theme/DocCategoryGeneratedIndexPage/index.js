/**
 * Swizzled (ejected) from @docusaurus/theme-classic.
 *
 * Three changes vs. upstream:
 * 1. The generated-index `description` is rendered as HTML rather than an escaped
 *    string, so a `_category_.json` description can contain inline HTML such as
 *    `<a href="…">…</a>`. Sibling-docs URLs use `href="ext://site"` and are rendered
 *    through ExtSiteLink (same stage/prod rewrite as markdown `ext://` links). The
 *    default theme renders `<p>{description}</p>`, which escapes any markup. Category
 *    descriptions are author-controlled trusted content, so injecting HTML here is
 *    safe.
 * 2. On the two top-level tool homes (Web Tools / Desktop Tools), the default
 *    cards + prev/next are replaced by the auto-updating, filterable <ToolCatalog>. The
 *    switch is by category label so the earlier docs/tools -> docs/web-tools rename
 *    does not affect it.
 * 3. Every other generated-index page (tool sub-categories like Workbooks, Pulse, …)
 *    renders <CategoryToolList> — a plain list of its tools with a one-line summary
 *    each — instead of the default card grid and prev/next paginator. A card grid
 *    buries the summary a reader is scanning for, and the paginator's "next" walked
 *    into an unrelated category. Both were also what the deleted per-group overview.md
 *    stubs had been standing in for. Non-tool parent categories (Developers, Extras,
 *    Configuration, …) use a markdown index with the same list shape.
 */
import { useCurrentSidebarCategory } from '@docusaurus/plugin-content-docs/client';
import { PageMetadata } from '@docusaurus/theme-common';
import useBaseUrl from '@docusaurus/useBaseUrl';
import CategoryDescription from '@site/src/components/CategoryDescription';
import CategoryToolList from '@site/src/components/CategoryToolList';
import ToolCatalog from '@site/src/components/ToolCatalog';
import DocBreadcrumbs from '@theme/DocBreadcrumbs';
import DocVersionBadge from '@theme/DocVersionBadge';
import DocVersionBanner from '@theme/DocVersionBanner';
import Heading from '@theme/Heading';
import React from 'react';

import styles from './styles.module.css';

// Category labels whose generated-index home renders the filterable tool catalog
// (scoped to that tool type) instead of the default cards + paginator. The label
// doubles as the `toolType` passed to <ToolCatalog>, matching TOOL_TYPE_BY_ROOT in
// docs/scripts/generateToolCatalog.mjs.
const TOOL_HOME_LABELS = new Set(['Web Tools', 'Desktop Tools']);

/** @returns {import('react').JSX.Element} */
function DocCategoryGeneratedIndexPageMetadata({ categoryGeneratedIndex }) {
  // The visible description may contain inline HTML (e.g. anchors); strip tags for
  // the plain-text SEO <meta description>.
  const metaDescription = categoryGeneratedIndex.description?.replace(/<[^>]+>/g, '');
  return (
    <PageMetadata
      title={categoryGeneratedIndex.title}
      description={metaDescription}
      keywords={categoryGeneratedIndex.keywords}
      image={useBaseUrl(categoryGeneratedIndex.image)}
    />
  );
}

/** @returns {import('react').JSX.Element} */
function DocCategoryGeneratedIndexPageContent({ categoryGeneratedIndex }) {
  const category = useCurrentSidebarCategory();
  const isToolHome = TOOL_HOME_LABELS.has(category.label);
  return (
    <div className={styles.generatedIndexPage}>
      <DocVersionBanner />
      <DocBreadcrumbs />
      <DocVersionBadge />
      <header>
        <Heading as="h1" className={styles.title}>
          {categoryGeneratedIndex.title}
        </Heading>
        {categoryGeneratedIndex.description && (
          <CategoryDescription html={categoryGeneratedIndex.description} />
        )}
      </header>
      <article className="margin-top--lg">
        {isToolHome ? (
          <ToolCatalog toolType={category.label} />
        ) : (
          <CategoryToolList items={category.items} />
        )}
      </article>
    </div>
  );
}

/** @returns {import('react').JSX.Element} */
export default function DocCategoryGeneratedIndexPage(props) {
  return (
    <>
      <DocCategoryGeneratedIndexPageMetadata {...props} />
      <DocCategoryGeneratedIndexPageContent {...props} />
    </>
  );
}
