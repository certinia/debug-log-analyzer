import type * as Preset from '@docusaurus/preset-classic';
import type { Config } from '@docusaurus/types';
import { themes as prismThemes } from 'prism-react-renderer';
import { ASSETS_URL, MARKETPLACE_URL } from './src/constants';

const organizationName = 'certinia';
const projectName = 'debug-log-analyzer';
const prodUrl = `https://${organizationName}.github.io`;
const siteUrl = `${prodUrl}/${projectName}`;

const config: Config = {
  future: {
    v4: true,
    faster: true,
  },
  title: 'Apex Log Analyzer for Salesforce',
  tagline:
    'A fast VS Code extension for Salesforce developers. Visualize and debug Apex logs with interactive flame charts, dynamic call trees, and detailed SOQL/DML breakdowns. Identify performance bottlenecks, gain deep transaction insights and optimize slow Apex.',
  // Set the production url of your site here
  url: prodUrl,
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: `/${projectName}/`,
  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: organizationName, // Usually your GitHub org/user name.
  projectName: projectName, // Usually your repo name.
  onBrokenLinks: 'throw',
  markdown: {
    format: 'detect',
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },
  trailingSlash: false,
  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },
  favicon: `${siteUrl}/favicon-192x192.png`,
  // Enhanced head tags for better search engine recognition
  // Multiple favicon formats for better compatibility
  // Google requires favicons to be at least 48x48 pixels
  headTags: [
    {
      tagName: 'link',
      attributes: { rel: 'preconnect', href: 'https://raw.githubusercontent.com' },
    },
    {
      tagName: 'link',
      attributes: {
        rel: 'icon',
        type: 'image/png',
        sizes: '192x192',
        href: `${siteUrl}/favicon-192x192.png`,
      },
    },
    {
      tagName: 'link',
      attributes: {
        rel: 'icon',
        type: 'image/png',
        sizes: '48x48',
        href: `${siteUrl}/favicon-48x48.png`,
      },
    },
    {
      tagName: 'link',
      attributes: {
        rel: 'icon',
        type: 'image/svg+xml',
        href: `${siteUrl}/favicon.svg`,
      },
    },
    {
      tagName: 'link',
      attributes: {
        rel: 'icon',
        type: 'image/x-icon',
        href: `${siteUrl}/favicon.ico`,
      },
    },
    {
      tagName: 'link',
      attributes: {
        rel: 'apple-touch-icon',
        sizes: '180x180',
        href: `${siteUrl}/favicon.png`,
      },
    },
  ],
  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
          // Please change this to your repo.
          // Remove this to remove the "edit this page" links.
          editUrl: `https://github.com/${organizationName}/${projectName}/tree/main/lana-docs`,
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],
  themeConfig: {
    colorMode: {
      respectPrefersColorScheme: true,
    },
    announcementBar: {
      id: 'lana-1_22_0', // Unique ID to prevent showing again if dismissed
      content: `🎉️ <b><a href="/${projectName}/community/changelog">Apex Log Analyzer v1.22</a> is out!</b>`,
      isCloseable: true,
      backgroundColor: 'var(--lana-surface)',
      textColor: 'var(--lana-ink)',
    },
    // Replace with your project's social card
    image: `${ASSETS_URL}/timeline.png`,
    metadata: [
      {
        name: 'keywords',
        content:
          'salesforce, apex, vscode, log analyzer, debug log analyzer, debug logs, performance, salesforce debug logs',
      },
      { name: 'author', content: 'Certinia' },
    ],
    navbar: {
      title: 'Apex Log Analyzer',
      logo: {
        alt: 'Apex Log Analyzer',
        src: 'favicon.svg',
      },
      items: [
        {
          type: 'dropdown',
          label: 'Docs',
          to: '/docs/gettingstarted',
          position: 'left',
          items: [
            { to: '/docs/gettingstarted', label: 'Getting Started' },
            { to: '/docs/features', label: 'Features' },
            { to: '/docs/settings', label: 'Settings' },
            { to: '/community/changelog', label: 'Changelog' },
          ],
        },
        {
          type: 'dropdown',
          label: 'Ecosystem',
          position: 'left',
          items: [
            { to: '/docs/features/mcp', label: 'Apex Log MCP Server' },
            {
              href: 'https://github.com/apex-dev-tools/apex-log-parser',
              label: 'Apex Log Parser',
            },
          ],
        },
        {
          type: 'docSidebar',
          sidebarId: 'communitySidebar',
          position: 'left',
          label: 'Community',
        },
        {
          href: MARKETPLACE_URL,
          position: 'right',
          label: 'Install',
          className: 'navbar-install-link',
        },
        {
          href: `https://github.com/${organizationName}/${projectName}`,
          position: 'right',
          'aria-label': 'GitHub Repository',
          className: 'header-github-link',
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
          title: 'Ecosystem',
          items: [
            {
              label: 'Apex Log MCP Server',
              to: 'docs/features/mcp',
            },
            {
              label: 'Apex Log Parser',
              href: 'https://github.com/apex-dev-tools/apex-log-parser',
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
        indexBlog: false,

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
