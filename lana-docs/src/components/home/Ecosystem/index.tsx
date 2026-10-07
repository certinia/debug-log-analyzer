import Link from '@docusaurus/Link';
import CodeBlock from '@theme/CodeBlock';
import type { ReactElement } from 'react';
import clsx from 'clsx';
import CheckList from '../CheckList';
import shared from '../shared.module.css';
import styles from './styles.module.css';

export default function Ecosystem(): ReactElement {
  return (
    <section className={shared.section} aria-labelledby="ecosystem-title">
      <div className="container">
        <h2 id="ecosystem-title" className={shared.sectionTitle}>
          Use the same parser outside VS Code
        </h2>
        <div className={styles.columns}>
          <article className={clsx(shared.card, shared.cardBody)}>
            <h3 className={shared.cardTitle}>Apex Log MCP Server</h3>
            <p className={shared.cardSummary}>
              Ask GitHub Copilot Chat, Claude Code, Cursor or any MCP client what is slow in a log.
            </p>
            <CheckList
              items={[
                'Summarizes duration, governor limits and fatal errors',
                'Ranks methods, `SOQL`, `DML` and flows by self time',
                'Runs anonymous Apex in an org, and asks first in production',
                'Runs on your machine with Node.js 22 or later, and needs no API keys',
              ]}
            />
            <CodeBlock language="bash">npx -y @certinia/apex-log-mcp</CodeBlock>
            <p className={styles.links}>
              <Link to="/docs/features/mcp">Set up the MCP server</Link>
              <Link href="https://github.com/certinia/debug-log-analyzer-mcp">GitHub</Link>
            </p>
          </article>
          <article className={clsx(shared.card, shared.cardBody)}>
            <h3 className={shared.cardTitle}>Apex Log Parser</h3>
            <p className={shared.cardSummary}>
              The parser behind the extension and the MCP server, for your own tools.
            </p>
            <CheckList
              items={[
                '`171` event types, each parsed into its own class',
                'An event tree with each entry matched to its exit',
                'Self and total time for every node, in nanoseconds',
                'Governor limits per `namespace`, and no dependencies',
              ]}
            />
            <CodeBlock language="bash">npm install @apexdevtools/apex-log-parser</CodeBlock>
            <p className={styles.links}>
              <Link href="https://github.com/apex-dev-tools/apex-log-parser#readme">GitHub</Link>
            </p>
          </article>
        </div>
      </div>
    </section>
  );
}
