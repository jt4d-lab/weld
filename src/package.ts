import { createRequire } from 'node:module';

export function packageVersion(): string {
    const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

    return version;
}
