/** Расширения, которые считаются файлом точки входа (`index.<ext>`) при поиске границ модулей. */
export const ENTRY_EXTENSIONS = ['ts', 'tsx', 'js', 'jsx', 'mts', 'cts', 'mjs', 'cjs'] as const;

export type EntryExtension = (typeof ENTRY_EXTENSIONS)[number];
