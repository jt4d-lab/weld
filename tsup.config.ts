import { readFileSync } from 'node:fs';

import { defineConfig } from 'tsup';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
    version: string;
};

export default defineConfig({
    entry: ['src/index.ts'],
    format: ['esm'],
    target: 'node20',
    dts: true,
    clean: true,
    sourcemap: true,
    treeshake: true,
    define: {
        __PLUGIN_VERSION__: JSON.stringify(pkg.version),
    },
});
