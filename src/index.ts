import { createRequire } from 'node:module';

import type { ESLint, Linter } from 'eslint';

import { rules } from './rules/index.js';

const { name, version } = createRequire(import.meta.url)('../package.json') as {
    name: string;
    version: string;
};

const recommended: Linter.Config = {
    name: 'weld/recommended',
    rules: {},
};

const plugin = {
    meta: { name, version },
    rules,
    configs: { recommended },
} satisfies ESLint.Plugin;

recommended.plugins = { weld: plugin };

export default plugin;
