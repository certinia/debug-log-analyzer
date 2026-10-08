import Head from '@docusaurus/Head';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import ClosingCta from '@site/src/components/home/ClosingCta';
import Ecosystem from '@site/src/components/home/Ecosystem';
import Features from '@site/src/components/home/Features';
import Hero from '@site/src/components/home/Hero';
import Performance from '@site/src/components/home/Performance';
import Layout from '@theme/Layout';
import type { ReactElement } from 'react';

const KEYWORDS = [
  'salesforce',
  'apex',
  'debug logs',
  'performance analysis',
  'flame chart',
  'log analyzer',
  'vscode',
  'logs',
  'apex log analysis',
  'visual studio code extension',
  'salesforce debugging',
  'apex logs',
  'salesforce tools',
  'salesforce extension',
  'salesforce log analyzer',
  'apex performance',
  'salesforce productivity',
  'salesforce troubleshooting',
  'salesforce log analysis',
  'apex code analysis',
];

export default function Home(): ReactElement {
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout description={siteConfig.tagline}>
      <Head>
        <meta name="keywords" content={KEYWORDS.join(', ')} />
      </Head>
      <main>
        <Hero />
        <Performance />
        <Features />
        <Ecosystem />
        <ClosingCta />
      </main>
    </Layout>
  );
}
