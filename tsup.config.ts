import { chmodSync } from 'node:fs';

import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/index.ts', 'src/bin.ts'],
    format: ['esm'],
    target: 'node20',
    dts: true,
    clean: true,
    sourcemap: true,
    treeshake: true,
    onSuccess: async () => {
        chmodSync('dist/bin.js', 0o755);
    },
});
