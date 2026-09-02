import type { ESLint, Linter } from 'eslint';

import { rules } from './rules/index.js';
import { version } from './version.js';

const meta = {
    name: 'eslint-plugin-weld',
    version,
} satisfies ESLint.Plugin['meta'];

/**
 * Плагин WELD. Правил пока нет — это основа, на которую они будут добавляться.
 */
const plugin = {
    meta,
    rules,
    configs: {} as Record<string, Linter.Config>,
} satisfies ESLint.Plugin;

/**
 * Рекомендуемый набор правил (flat config).
 *
 * Подключается как элемент массива в `eslint.config.js`:
 *
 * ```js
 * import weld from 'eslint-plugin-weld';
 *
 * export default [weld.configs.recommended];
 * ```
 */
const recommended: Linter.Config = {
    name: 'weld/recommended',
    plugins: { weld: plugin as ESLint.Plugin },
    rules: {},
};

plugin.configs.recommended = recommended;

export { meta, rules };
export const configs = plugin.configs;

export default plugin;
