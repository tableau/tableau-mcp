/**
 * Render a generated-index category description.
 *
 * Ordinary HTML (including https:// anchors) is injected as trusted author
 * content. `href="ext://site"` / `href="ext://site/path"` anchors are lifted
 * into ExtSiteLink so they follow the same stage/prod rewrite as markdown
 * `ext://` links.
 */
import ExtSiteLink from '@site/src/components/ExtSiteLink';
import {
  splitCategoryDescription,
  type CategoryDescriptionPart,
} from '@site/src/extLinks/categoryDescription';
import React, { type ReactElement } from 'react';

type Props = {
  html: string;
};

function renderPart(part: CategoryDescriptionPart, key: number): ReactElement | string {
  if (part.kind === 'ext') {
    return (
      <ExtSiteLink key={key} site={part.site} path={part.path || undefined}>
        {part.text}
      </ExtSiteLink>
    );
  }
  if (!part.html.includes('<')) {
    return part.html;
  }
  return <span key={key} dangerouslySetInnerHTML={{ __html: part.html }} />;
}

export default function CategoryDescription({ html }: Props): ReactElement {
  const parts = splitCategoryDescription(html);
  if (parts.length === 1 && parts[0].kind === 'html') {
    return <p dangerouslySetInnerHTML={{ __html: parts[0].html }} />;
  }
  return <p>{parts.map((part, i) => renderPart(part, i))}</p>;
}
