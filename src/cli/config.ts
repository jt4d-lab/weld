/**
 * Команда `weld config`: эффективная конфигурация WELD для файла или директории — ровно то, что
 * видит правило.
 *
 * Здесь намеренно читаются все части резолва, включая алиасы: правило спрашивает их лениво, потому
 * что кривая неиспользуемая часть не должна валить линт, а CLI существует ровно для того, чтобы
 * показать конфигурацию, — ошибка в ней и должна быть видна.
 */

import { resolveForFile } from '@/config/index.js';
import type { Alias } from '@/settings/index.js';
import { getAliasesBaseUrl, getTsconfigName } from '@/settings/index.js';

import type { LintSettings } from './eslint-config.js';
import { assertInsideRoot, repoPath, repoRootOf } from './target.js';

/**
 * Данные `weld config`: форма текстового вывода и одновременно форма JSON. Путь и настройки уже
 * разобраны; печатает их `program.ts`. `sampleOf` у файла отсутствует, `aliases` — уже в виде
 * `{ prefix, anchor, star }`.
 */
export type ConfigData = {
    /** Путь файла от корня репозитория (вне корня — абсолютный). */
    file: string;
    /** Путь примененного ESLint-конфига по тем же правилам, что и `file`. */
    configFile: string;
    /** Аргумент директории в том виде, как его ввели; у файла отсутствует. */
    sampleOf?: string;
    settings: {
        /** Абсолютный: по нему разрешаются пути вывода. */
        repoRoot: string;
        aliasesBaseUrl: string;
        tsconfig: string;
        aliases: Alias[];
    };
};

export function effectiveConfig(lint: LintSettings, cwd: string): ConfigData {
    const target = resolveForFile({
        filename: lint.filePath,
        settings: lint.settings,
        cwd,
        options: lint.options,
    });

    // Файл вне корня отсекается до разбора алиасов — тем же отказом и в том же порядке, что и
    // `inspect`.
    assertInsideRoot(target, lint.filePath);

    const repoRoot = repoRootOf(target, lint.filePath);

    return {
        file: repoPath(repoRoot, lint.filePath),
        configFile: repoPath(repoRoot, lint.configFile),
        sampleOf: lint.sampleOf,
        settings: {
            repoRoot,
            // Опции правила перекрывают `settings.weld` — печатается то же, что увидит линтер.
            aliasesBaseUrl: getAliasesBaseUrl(lint.settings, lint.options?.aliasesBaseUrl),
            tsconfig: getTsconfigName(lint.settings, lint.options?.tsconfig),
            aliases: target.getAliases(),
        },
    };
}
