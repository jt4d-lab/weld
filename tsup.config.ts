import { chmodSync } from 'node:fs';

import { defineConfig } from 'tsup';

export default defineConfig({
    // Два входа: плагин для ESLint и исполняемый `weld`. Общий код (резолв конфигурации, слои)
    // выносится в чанки, поэтому CLI не тянет вторую копию.
    entry: ['src/index.ts', 'src/bin.ts'],
    format: ['esm'],
    target: 'node20',
    dts: true,
    clean: true,
    sourcemap: true,
    treeshake: true,
    onSuccess: async () => {
        // `npm` выставляет бит исполнения сам при установке, но собранный локально `dist/bin.js`
        // должен запускаться и без упаковки — иначе smoke проверял бы только упакованный вид.
        chmodSync('dist/bin.js', 0o755);
    },
});
