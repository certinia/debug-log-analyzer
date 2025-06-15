import type * as Preset from '@docusaurus/preset-classic';
import type { Config } from '@docusaurus/types';
import { themes as prismThemes } from 'prism-react-renderer';

const organizationName = 'certinia';
const projectName = 'debug-log-analyzer';

const config: Config = {
  title: 'Apex Log Analyzer for Salesforce',
  tagline:
    'Visualize code execution via a Flame graph and identify performance and SOQL/DML problems via Method and Database analysis',
  favicon: '../../lana/certinia-icon-color.png',

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
    // Replace with your project's social card
    image: 'img/lana-timeline.png',
    navbar: {
      title: 'Apex Log Analyzer for Salesforce',
      logo: {
        alt: 'Certinia Logo',
        src: 'img/logo.svg',
        srcDark: 'img/logo-dark.svg',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'docSidebar',
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
              label: 'Introduction',
              to: '/',
            },
            {
              label: 'Installation',
              to: 'docs/installation',
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
              label: 'Twitter',
              href: 'https://twitter.com/CertiniaInc',
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
