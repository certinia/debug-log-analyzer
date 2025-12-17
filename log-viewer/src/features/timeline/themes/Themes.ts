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

export const DEFAULT_THEME_NAME = '50 shades of green - classic';

export const THEMES: TimelineTheme[] = [
  {
    name: '50 shades of green - classic',
    colors: {
      codeUnit: '#88AE58',
      workflow: '#51A16E',
      method: '#2B8F81',
      flow: '#337986',
      dml: '#285663',
      soql: '#5D4963',
      system: '#5C3444',
    },
  },
  {
    name: 'Garish',
    colors: {
      codeUnit: '#722ED1',
      workflow: '#52C41A',
      method: '#5B8FF9',
      flow: '#13C2C2',
      dml: '#FA8C16',
      soql: '#EB2F96',
      system: '#92A1B7',
      reserved1: '#F5222D', // Callouts
      reserved2: '#FADB14', // Validation
      reserved3: '#36CFC9', // Generic
    },
  },
  {
    name: 'Nordic',
    colors: {
      codeUnit: '#B48EAD',
      workflow: '#88C0D0',
      method: '#81A1C1',
      flow: '#A3BE8C',
      dml: '#E06C75',
      soql: '#EBCB8B',
      system: '#9CA3AF',
      reserved1: '#D08770', // Callouts
      reserved2: '#B9770E', // Validation
      reserved3: '#5E81AC', // Generic
    },
  },
  {
    name: 'Firefox',
    colors: {
      codeUnit: '#4A90E2',
      workflow: '#1ABC9C',
      method: '#6D84A4',
      flow: '#629F78',
      dml: '#D97E39',
      soql: '#8E6CAB',
      system: '#95A5A6',
      reserved1: '#B54E4E', // Callouts
      reserved2: '#D4AC0D', // Validation
      reserved3: '#34495E', // Generic
    },
  },
  {
    name: 'Chrome Muted',
    colors: {
      codeUnit: '#D4AC0D',
      workflow: '#48C9B0',
      method: '#F0D574',
      flow: '#5DADE2',
      dml: '#A569BD',
      soql: '#58D68D',
      system: '#E0E0E0',
      reserved1: '#EC7063', // Callouts
      reserved2: '#F5B041', // Validation
      reserved3: '#566573', // Generic
    },
  },
  {
    name: 'Chrome Bright',
    colors: {
      codeUnit: '#F39C12',
      workflow: '#1ABC9C',
      method: '#F4D03F',
      flow: '#3498DB',
      dml: '#9B59B6',
      soql: '#2ECC71',
      system: '#E0E0E0',
      reserved1: '#E74C3C', // Callouts
      reserved2: '#F1C40F', // Validation
      reserved3: '#34495E', // Generic
    },
  },
  {
    name: 'Firefox Dim',
    colors: {
      codeUnit: '#2980B9',
      workflow: '#16A085',
      method: '#758EAA',
      flow: '#27AE60',
      dml: '#E67E22',
      soql: '#9B59B6',
      system: '#95A5A6',
      reserved1: '#C0392B', // Callouts
      reserved2: '#F39C12', // Validation
      reserved3: '#2C3E50', // Generic
    },
  },
  {
    name: 'Intellij',
    colors: {
      codeUnit: '#6D4C41',
      workflow: '#26A69A',
      method: '#E6B33D',
      flow: '#66BB6A',
      dml: '#CF518D',
      soql: '#7EAAC7',
      system: '#808080',
      reserved1: '#EF5350', // Callouts
      reserved2: '#FFCA28', // Validation
      reserved3: '#5C6BC0', // Generic
    },
  },
  {
    name: 'Modern',
    colors: {
      codeUnit: '#5F27CD',
      workflow: '#54A0FF',
      method: '#6A9CFD',
      flow: '#00D2D3',
      dml: '#FF9F43',
      soql: '#D6A2E8',
      system: '#B2BEC3',
      reserved1: '#FF6B6B', // Callouts
      reserved2: '#FECA57', // Validation
      reserved3: '#222F3E', // Generic
    },
  },
  {
    name: 'Flame',
    colors: {
      codeUnit: '#FF5722',
      workflow: '#8BC34A',
      method: '#FF9800',
      flow: '#FFC107',
      dml: '#E91E63',
      soql: '#00BCD4',
      system: '#9E9E9E',
      reserved1: '#F44336', // Callouts
      reserved2: '#CDDC39', // Validation
      reserved3: '#607D8B', // Generic
    },
  },
  {
    name: '50 Shades of green high contrast',
    colors: {
      codeUnit: '#9CCC65',
      workflow: '#66BB6A',
      method: '#26A69A',
      flow: '#42A5F5',
      dml: '#00BCD4',
      soql: '#AB47BC',
      system: '#A1887F',
      reserved1: '#', // Callouts
      reserved2: '#', // Validation
      reserved3: '#', // Generic
    },
  },
  {
    name: 'Dusty Aurora',
    colors: {
      codeUnit: '#AED581',
      workflow: '#4DD0E1',
      method: '#4DB6AC',
      flow: '#64B5F6',
      dml: '#FF8A65',
      soql: '#9575CD',
      system: '#A1887F',
      reserved1: '#', // Callouts
      reserved2: '#', // Validation
      reserved3: '#', // Generic
    },
  },
  {
    name: 'Salesforce Lightning',
    colors: {
      codeUnit: '#0070D2',
      workflow: '#3C6173',
      method: '#D8DDE6',
      flow: '#014486',
      dml: '#FF9A3C',
      soql: '#3BA755',
      system: '#74706A',
      reserved1: '#9D53F2', // Callouts
      reserved2: '#D93630', // Validation
      reserved3: '#038387', // Generic
    },
  },
  {
    name: 'Nord Artic Muted',
    colors: {
      codeUnit: '#5E81AC',
      workflow: '#8FBCBB',
      method: '#76849D',
      flow: '#B48EAD',
      dml: '#D08770',
      soql: '#A3BE8C',
      system: '#434C5E',
      reserved1: '#EBCB8B', // Callouts
      reserved2: '#BF616A', // Validation
      reserved3: '#88C0D0', // Generic
    },
  },
  {
    name: 'Solarized High Contrast',
    colors: {
      codeUnit: '#268BD2',
      workflow: '#2AA198',
      method: '#586E75',
      flow: '#6C71C4',
      dml: '#E66826',
      soql: '#859900',
      system: '#B58900',
      reserved1: '#D33682', // Callouts
      reserved2: '#9E1B1B', // Validation
      reserved3: '#93A1A1', // Generic
    },
  },
  {
    name: 'Dracula',
    colors: {
      codeUnit: '#BD93F9',
      workflow: '#8BE9FD',
      method: '#6272A4',
      flow: '#FF79C6',
      dml: '#FFB86C',
      soql: '#50FA7B',
      system: '#44475A',
      reserved1: '#F1FA8C', // Callouts
      reserved2: '#FF5555', // Validation
      reserved3: '#9580FF', // Generic
    },
  },
  {
    name: 'Monokai Pro',
    colors: {
      codeUnit: '#66D9EF',
      workflow: '#FD971F',
      method: '#A9A9A9',
      flow: '#AE81FF',
      dml: '#F92672',
      soql: '#A6E22E',
      system: '#363537',
      reserved1: '#E6DB74', // Callouts
      reserved2: '#C7405D', // Validation
      reserved3: '#516A74', // Generic
    },
  },
  {
    name: 'Material',
    colors: {
      codeUnit: '#3949AB',
      workflow: '#039BE5',
      method: '#B0BEC5',
      flow: '#00ACC1',
      dml: '#FB8C00',
      soql: '#43A047',
      system: '#8D6E63',
      reserved1: '#D81B60', // Callouts
      reserved2: '#E53935', // Validation
      reserved3: '#FDD835', // Generic
    },
  },
  {
    name: 'Okabe-Ito',
    colors: {
      codeUnit: '#0072B2',
      workflow: '#56B4E9',
      method: '#E0E0E0',
      flow: '#CC79A7',
      dml: '#D55E00',
      soql: '#009E73',
      system: '#777777',
      reserved1: '#F0E442', // Callouts
      reserved2: '#E69F00', // Validation
      reserved3: '#332288', // Generic
    },
  },
  {
    name: 'Catppuccin Macchiato',
    colors: {
      codeUnit: '#8AADF4',
      workflow: '#8BD5CA',
      method: '#A5ADCB',
      flow: '#C6A0F6',
      dml: '#D55E00',
      soql: '#A6DA95',
      system: '#363A4F',
      reserved1: '#EED49F', // Callouts
      reserved2: '#EE99A0', // Validation
      reserved3: '#F5BDE6', // Generic
    },
  },
  {
    name: 'Sunset Diverging',
    colors: {
      codeUnit: '#37474F',
      workflow: '#7986CB',
      method: '#90A4AE',
      flow: '#9575CD',
      dml: '#FF7043',
      soql: '#FFCA28',
      system: '#D7CCC8',
      reserved1: '#5D4037', // Callouts
      reserved2: '#C2185B', // Validation
      reserved3: '#26A69A', // Generic
    },
  },
  {
    name: 'Forest Floor',
    colors: {
      codeUnit: '#3D5A80',
      workflow: '#9C6644',
      method: '#E6E8E6',
      flow: '#6D597A',
      dml: '#C8553D',
      soql: '#8AB17D',
      system: '#354F52',
      reserved1: '#E29578', // Callouts
      reserved2: '#E9C46A', // Validation
      reserved3: '#2A9D8F', // Generic
    },
  },
  {
    name: 'Botanical Twilight /  50 Shades of green modern',
    colors: {
      codeUnit: '#93B376',
      workflow: '#5CA880',
      method: '#708B91',
      flow: '#458593',
      dml: '#C26D6D',
      soql: '#8D7494',
      system: '#666266',
      reserved1: '#D4A76A', // Callouts
      reserved2: '#A8C2BF', // Validation
      reserved3: '#566E7A', // Generic
    },
  },
];
