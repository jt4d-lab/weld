/**
 * Единственное место CLI, которое знает про ESLint: путь → `settings` эффективного ESLint-конфига.
 * Наружу отдается минимум (`{ filePath, settings, sampleOf? }`), а не `Linter.Config`, поэтому
 * `eslint` не течет ни в рендер вывода, ни в команды.
 *
 * `eslint` грузится динамически: статический `import` упал бы на загрузке модуля, до любой
 * диагностики, и в проекте без ESLint пользователь увидел бы стектрейс вместо сообщения.
 */

import type { Dirent, Stats } from 'node:fs';
import { readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

import { isModuleExtension } from '@/extensions.js';

/**
 * То, что CLI получает от ESLint-конфига. `settings` — сырая секция, ее формат знает
 * `src/settings/`; `sampleOf` — аргумент директории в том виде, как его ввели.
 */
export type LintSettings = {
    filePath: string;
    settings: unknown;
    sampleOf?: string;
};

/** Минимум от ESLint-конфига: `settings` без `Linter.Config` и без типов ESLint за границей модуля. */
type EslintConfig = { settings?: unknown };

/** Минимум от инстанса ESLint — ровно один вопрос, который задает CLI. */
type EslintInstance = {
    calculateConfigForFile(filePath: string): Promise<EslintConfig | undefined>;
};

/** Сообщение для проекта, в котором `eslint` не установлен: стектрейс тут ничего не объясняет. */
const ESLINT_MISSING = 'eslint is not installed in this project';

/** Директории, в которые обход не заходит: `node_modules` и всё скрытое (`.git` и прочее). */
function isSkippedDir(name: string): boolean {
    return name === 'node_modules' || name.startsWith('.');
}

/** Сравнение по имени — обход обязан быть алфавитным, а не в порядке, в котором отдаст ФС. */
function byName(a: { name: string }, b: { name: string }): number {
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

/** `stat` без исключения: отсутствующий путь — обычный ответ «его нет», а не падение. */
function statOf(path: string): Stats | null {
    try {
        return statSync(path);
    } catch {
        return null;
    }
}

/** `ESLint` из проекта: `loadESLint()` берет flat-конфиг и на ESLint 9, и на ESLint 10. */
async function createEslint(cwd: string): Promise<EslintInstance> {
    const eslint = await import('eslint').catch(() => {
        throw new Error(ESLINT_MISSING);
    });

    const ESLintCtor = await eslint.loadESLint();
    return new ESLintCtor({ cwd });
}

function isMissingConfigError(error: unknown): boolean {
    return error instanceof Error && /could not find config file/i.test(error.message);
}

/**
 * Конфиг конкретного файла. Отсутствие конфига в проекте и игнорируемый файл — разные ошибки:
 * первое означает, что CLI нечего показать, второе — что файл вне зоны действия ESLint.
 */
async function configForFile(
    eslint: EslintInstance,
    filePath: string,
    shownPath: string,
): Promise<EslintConfig | undefined> {
    try {
        return await eslint.calculateConfigForFile(filePath);
    } catch (error) {
        if (!isMissingConfigError(error)) {
            throw error;
        }

        throw new Error(`no eslint config found for ${shownPath}`, { cause: error });
    }
}

type Sample = { filePath: string; settings: unknown };

/** Записи директории по алфавиту; нечитаемая директория — не повод падать, она пустая для сэмпла. */
function readEntries(dir: string): Dirent[] {
    try {
        return readdirSync(dir, { withFileTypes: true }).sort(byName);
    } catch {
        return [];
    }
}

/**
 * Первый в алфавитном порядке файл директории, для которого ESLint отдал конфиг. Игнорируемые
 * файлы дают `undefined` и пропускаются: сэмплом должен быть файл, который линтер действительно
 * обрабатывает.
 */
async function findSample(
    eslint: EslintInstance,
    dir: string,
    shownPath: string,
): Promise<Sample | null> {
    for (const entry of readEntries(dir)) {
        const full = join(dir, entry.name);

        if (entry.isDirectory()) {
            if (isSkippedDir(entry.name)) {
                continue;
            }

            const nested = await findSample(eslint, full, shownPath);
            if (nested !== null) {
                return nested;
            }

            continue;
        }

        if (!entry.isFile() || !isModuleExtension(extname(entry.name).slice(1))) {
            continue;
        }

        const config = await configForFile(eslint, full, shownPath);
        if (config !== undefined) {
            return { filePath: full, settings: config.settings };
        }
    }

    return null;
}

/**
 * Настройки ESLint для файла или директории. Путь резолвится от `cwd`; для директории берется
 * сэмпл — первый линтуемый файл, потому что эффективный конфиг спрашивается у файла, а не у
 * директории.
 */
export async function loadLintSettings(path: string, cwd: string): Promise<LintSettings> {
    const target = resolve(cwd, path);
    const stats = statOf(target);

    if (stats === null) {
        throw new Error(`path does not exist: ${path}`);
    }

    const eslint = await createEslint(cwd);

    if (!stats.isDirectory()) {
        const config = await configForFile(eslint, target, path);

        if (config === undefined) {
            throw new Error(`eslint ignores ${path}`);
        }

        return { filePath: target, settings: config.settings };
    }

    const sample = await findSample(eslint, target, path);

    if (sample === null) {
        throw new Error(`no lintable files in ${path}`);
    }

    return { ...sample, sampleOf: path };
}
