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

const strict: Linter.Config = {
    name: 'weld/strict',
    rules: {},
};

const plugin = {
    meta: {
        name,
        version,
    },
    rules,
    configs: {
        recommended,
        strict,
    },
} satisfies ESLint.Plugin;

recommended.plugins = { weld: plugin };
strict.plugins = { weld: plugin };

export default plugin;
