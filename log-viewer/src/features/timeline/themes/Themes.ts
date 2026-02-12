/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

interface TimelineTheme {
  name: string;
  colors: TimelineColors;
}

export interface TimelineColors {
  apex: string;
  codeUnit: string;
  system: string;
  automation: string;
  dml: string;
  soql: string;
  callout: string;
  validation: string;
}

export const DEFAULT_THEME_NAME = '50 Shades of Green';
export const THEMES: TimelineTheme[] = [
  {
    name: '50 Shades of Green Bright',
    colors: {
      apex: '#26A69A',
      codeUnit: '#9CCC65',
      system: '#A1887F',
      automation: '#66BB6A',
      dml: '#E57373',
      soql: '#BA68C8',
      callout: '#FFB74D',
      validation: '#5BA4CF',
    },
  },
  {
    name: '50 Shades of Green',
    colors: {
      apex: '#2B8F81',
      codeUnit: '#88AE58',
      system: '#8D6E63',
      automation: '#51A16E',
      dml: '#B06868',
      soql: '#6D4C7D',
      callout: '#CCA033',
      validation: '#5C8FA6',
    },
  },
  {
    name: 'Botanical Twilight',
    colors: {
      apex: '#708B91',
      codeUnit: '#93B376',
      system: '#666266',
      automation: '#5CA880',
      dml: '#C26D6D',
      soql: '#8D7494',
      callout: '#D4A76A',
      validation: '#458593',
    },
  },
  {
    name: 'Catppuccin',
    colors: {
      apex: '#C6A0F6',
      codeUnit: '#8AADF4',
      system: '#5B6078',
      automation: '#94E2D5',
      dml: '#F38BA8',
      soql: '#A6DA95',
      callout: '#EED49F',
      validation: '#F5A97F',
    },
  },
  {
    name: 'Chrome',
    colors: {
      apex: '#EBD272',
      codeUnit: '#7986CB',
      system: '#CFD8DC',
      automation: '#80CBC4',
      dml: '#AF7AC5',
      soql: '#7DCEA0',
      callout: '#D98880',
      validation: '#5DADE2',
    },
  },
  {
    name: 'Dracula',
    colors: {
      apex: '#6272A4',
      codeUnit: '#bd93f9',
      system: '#44475A',
      automation: '#8be9fd',
      dml: '#FFB86C',
      soql: '#50FA7B',
      callout: '#f1fa8c',
      validation: '#FF79C6',
    },
  },
  {
    name: 'Dusty Aurora',
    colors: {
      apex: '#56949C',
      codeUnit: '#455A64',
      system: '#8D8078',
      automation: '#8CBFA2',
      dml: '#D68C79',
      soql: '#A693BD',
      callout: '#CDBD7A',
      validation: '#7CA5C9',
    },
  },
  {
    name: 'Firefox',
    colors: {
      apex: '#D5C266',
      codeUnit: '#B4B4B9',
      system: '#8F8585',
      automation: '#C49FCF',
      dml: '#E37F81',
      soql: '#8DC885',
      callout: '#8484D1',
      validation: '#75B5AA',
    },
  },
  {
    name: 'Flame',
    colors: {
      apex: '#F57C00',
      codeUnit: '#B71C1C',
      system: '#8D6E63',
      automation: '#E65100',
      dml: '#F44336',
      soql: '#FFCA28',
      callout: '#C2185B',
      validation: '#FF7043',
    },
  },
  {
    name: 'Forest Floor',
    colors: {
      apex: '#6D6875',
      codeUnit: '#2A9D8F',
      system: '#455A64',
      automation: '#264653',
      dml: '#F4A261',
      soql: '#E76F51',
      callout: '#606C38',
      validation: '#E9C46A',
    },
  },
  {
    name: 'Garish',
    colors: {
      apex: '#1890FF',
      codeUnit: '#722ED1',
      system: '#90A4AE',
      automation: '#52C41A',
      dml: '#FF9100',
      soql: '#EB2F96',
      callout: '#F5222D',
      validation: '#00BCD4',
    },
  },
  {
    name: 'Material',
    colors: {
      apex: '#676E95',
      codeUnit: '#BA68C8',
      system: '#A1887F',
      automation: '#4FC3F7',
      dml: '#E57373',
      soql: '#91B859',
      callout: '#F48FB1',
      validation: '#FFCC80',
    },
  },
  {
    name: 'Modern',
    colors: {
      apex: '#6A7B8C',
      codeUnit: '#6E7599',
      system: '#948C84',
      automation: '#4A918E',
      dml: '#CC5E5E',
      soql: '#5CA376',
      callout: '#B86B86',
      validation: '#C47C46',
    },
  },
  {
    name: 'Monokai Pro',
    colors: {
      apex: '#7B8CA6',
      codeUnit: '#9E86C8',
      system: '#9E938D',
      automation: '#FF6188',
      dml: '#FC9867',
      soql: '#A9DC76',
      callout: '#AB9DF2',
      validation: '#FFD866',
    },
  },
  {
    name: 'Nord',
    colors: {
      apex: '#5e81ac',
      codeUnit: '#81a1c1',
      system: '#4c566a',
      automation: '#b48ead',
      dml: '#bf616a',
      soql: '#a3be8c',
      callout: '#ebcb8b',
      validation: '#d08770',
    },
  },
  {
    name: 'Nord Forest',
    colors: {
      apex: '#7B8C7C',
      codeUnit: '#5E81AC',
      system: '#8C7B7E',
      automation: '#EBCB8B',
      dml: '#D08770',
      soql: '#B48EAD',
      callout: '#687585',
      validation: '#BF616A',
    },
  },
  {
    name: 'Okabe-Ito',
    colors: {
      apex: '#56B4E9',
      codeUnit: '#0072B2',
      system: '#E69F00',
      automation: '#332288',
      dml: '#CC79A7',
      soql: '#009E73',
      callout: '#882255',
      validation: '#D55E00',
    },
  },
  {
    name: 'Salesforce',
    colors: {
      apex: '#54698D',
      codeUnit: '#0176D3',
      system: '#706E6B',
      automation: '#CE4A6B',
      dml: '#D68128',
      soql: '#04844B',
      callout: '#D4B753',
      validation: '#9050E9',
    },
  },
  {
    name: 'Solarized',
    colors: {
      apex: '#586E75',
      codeUnit: '#268BD2',
      system: '#B58900',
      automation: '#2AA198',
      dml: '#DC322F',
      soql: '#859900',
      callout: '#D33682',
      validation: '#6C71C4',
    },
  },
];
