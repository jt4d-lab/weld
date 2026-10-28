import type { ESLint, Linter } from 'eslint';

import { PACKAGE_NAME } from '@/debug.js';
import { packageVersion } from '@/package.js';
import { rules } from '@/rules/index.js';

const recommended: Linter.Config = {
    name: 'weld/recommended',
    rules: {
        'weld/no-barrel-bypass': 'error',
    },
};

const plugin = {
    meta: {
        name: PACKAGE_NAME,
        version: packageVersion(),
    },
    rules,
    configs: {
        recommended,
    },
} satisfies ESLint.Plugin;

recommended.plugins = { weld: plugin };

export default plugin;
