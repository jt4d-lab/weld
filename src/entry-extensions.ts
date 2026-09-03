/**
 * Расширения, при которых файл считается точкой входа директории (`index.<ext>`). Нужна
 * нормализации якорей алиасов, `findBarrier` и fs-реализации порта — общая константа не даёт
 * трём местам разойтись в списке.
 */
export const ENTRY_EXTENSIONS = ['ts', 'tsx', 'js', 'jsx', 'mts', 'cts', 'mjs', 'cjs'] as const;

/**
 * Является ли `basename` (имя файла без директории) точкой входа — `index` с расширением из
 * `ENTRY_EXTENSIONS`. Используется и нормализацией якорей алиасов, и `findBarrier` — общий
 * предикат не даёт им разойтись в трактовке "что считать index-файлом".
 */
export function isEntryPointBasename(basename: string): boolean {
    const dotIndex = basename.lastIndexOf('.');
    if (dotIndex === -1) {
        return false;
    }

    const name = basename.slice(0, dotIndex);
    const extension = basename.slice(dotIndex + 1);
    return name === 'index' && (ENTRY_EXTENSIONS as readonly string[]).includes(extension);
}
