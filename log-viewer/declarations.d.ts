declare module '*.css' {
  const content: { [className: string]: string };
  export = content;
}

// Only the jest setup reaches for node's, to stand in for the `TextEncoder`, `structuredClone` and
// `MessageChannel` jsdom omits. Declaring the one export each keeps `@types/node` out of a package
// that must not see node's globals.
declare module 'node:util' {
  export const TextEncoder: typeof globalThis.TextEncoder;
}

declare module 'node:v8' {
  export function serialize(value: unknown): Uint8Array;
  export function deserialize(buffer: Uint8Array): unknown;
}

declare module 'node:worker_threads' {
  export const MessageChannel: typeof globalThis.MessageChannel;
}
