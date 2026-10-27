import { createRequire } from 'node:module';
import type { Plugin } from 'vite';

/**
 * Словарь иконок диаграмм: слева — имя для аннотации `icon(...)`, справа — иконка
 * из пака `@iconify-json/vscode-icons` (без префикса, как в каталоге
 * https://icon-sets.iconify.design/vscode-icons/).
 */
export const DOC_ICONS = {
    // common directories
    module: 'folder-type-package',
    src: 'folder-type-src',
    private: 'folder-type-certificate',
    // layers
    app: 'folder-type-environments',
    pages: 'folder-type-route',
    widgets: 'file-type-view',
    features: 'folder-type-component',
    entities: 'folder-type-model',
    common: 'folder-type-public',
    // files
    barrel: 'file-type-package',
    typescript: 'file-type-typescript',
    react: 'file-type-reactjs',
    vue: 'file-type-vue',
} as const satisfies Readonly<Record<string, string>>;

const VIRTUAL_ID = 'virtual:weld-icons';
const RESOLVED_ID = `\0${VIRTUAL_ID}`;
const PACK = '@iconify-json/vscode-icons/icons.json';

interface IconData {
    body: string;
    width?: number;
    height?: number;
    left?: number;
    top?: number;
    rotate?: number;
    hFlip?: boolean;
    vFlip?: boolean;
}

interface IconAlias extends Partial<IconData> {
    parent: string;
}

interface IconPack {
    prefix: string;
    width?: number;
    height?: number;
    icons: Record<string, IconData>;
    aliases?: Record<string, IconAlias>;
}

function findIcon(pack: IconPack, name: string): IconData | undefined {
    const direct = pack.icons[name];
    if (direct) {
        return direct;
    }
    const parent = pack.aliases?.[name]?.parent;
    return parent ? pack.icons[parent] : undefined;
}

/** Урезает пак Iconify до иконок из словаря и отдает его виртуальным модулем. */
export function mermaidIconsPlugin(iconNames: Readonly<Record<string, string>>): Plugin {
    return {
        name: 'weld-mermaid-icons',
        resolveId: (id) => (id === VIRTUAL_ID ? RESOLVED_ID : undefined),
        load(id) {
            if (id !== RESOLVED_ID) {
                return undefined;
            }

            const pack: IconPack = createRequire(import.meta.url)(PACK);
            const icons: Record<string, IconData> = {};
            const aliases: Record<string, IconAlias> = {};
            const missing: string[] = [];

            for (const [name, iconName] of Object.entries(iconNames)) {
                const icon = findIcon(pack, iconName);
                if (!icon) {
                    missing.push(`${name} → ${iconName}`);
                    continue;
                }

                icons[iconName] = icon;
                if (name !== iconName) {
                    aliases[name] = { parent: iconName };
                }
            }

            if (missing.length > 0) {
                this.error(
                    `Unknown icons in DOC_ICONS (docs/.vitepress/mermaid-icons.ts): ${missing.join(', ')}`,
                );
            }

            const subset = {
                prefix: pack.prefix,
                width: pack.width,
                height: pack.height,
                icons,
                ...(Object.keys(aliases).length > 0 ? { aliases } : {}),
            };

            return `export default ${JSON.stringify(subset)};`;
        },
    };
}
