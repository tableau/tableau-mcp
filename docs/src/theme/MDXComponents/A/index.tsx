/**
 * Swizzled (wrapped) from @docusaurus/theme-classic.
 *
 * Only change vs. upstream: after rendering the link, if it points off-site
 * (an absolute http/https URL) we append a small external-link icon. Internal
 * doc links are rewritten to protocol-less, root-relative paths before they
 * reach this component, so they never match and stay unadorned.
 */
import React, { type ComponentProps, type ReactElement } from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import { useAnchorTargetClassName } from '@docusaurus/theme-common';

import ExtLink from '@site/src/components/ExtLink';

function isExternalHref(href: string | undefined): boolean {
  return !!href && /^https?:\/\//i.test(href);
}

export default function MDXA(props: ComponentProps<'a'>): ReactElement {
  const anchorTargetClassName = useAnchorTargetClassName(props.id);
  const link = <Link {...props} className={clsx(anchorTargetClassName, props.className)} />;

  if (!isExternalHref(props.href)) {
    return link;
  }

  return (
    <>
      {link}
      <ExtLink />
    </>
  );
}
