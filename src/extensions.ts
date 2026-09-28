/**
 * Словарь расширений файлов — общий для всех слоёв, как и `src/path/posix.ts`.
 *
 * Списка два, потому что понятия разные, хотя сегодня их состав совпадает. Точка входа — это файл,
 * который делает директорию модулем; модуль — это то, что вообще можно импортировать как код.
 * `.vue`/`.svelte` были бы модулями, но не обязательно точками входа; `.json` импортируется, но
 * баррелем не бывает. Одним списком на оба вопроса расширение любого из них молча меняло бы ответ
 * на второй.
 */

/**
 * Имя файла точки входа без расширения. Ответ на тот же вопрос, что и {@link ENTRY_EXTENSIONS} —
 * какой файл делает директорию модулем, — поэтому живёт рядом с ним, а не литералом по слоям.
 */
const ENTRY_BASENAME = 'index';

/** Расширения файла точки входа (`index.<ext>`) — по ним ищутся границы модулей */
export const ENTRY_EXTENSIONS = ['ts', 'tsx', 'js', 'jsx', 'mts', 'cts', 'mjs', 'cjs'] as const;

/** Расширения, при которых специфаер считается импортом кода внутрь репозитория */
export const MODULE_EXTENSIONS = [...ENTRY_EXTENSIONS, 'vue', 'svelte'] as const;

/**
 * Расширения, при которых специфаер однозначно не является импортом кода: ассеты и данные.
 * Специфаеры с ними правила не проверяют и на диск не лезут.
 */
const ASSET_EXTENSIONS = [
    'css',
    'scss',
    'sass',
    'less',
    'json',
    'svg',
    'png',
    'jpg',
    'jpeg',
    'gif',
    'webp',
    'ico',
    'woff',
    'woff2',
    'ttf',
    'eot',
    'otf',
    'md',
] as const;

const ENTRY_EXTENSION_SET: ReadonlySet<string> = new Set(ENTRY_EXTENSIONS);
const MODULE_EXTENSION_SET: ReadonlySet<string> = new Set(MODULE_EXTENSIONS);
const ASSET_EXTENSION_SET: ReadonlySet<string> = new Set(ASSET_EXTENSIONS);

/** Входит ли расширение (без точки) в {@link ENTRY_EXTENSIONS}. */
function isEntryExtension(ext: string): boolean {
    return ENTRY_EXTENSION_SET.has(ext);
}

/** Имя файла точки входа с расширением: `index.ts`, `index.mjs`. */
export function entryFileName(ext: string): string {
    return `${ENTRY_BASENAME}.${ext}`;
}

/** Все имена файлов точки входа — перебор при поиске границы модуля на диске. */
export const ENTRY_FILE_NAMES: readonly string[] = ENTRY_EXTENSIONS.map(entryFileName);

/** Имя файла (без директории) — точка входа? Расширение обязано входить в {@link ENTRY_EXTENSIONS}. */
export function isEntryFileName(name: string, ext: string): boolean {
    return isEntryBasename(name) && isEntryExtension(ext);
}

/**
 * Имя без расширения — точка входа? В отличие от {@link isEntryFileName} расширение не
 * спрашивается: специфаер может быть записан и без него (`./other/index`), а вопрос «пробивает ли
 * импорт границу» от расширения не зависит. Ответ живёт здесь, а не у спрашивающего: иначе «что
 * делает директорию модулем» знали бы два слоя и разъехались бы при первой же правке.
 */
export function isEntryBasename(name: string): boolean {
    return name === ENTRY_BASENAME;
}

/** Входит ли расширение (без точки) в {@link ASSET_EXTENSIONS}. */
export function isAssetExtension(ext: string): boolean {
    return ASSET_EXTENSION_SET.has(ext);
}

/** Входит ли расширение (без точки) в {@link MODULE_EXTENSIONS}. */
export function isModuleExtension(ext: string): boolean {
    return MODULE_EXTENSION_SET.has(ext);
}
