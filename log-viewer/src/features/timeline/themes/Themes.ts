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
      codeUnit: '#354F52',
      workflow: '#52796F',
      method: '#5CA880',
      flow: '#84A98C',
      dml: '#9B72AA',
      soql: '#C26D6D',
      system: '#4A585F',
      reserved1: '#D4A76A',
      reserved2: '#A8C2BF',
      reserved3: '#E0E1DD',
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
    name: 'Dracula',
    colors: {
      codeUnit: '#bd93f9', // Purple
      workflow: '#8be9fd', // Cyan
      method: '#6272A4', // Comment Purple/Blue
      flow: '#FF79C6', // Pink
      dml: '#FFB86C', // Orange
      soql: '#50FA7B', // Green
      system: '#44475A', // Current Line (Gray)
      reserved1: '#f1fa8c',
      reserved2: '#FF5555',
      reserved3: '#9580FF',
    },
  },
  {
    name: 'Dusty Aurora',
    colors: {
      codeUnit: '#6D4C41',
      workflow: '#0097A7',
      method: '#00796B',
      flow: '#1976D2',
      dml: '#F4511E',
      soql: '#7B1FA2',
      system: '#757575',
      reserved1: '#C2185B',
      reserved2: '#FBC02D',
      reserved3: '#546E7A',
    },
  },
  {
    name: 'Firefox',
    colors: {
      codeUnit: '#D7D7DB', // System Grey (Container)
      workflow: '#C49FCF', // FIXED: Layout Purple (Corrected)
      method: '#D5C266', // JS Yellow (Darker than Chrome)
      flow: '#75B5AA', // Network Teal
      dml: '#E37F81', // Red (GC/Error)
      soql: '#8DC885', // Green (Graphics)
      system: '#EFEFEF', // Background
      reserved1: '#9A7FD5', // Extension Purple
      reserved2: '#E8A956', // Orange
      reserved3: '#596E7E', // Slate
    },
  },
  {
    name: 'Flame',
    colors: {
      codeUnit: '#D84315', // Darkened Orange
      workflow: '#689F38', // Darkened Green
      method: '#FF8F00', // Darkened Amber
      flow: '#FBC02D', // Darkened Yellow
      dml: '#C2185B', // Darkened Pink
      soql: '#0097A7', // Darkened Cyan
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
      reserved1: '#52796F',
      reserved2: '#84A98C',
      reserved3: '#CAD2C5',
    },
  },
  {
    name: 'Garish',
    colors: {
      codeUnit: '#722ED1',
      workflow: '#52C41A',
      method: '#1890FF', // Adjusted to standard Ant Design Blue for better contrast
      flow: '#13C2C2',
      dml: '#FA8C16',
      soql: '#EB2F96',
      system: '#8C8C8C', // Darkened from #92A1B7 for white background visibility
      reserved1: '#F5222D',
      reserved2: '#FADB14',
      reserved3: '#2F54EB', // Geek Blue
    },
  },
  {
    name: 'Intellij', // Corrected to match "Darcula" standard
    colors: {
      codeUnit: '#CC7832', // Keyword Orange (Hard)
      workflow: '#9876AA', // Interface Purple
      method: '#FFC66D', // Method Gold (The Classic look)
      flow: '#6A8759', // String Green
      dml: '#629755', // Comment Green
      soql: '#6897BB', // Numeric Blue
      system: '#808080', // Folded Text
      reserved1: '#EF5350', // Error Red
      reserved2: '#BBB529', // Search Result
      reserved3: '#5C6BC0', // Local Variable
    },
  },
  {
    name: 'Material',
    colors: {
      codeUnit: '#3949AB',
      workflow: '#00897B',
      method: '#546E7A',
      flow: '#039BE5',
      dml: '#FB8C00',
      soql: '#43A047',
      system: '#6D4C41',
      reserved1: '#D81B60',
      reserved2: '#E53935',
      reserved3: '#FDD835',
    },
  },
  {
    name: 'Modern',
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
    name: 'Monokai Pro',
    colors: {
      codeUnit: '#a9dc76',
      workflow: '#fc9867',
      method: '#78DCE8',
      flow: '#AB9DF2',
      dml: '#FF6188',
      soql: '#ffd866',
      system: '#727072',
      reserved1: '#F92672',
      reserved2: '#AE81FF',
      reserved3: '#66D9EF',
    },
  },
  {
    name: 'Nord Artic',
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
    name: 'Nordic',
    colors: {
      codeUnit: '#B48EAD', // Purple
      workflow: '#88C0D0', // Cyan
      method: '#5E81AC', // Blue (Dominant)
      flow: '#A3BE8C', // Green
      dml: '#BF616A', // Red
      soql: '#EBCB8B', // Yellow
      system: '#4C566A', // Lighter Gray (Nord3) - Visible on Dark BG
      reserved1: '#D08770', // Orange
      reserved2: '#D98E48', // Darkened Orange
      reserved3: '#5E81AC', // Blue (Replaced "Polar Night" BG color)
    },
  },
  {
    name: 'Okabe-Ito', // Accessibility Safe
    colors: {
      codeUnit: '#0072B2',
      workflow: '#56B4E9',
      method: '#888888',
      flow: '#CC79A7',
      dml: '#D55E00',
      soql: '#009E73',
      system: '#555555',
      reserved1: '#E69F00',
      reserved2: '#F0E442',
      reserved3: '#332288',
    },
  },
  {
    name: 'Salesforce Light', // Corrected for Visibility
    colors: {
      codeUnit: '#0176D3',
      workflow: '#706E6B',
      method: '#54698D',
      flow: '#0B5CAB',
      dml: '#DD7A01',
      soql: '#04844B',
      system: '#706E6B',
      reserved1: '#7F8CED',
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
  {
    name: 'Sunset Diverging',
    colors: {
      codeUnit: '#455A64',
      workflow: '#512DA8',
      method: '#616161',
      flow: '#C2185B',
      dml: '#D32F2F',
      soql: '#FBC02D',
      system: '#5D4037',
      reserved1: '#E64A19',
      reserved2: '#7B1FA2',
      reserved3: '#00796B',
    },
  },
];
