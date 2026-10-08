import { afterEach, beforeAll, beforeEach, expect, it, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

let mockColorMode = 'dark';
let LiveDemo: typeof import('../index').default;

// Docusaurus resolves these aliases in its own bundler, so jest cannot find them on disk.
jest.mock(
  '@docusaurus/useBaseUrl',
  () => ({ __esModule: true, default: (path: string) => `/debug-log-analyzer${path}` }),
  { virtual: true },
);
jest.mock(
  '@docusaurus/theme-common',
  () => ({ useColorMode: () => ({ colorMode: mockColorMode }) }),
  { virtual: true },
);
jest.mock(
  '@theme/ThemedImage',
  () => ({ __esModule: true, default: ({ alt }: { alt: string }) => <img alt={alt} /> }),
  { virtual: true },
);

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Not a top-level import: swc does not hoist jest.mock above it when jest comes from @jest/globals.
beforeAll(async () => {
  ({ default: LiveDemo } = await import('../index'));
});

let container: HTMLDivElement;
let root: Root;

function render(): void {
  act(() => root.render(<LiveDemo />));
}

function button(name: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find((b) => b.textContent === name);
  if (!match) {
    throw new Error(`No "${name}" button.`);
  }
  return match;
}

function frame(): HTMLIFrameElement | null {
  return container.querySelector('iframe');
}

beforeEach(() => {
  mockColorMode = 'dark';
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

it('shows a poster and loads nothing from the demo before a click', () => {
  render();

  expect(frame()).toBeNull();
  expect(container.querySelector('img')?.alt).toMatch(/^Apex Log Analyzer showing/);
});

it.each([
  ['the Open demo button', () => button('Open demo')],
  ['the poster', () => container.querySelector('img')?.parentElement],
])('opens the viewer in a frame from %s', (_, target) => {
  render();

  act(() => target()?.click());

  expect(frame()?.title).toBe('Apex Log Analyzer live demo');
  expect(frame()?.getAttribute('src')).toBe('/debug-log-analyzer/demo/viewer?theme=dark');
});

it('posts a theme change to the frame without reloading it', () => {
  render();
  act(() => button('Open demo').click());
  const opened = frame();
  if (!opened?.contentWindow) {
    throw new Error('The demo frame has no window.');
  }
  const post = jest.spyOn(opened.contentWindow, 'postMessage');

  mockColorMode = 'light';
  render();

  expect(frame()).toBe(opened);
  expect(frame()?.getAttribute('src')).toBe('/debug-log-analyzer/demo/viewer?theme=dark');
  expect(post.mock.calls).toContainEqual([
    { type: 'lana-demo-theme', theme: 'light' },
    'http://localhost',
  ]);
});

it('closes the demo and shows the poster again', () => {
  render();
  act(() => button('Open demo').click());

  act(() => button('Close demo').click());

  expect(frame()).toBeNull();
  expect(button('Open demo')).toBeDefined();
});
