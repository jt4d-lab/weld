/**
 * Команда `weld config`: эффективная конфигурация WELD для файла или директории — ровно то, что
 * видит правило.
 *
 * Здесь намеренно читаются все части резолва, включая алиасы: правило спрашивает их лениво, потому
 * что кривая неиспользуемая часть не должна валить линт, а CLI существует ровно для того, чтобы
 * показать конфигурацию, — ошибка в ней и должна быть видна.
 */

import { resolveForFile } from '@/config/index.js';
import { getAliasesBaseUrl, getTsconfigName } from '@/settings/index.js';

import type { LintSettings } from './eslint-config.js';
import type { ConfigData } from './render.js';

/**
 * Данные `weld config`. Путь и настройки уже разобраны; печатает их `program.ts` — текстом или
 * JSON. Форма JSON та же: `sampleOf` у файла отсутствует, `aliases` уже в виде `{ prefix, anchor }`.
 */
export function effectiveConfig(lint: LintSettings, cwd: string): ConfigData {
    const target = resolveForFile({ filename: lint.filePath, settings: lint.settings, cwd });

    if (target.getFromFile() === null) {
        throw new Error(`${lint.filePath} is outside the repository root`);
    }

    const repoRoot = target.getRoot();

    if (repoRoot === null) {
        throw new Error(`repository root could not be resolved for ${lint.filePath}`);
    }

    return {
        file: lint.filePath,
        sampleOf: lint.sampleOf,
        settings: {
            repoRoot,
            aliasesBaseUrl: getAliasesBaseUrl(lint.settings),
            tsconfig: getTsconfigName(lint.settings),
            aliases: target.getAliases(),
        },
    };
}
