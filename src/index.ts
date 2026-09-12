import { createRequire } from 'node:module';

import type { ESLint, Linter } from 'eslint';

import { PACKAGE_NAME } from '@/debug.js';
import { rules } from '@/rules/index.js';

/** Версию проставляет release-workflow перед упаковкой, поэтому она читается из `package.json`. */
const { version } = createRequire(import.meta.url)('../package.json') as { version: string };

const recommended: Linter.Config = {
    name: 'weld/recommended',
    rules: {
        'weld/no-barrel-bypass': 'error',
    },
};

const strict: Linter.Config = {
    name: 'weld/strict',
    rules: {
        'weld/no-barrel-bypass': 'error',
    },
};

const plugin = {
    meta: {
        name: PACKAGE_NAME,
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
