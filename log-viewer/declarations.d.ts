declare module '*.scss' {
  const content: { [className: string]: string };
  export = content;
}

declare module '*.css' {
  const content: { [className: string]: string };
  export = content;
}

// Only the jest setup reaches for node's, to stand in for the `TextEncoder` jsdom omits. Declaring
// the one export keeps `@types/node` out of a package that must not see node's globals.
declare module 'node:util' {
  export const TextEncoder: typeof globalThis.TextEncoder;
}
