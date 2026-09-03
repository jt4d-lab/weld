/** Расширения, которые считаются файлом точки входа (`index.<ext>`) при поиске границ модулей. */
export const ENTRY_EXTENSIONS = ['ts', 'tsx', 'js', 'jsx', 'mts', 'cts', 'mjs', 'cjs'] as const;

export type EntryExtension = (typeof ENTRY_EXTENSIONS)[number];

/** Входит ли расширение (без точки) в {@link ENTRY_EXTENSIONS}. */
export function isEntryExtension(ext: string): boolean {
    return (ENTRY_EXTENSIONS as readonly string[]).includes(ext);
}
