// The project has no @types/node; these are the few Node APIs the dev-server middleware (and its test) use.
declare module 'node:fs/promises' {
  export function writeFile(path: string, data: string, options?: { encoding?: string; flag?: string }): Promise<void>;
  export function unlink(path: string): Promise<void>;
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<unknown>;
  export function stat(path: string): Promise<{ isFile(): boolean }>;
  export function readFile(path: string, encoding: 'utf8'): Promise<string>;
  export function readdir(path: string): Promise<string[]>;
  export function rmdir(path: string): Promise<void>;
}
declare module 'node:path' {
  export function resolve(...parts: string[]): string;
  export function join(...parts: string[]): string;
  export function dirname(p: string): string;
}
