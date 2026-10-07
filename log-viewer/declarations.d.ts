declare module '*.scss' {
  const content: { [className: string]: string };
  export = content;
}

declare module '*.css' {
  const content: { [className: string]: string };
  export = content;
}

// Only the jest setup reaches for node's, to stand in for the `TextEncoder` and `MessageChannel`
// jsdom omits. Declaring the one export each keeps `@types/node` out of a package that must not see
// node's globals.
declare module 'node:util' {
  export const TextEncoder: typeof globalThis.TextEncoder;
}

declare module 'node:worker_threads' {
  export const MessageChannel: typeof globalThis.MessageChannel;
}
