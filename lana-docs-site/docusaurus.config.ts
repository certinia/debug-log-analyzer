import type * as Preset from '@docusaurus/preset-classic';
import type { Config } from '@docusaurus/types';
import { themes as prismThemes } from 'prism-react-renderer';

const organizationName = 'certinia';
const projectName = 'debug-log-analyzer';

const config: Config = {
  title: 'Apex Log Analyzer for Salesforce',
  tagline:
    'blazing-fast VS Code extension for Salesforce. Visualize and debug Apex logs with interactive flame charts, dynamic call trees, and detailed SOQL/DML breakdowns. Identify performance bottlenecks, gain deep transaction insights and optimize slow Apex.',
  favicon: '/img/favicon.svg',

  // Set the production url of your site here
  url: `https://${organizationName}.github.io`,
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: `/${projectName}/`,

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: organizationName, // Usually your GitHub org/user name.
  projectName: projectName, // Usually your repo name.

  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',

  trailingSlash: false,

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  future: {
    v4: true,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    experimental_faster: true,
  },

  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          // Please change this to your repo.
          // Remove this to remove the "edit this page" links.
          editUrl: `https://github.com/${organizationName}/${projectName}/tree/main/lana-docs-site`,
        },

        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],
  themeConfig: {
    announcementBar: {
      id: 'lana-1.18.0', // Unique ID to prevent showing again if dismissed
      content:
        '🎉️ <b><a target="_blank" rel="noopener noreferrer" href="https://marketplace.visualstudio.com/items?itemName=financialforce.lana">Apex Log Analyzer v1.18</a> is out!<b>',
      isCloseable: true,
    },
    // Replace with your project's social card
    image: `https://raw.githubusercontent.com/${organizationName}/${projectName}/main/lana/assets/v1.18/lana-preview.gif`,
    metadata: [
      {
        name: 'keywords',
        content:
          'salesforce, apex, vscode, log analyzer, debug log analyzer, debug logs, performance, salesforce debug logs',
      },
      { name: 'author', content: 'Certinia' },
    ],
    navbar: {
      title: 'Apex Log Analyzer for Salesforce',
      logo: {
        alt: 'Certinia Logo',
        src: 'img/logo.svg',
        srcDark: 'img/logo-dark.svg',
      },
      items: [
        {
          type: 'doc',
          docId: 'docs/features/features',
          position: 'left',
          label: 'Docs',
        },
        {
          type: 'docSidebar',
          sidebarId: 'communitySidebar',
          position: 'left',
          label: 'Community',
        },
        {
          href: `https://github.com/${organizationName}/${projectName}`,
          position: 'right',
          'aria-label': 'GitHub Repository',
          className: 'header-github-link',
        },
        {
          type: 'search',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Docs',
          items: [
            {
              label: 'Getting Started',
              to: 'docs/gettingstarted',
            },
            {
              label: 'Installation',
              to: 'docs/gettingstarted#installation',
            },
            {
              label: 'Features',
              to: 'docs/features',
            },
            {
              label: 'Timeline',
              to: 'docs/features/timeline',
            },
            {
              label: 'Analysis',
              to: 'docs/features/analysis',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'Support',
              to: 'community/support',
            },
            {
              label: 'Feature Requests',
              to: 'community/support#feature-requests',
            },
            {
              label: 'Contributing',
              to: 'community/contributing',
            },
            {
              label: 'Changelog',
              to: 'community/changelog',
            },
          ],
        },
        {
          title: 'More',
          items: [
            {
              label: 'GitHub',
              href: `https://github.com/${organizationName}/${projectName}`,
            },
            {
              label: 'X (Twitter)',
              href: 'https://twitter.com/CertiniaInc',
            },
            {
              label: 'Issues',
              href: `https://github.com/${organizationName}/${projectName}/issues`,
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Certinia inc. All rights reserved.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
  themes: [
    [
      '@easyops-cn/docusaurus-search-local',
      {
        // Base route path(s) of docs. Slash at beginning is not required.
        docsRouteBasePath: '/',

        // Whether to add a hashed query when fetching index
        hashed: true,

        // Highlight search terms on target page.
        highlightSearchTermsOnTargetPage: true,

        // whether to index docs pages
        indexDocs: true,

        // whether to index blog pages
        indexBlog: true,

        // whether to index static pages
        // /404.html is never indexed
        indexPages: true,

        // language of your documentation, see next section
        language: 'en',

        // Enable this if you want to be able to search for any partial word at the cost of search performance.
        removeDefaultStemmer: true,
      },
    ],
  ],
};

export default config;
