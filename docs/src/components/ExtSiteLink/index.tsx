/**
 * Env-aware outbound link to a registered sibling docs site (studio, eca,
 * extensions, packages). Bakes href from customFields.extLinkEnv; on hydrate,
 * rewrites from hostname if the artifact is being read in the other environment.
 *
 * When the viewer is stage/local and the site has no stage base, click shows a
 * coming-soon dialog instead of navigating. Production always follows prod href.
 */
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import ExtLink from '@site/src/components/ExtLink';
import {
  buildExtLinkModel,
  classifyHostname,
  extLinkDataAttributes,
  hrefForViewer,
  type ExtLinkEnv,
} from '@site/src/extLinks/resolve';
import React, {
  useEffect,
  useId,
  useMemo,
  useState,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react';

type Props = {
  site: string;
  path?: string;
  children?: ReactNode;
};

function bakedEnvFromConfig(value: unknown): ExtLinkEnv {
  return value === 'prod' ? 'prod' : 'stage';
}

export default function ExtSiteLink({ site, path = '', children }: Props): ReactElement {
  const { siteConfig } = useDocusaurusContext();
  const bakedEnv = bakedEnvFromConfig(siteConfig.customFields?.extLinkEnv);
  const model = useMemo(() => buildExtLinkModel(site, path, bakedEnv), [site, path, bakedEnv]);
  const dataAttrs = extLinkDataAttributes(model);

  const [href, setHref] = useState(model.href);
  const [coming, setComing] = useState(model.coming);
  const [dialogOpen, setDialogOpen] = useState(false);
  const titleId = useId();

  useEffect(() => {
    const viewer = classifyHostname(window.location.hostname, window.location.pathname);
    const next = hrefForViewer(model, viewer);
    setHref(next.href);
    setComing(next.coming);
  }, [model]);

  useEffect(() => {
    if (!dialogOpen) return undefined;
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') setDialogOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dialogOpen]);

  function onClick(event: MouseEvent<HTMLAnchorElement>): void {
    const viewer = classifyHostname(window.location.hostname, window.location.pathname);
    const next = hrefForViewer(model, viewer);
    if (next.coming) {
      event.preventDefault();
      setDialogOpen(true);
    }
  }

  function hideDialog(): void {
    setDialogOpen(false);
  }

  return (
    <>
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        role={coming ? 'button' : undefined}
        onClick={onClick}
        {...dataAttrs}
      >
        {children}
      </a>
      <ExtLink />
      {dialogOpen && (
        <div
          className="ext-coming-backdrop"
          onClick={(event) => {
            if (event.target === event.currentTarget) hideDialog();
          }}
        >
          <div
            className="ext-coming-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={titleId}
          >
            <p id={titleId} className="ext-coming-message">
              Coming in the {model.comingRelease} release.
            </p>
            <button type="button" className="ext-coming-ok" onClick={hideDialog} autoFocus>
              OK
            </button>
          </div>
        </div>
      )}
    </>
  );
}
