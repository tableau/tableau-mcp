import Link from '@docusaurus/Link';
import type { ReactNode } from 'react';

import styles from './styles.module.css';

type CardItem = {
  title: string;
  href: string;
  description: string;
  icon: ReactNode;
};

const cards: CardItem[] = [
  {
    title: 'Getting Started',
    href: '/tableau-mcp/docs/getting-started',
    description:
      'Quick start guide to connect your AI tool to Tableau. Configure authentication and run your first query in minutes.',
    icon: (
      <svg viewBox="0 0 80 80" className={styles.cardIcon} aria-hidden="true">
        <circle cx="40" cy="40" r="38" fill="#e8f4f8" />
        <path
          d="M32 24 L32 56 L58 40 Z"
          fill="#4CAF50"
          stroke="#388E3C"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    title: 'Hosted Tableau MCP',
    href: '/tableau-mcp/docs/hosted-tableau-mcp',
    description:
      'Tableau MCP as a managed cloud service — no installation required. OAuth 2.1 secured and available to all Tableau Cloud customers.',
    icon: (
      <svg viewBox="0 0 80 80" className={styles.cardIcon} aria-hidden="true">
        <circle cx="40" cy="40" r="38" fill="#e8f4f8" />
        <path
          d="M26 52
             a10 10 0 0 1 -2 -19.6
             a12 12 0 0 1 23.6 -3.4
             a9 9 0 0 1 14.4 7
             a9 9 0 0 1 -2 16
             Z"
          fill="#5B9BD5"
          stroke="#3A7FC1"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
    ),
  },
  {
    title: 'Enterprise Deployment',
    href: '/tableau-mcp/docs/enterprise',
    description:
      'Deploy Tableau MCP for your organization. Covers Tableau Cloud and Server configuration, OAuth setup, and production best practices.',
    icon: (
      <svg viewBox="0 0 80 80" className={styles.cardIcon} aria-hidden="true">
        <circle cx="40" cy="40" r="38" fill="#e8f4f8" />
        <rect x="20" y="28" width="40" height="28" rx="3" fill="#82BEEA" />
        <rect x="26" y="22" width="28" height="10" rx="2" fill="#5B9BD5" />
        <rect x="32" y="16" width="16" height="8" rx="2" fill="#3A7FC1" />
        <rect x="30" y="40" width="8" height="10" rx="1" fill="#fff" opacity="0.8" />
        <rect x="42" y="40" width="8" height="10" rx="1" fill="#fff" opacity="0.8" />
        <rect x="36" y="50" width="8" height="6" rx="1" fill="#fff" opacity="0.6" />
      </svg>
    ),
  },
  {
    title: 'Developers',
    href: '/tableau-mcp/docs/category/developers',
    description:
      'Build on top of Tableau MCP. Contributing guidelines, local development setup, tool authoring, testing, and debugging resources.',
    icon: (
      <svg viewBox="0 0 80 80" className={styles.cardIcon} aria-hidden="true">
        <circle cx="40" cy="40" r="38" fill="#e8f4f8" />
        <rect x="16" y="24" width="48" height="34" rx="4" fill="#F5A623" opacity="0.2" />
        <rect
          x="16"
          y="24"
          width="48"
          height="34"
          rx="4"
          fill="none"
          stroke="#F5A623"
          strokeWidth="2.5"
        />
        <polyline
          points="28,36 22,42 28,48"
          fill="none"
          stroke="#F5A623"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <polyline
          points="52,36 58,42 52,48"
          fill="none"
          stroke="#F5A623"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <line
          x1="44"
          y1="32"
          x2="36"
          y2="52"
          stroke="#F5A623"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
    ),
  },
];

function Card({ title, href, description, icon }: CardItem) {
  return (
    <Link to={href} className={styles.card}>
      <div className={styles.cardIconWrapper}>{icon}</div>
      <div className={styles.cardTitle}>{title}</div>
      <p className={styles.cardDescription}>{description}</p>
    </Link>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className={styles.grid}>
          {cards.map((card) => (
            <Card key={card.href} {...card} />
          ))}
        </div>
      </div>
    </section>
  );
}
