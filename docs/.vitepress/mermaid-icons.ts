import { createRequire } from 'node:module';
import type { Plugin } from 'vite';

/**
 * Словарь иконок диаграмм: слева — имя для аннотации `icon(...)`, справа — иконка
 * из пака `@iconify-json/vscode-icons` (без префикса, как в каталоге
 * https://icon-sets.iconify.design/vscode-icons/).
 *
 * Так исходник диаграммы остаётся про архитектуру, а не про имена иконок:
 * `icon(module)`, `icon(src)`, `icon(typescript)`.
 *
 * Mermaid рисует сам только встроенные `file`/`folder` (и проверяет их раньше
 * любого пака), поэтому эти два имени заняты и в словаре не нужны: `icon(file)`
 * и `icon(folder)` всегда встроенные. Остальные имена приходят из пака, который
 * регистрируется в `theme/index.ts`; полные имена пака тоже работают:
 * `icon(vscode-icons:folder-type-package)`.
 *
 * Слева может стоять и полное имя пака (`'file-type-vue': 'file-type-vue'`), но
 * тогда теряется весь смысл словаря. Имя, которого нет в паке, роняет dev/build.
 */
export const DOC_ICONS: Readonly<Record<string, string>> = {
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
};

/** id виртуального модуля; тот же литерал импортирует `theme/index.ts` */
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

/** Иконка по имени: сначала сам пак, потом его алиасы (у vscode-icons их два) */
function findIcon(pack: IconPack, name: string): IconData | undefined {
    const direct = pack.icons[name];
    if (direct) {
        return direct;
    }
    const parent = pack.aliases?.[name]?.parent;
    return parent ? pack.icons[parent] : undefined;
}

/**
 * Урезает пак Iconify до иконок из словаря и отдаёт его виртуальным модулем.
 *
 * `theme/index.ts` регистрирует результат в mermaid на старте приложения — со
 * стороны Mermaid это обычный синхронный пак, никаких запросов в сеть. Имена из
 * словаря, отличающиеся от имени в паке, становятся alias'ами Iconify: тело SVG
 * лежит в паке один раз, а разрешается под обоими именами.
 */
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
