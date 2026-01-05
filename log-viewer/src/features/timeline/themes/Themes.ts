/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

interface TimelineTheme {
  name: string;
  colors: TimelineColors;
}

export interface TimelineColors {
  codeUnit: string;
  workflow: string;
  method: string;
  flow: string;
  dml: string;
  soql: string;
  system: string;
  reserved1?: string; // Callouts
  reserved2?: string; // Validation
  reserved3?: string; // Generic
}

export const DEFAULT_THEME_NAME = '50 Shades of Green';
export const THEMES: TimelineTheme[] = [
  {
    name: '50 Shades of Green Bright',
    colors: {
      codeUnit: '#9CCC65',
      workflow: '#66BB6A',
      method: '#26A69A',
      flow: '#42A5F5',
      dml: '#00BCD4',
      soql: '#AB47BC',
      system: '#A1887F',
      reserved1: '#FFA726',
      reserved2: '#EF5350',
      reserved3: '#78909C',
    },
  },
  {
    name: '50 Shades of Green',
    colors: {
      codeUnit: '#88AE58',
      workflow: '#51A16E',
      method: '#2B8F81',
      flow: '#337986',
      dml: '#144652',
      soql: '#6D4C7D',
      system: '#5C3444',
      reserved1: '#CCA033',
      reserved2: '#A84545',
      reserved3: '#607D8B',
    },
  },
  {
    name: 'Botanical Twilight',
    colors: {
      codeUnit: '#93B376',
      workflow: '#5CA880',
      method: '#708B91',
      flow: '#458593',
      dml: '#C26D6D',
      soql: '#8D7494',
      system: '#666266',
      reserved1: '#D4A76A',
      reserved2: '#A8C2BF',
      reserved3: '#566E7A',
    },
  },
  {
    name: 'Catppuccin Macchiato',
    colors: {
      codeUnit: '#8AADF4',
      workflow: '#94E2D5',
      method: '#C6A0F6',
      flow: '#F5A97F',
      dml: '#F38BA8',
      soql: '#A6DA95',
      system: '#5B6078',
      reserved1: '#EED49F',
      reserved2: '#ED8796',
      reserved3: '#F5E0DC',
    },
  },
  {
    name: 'Chrome',
    colors: {
      codeUnit: '#757575',
      method: '#EBD272',
      workflow: '#80CBC4',
      flow: '#5DADE2',
      dml: '#AF7AC5',
      soql: '#7DCEA0',
      system: '#E0E0E0',
      reserved1: '#D98880',
      reserved2: '#F0B27A',
      reserved3: '#90A4AE',
    },
  },
  {
    name: 'Dracula',
    colors: {
      codeUnit: '#bd93f9',
      workflow: '#8be9fd',
      method: '#6272A4',
      flow: '#FF79C6',
      dml: '#FFB86C',
      soql: '#50FA7B',
      system: '#44475A',
      reserved1: '#f1fa8c',
      reserved2: '#FF5555',
      reserved3: '#9580FF',
    },
  },
  {
    name: 'Dusty Aurora',
    colors: {
      codeUnit: '#455A64',
      workflow: '#8CBFA2',
      method: '#56949C',
      flow: '#7CA5C9',
      dml: '#D68C79',
      soql: '#A693BD',
      system: '#8D8078',
      reserved1: '#CDBD7A',
      reserved2: '#D67E7E',
      reserved3: '#90A4AE',
    },
  },
  {
    name: 'Firefox',
    colors: {
      codeUnit: '#B4B4B9',
      workflow: '#C49FCF',
      method: '#D5C266',
      flow: '#75B5AA',
      dml: '#E37F81',
      soql: '#8DC885',
      system: '#8F8585',
      reserved1: '#8484D1',
      reserved2: '#E8A956',
      reserved3: '#5283A4',
    },
  },
  {
    name: 'Flame',
    colors: {
      codeUnit: '#D84315',
      workflow: '#689F38',
      method: '#FF8F00',
      flow: '#FBC02D',
      dml: '#C2185B',
      soql: '#0097A7',
      system: '#616161',
      reserved1: '#D32F2F',
      reserved2: '#AFB42B',
      reserved3: '#455A64',
    },
  },
  {
    name: 'Forest Floor',
    colors: {
      codeUnit: '#2A9D8F',
      workflow: '#264653',
      method: '#6D6875',
      flow: '#E9C46A',
      dml: '#F4A261',
      soql: '#E76F51',
      system: '#455A64',
      reserved1: '#606C38',
      reserved2: '#BC4749',
      reserved3: '#9C6644',
    },
  },
  {
    name: 'Garish',
    colors: {
      codeUnit: '#722ED1',
      workflow: '#52C41A',
      method: '#1890FF',
      flow: '#13C2C2',
      dml: '#FA8C16',
      soql: '#EB2F96',
      system: '#8C8C8C',
      reserved1: '#F5222D',
      reserved2: '#FADB14',
      reserved3: '#2F54EB',
    },
  },
  {
    name: 'Material',
    colors: {
      codeUnit: '#BA68C8',
      workflow: '#4FC3F7',
      method: '#676E95',
      flow: '#FFCC80',
      dml: '#E57373',
      soql: '#91B859',
      system: '#A1887F',
      reserved1: '#F48FB1',
      reserved2: '#9FA8DA',
      reserved3: '#80CBC4',
    },
  },
  {
    name: 'Modern',
    colors: {
      codeUnit: '#6E7599',
      workflow: '#4A918E',
      method: '#6A7B8C',
      flow: '#C47C46',
      dml: '#CC5E5E',
      soql: '#5CA376',
      system: '#948C84',
      reserved1: '#B86B86',
      reserved2: '#4D8CB0',
      reserved3: '#756CA8',
    },
  },
  {
    name: 'Monokai Pro',
    colors: {
      codeUnit: '#9E86C8',
      workflow: '#D4856A',
      method: '#7B8CA6',
      flow: '#F0A65F',
      dml: '#D95C79',
      soql: '#9CCF6A',
      system: '#9E938D',
      reserved1: '#DBC05E',
      reserved2: '#5EC4CD',
      reserved3: '#8F8B76',
    },
  },
  {
    name: 'Nord',
    colors: {
      codeUnit: '#81a1c1',
      workflow: '#b48ead',
      method: '#5e81ac',
      flow: '#d08770',
      dml: '#bf616a',
      soql: '#a3be8c',
      system: '#4c566a',
      reserved1: '#ebcb8b',
      reserved2: '#88c0d0',
      reserved3: '#8fbcbb',
    },
  },
  {
    name: 'Nord Forest',
    colors: {
      codeUnit: '#5E81AC',
      workflow: '#EBCB8B',
      method: '#7B8C7C',
      flow: '#BF616A',
      dml: '#D08770',
      soql: '#B48EAD',
      system: '#8C7B7E',
      reserved1: '#687585',
      reserved2: '#88C0D0',
      reserved3: '#81A1C1',
    },
  },
  {
    name: 'Okabe-Ito',
    colors: {
      codeUnit: '#0072B2',
      workflow: '#332288',
      method: '#56B4E9',
      flow: '#D55E00',
      dml: '#CC79A7',
      soql: '#009E73',
      system: '#E69F00',
      reserved1: '#882255',
      reserved2: '#117733',
      reserved3: '#AA4499',
    },
  },
  {
    name: 'Salesforce',
    colors: {
      codeUnit: '#0176D3',
      workflow: '#9050E9',
      method: '#54698D',
      flow: '#584FB8',
      dml: '#DD7A01',
      soql: '#0B5CAB',
      system: '#706E6B',
      reserved1: '#4BCA81',
      reserved2: '#C23934',
      reserved3: '#005FB2',
    },
  },
  {
    name: 'Solarized',
    colors: {
      codeUnit: '#268BD2',
      workflow: '#2AA198',
      method: '#586E75',
      flow: '#6C71C4',
      dml: '#DC322F',
      soql: '#859900',
      system: '#B58900',
      reserved1: '#D33682',
      reserved2: '#CB4B16',
      reserved3: '#93a1a1',
    },
  },
];
