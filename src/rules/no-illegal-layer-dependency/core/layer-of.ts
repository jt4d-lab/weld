/**
 * Опознание слоя по виртуальному пути: где в дереве проходят границы модулей и какой из объявленных
 * слоёв заявляет директория. Диск здесь не при чём — слой читается из имён сегментов, поэтому
 * существование пути не проверяется и знать о нём правилу незачем.
 *
 * Слой — **самое глубокое** совпадение в своём контексте: директория заявляет свой уровень на любой
 * глубине, и заявление читается буквально. Известная цена — вложенная папка с именем более высокого
 * слоя расширяет права файла (`src/common/utils/app/` даёт `app`); принята осознанно.
 *
 * Контекстов два, и набор имён у них разный: вне модулей сегменты сверяются с `projectLayers`,
 * внутри модуля — с `moduleLayers`. Поэтому вход в модуль сбрасывает найденный снаружи слой: у
 * модуля своя система слоёв, и `pages` проекта внутри модуля — просто директория.
 */

import { isEntryBasename } from '@/extensions.js';
import { basename, dirname, joinPath, segments, splitExtension } from '@/path/index.js';
import type { LayerSchema, Qualified } from '@/settings/index.js';
import { MODULE, MODULE_UNKNOWN, moduleLayer, ROOT_UNKNOWN, rootLayer } from '@/settings/index.js';

/**
 * Что за путь опознаётся. У линтуемого файла сканируется только его директория: имя файла слоя не
 * заявляет — кроме точки входа прямо в директории модуля, единственного места, где имя файла решает
 * (`module` против `module:unknown`, см. {@link isModuleEntry}). У цели импорта сканируются все
 * сегменты записанного пути: `@/modules/order` это баррель модуля, и разворачивать его в
 * `…/order/index.ts` нельзя, иначе самый канонический легальный импорт репортился бы как нарушение.
 */
export type PathKind = 'file' | 'target';

export type LayerLocation = {
    /** Квалифицированный слой — ключ индексов `LayerSchema.first`/`last`. */
    layer: Qualified;
    /**
     * Директория, которой принадлежит слой: директория самого слоя, а для модуля как целого и для
     * его неразмеченного кода — директория модуля. Совпавшие владельцы делают импорт внутренним.
     * `null` — код вне слоёв и вне модулей, владеть им некому.
     */
    owner: string | null;
    /** Модуль, внутри которого лежит путь, либо `null`. Отличает свой модуль от чужого. */
    moduleRoot: string | null;
};

/** Слой, владелец и модуль пути. Схема задаёт и набор имён, и имя директории модулей. */
export function layerOf(path: string, schema: LayerSchema, kind: PathKind): LayerLocation {
    const scanned = kind === 'file' ? dirname(path) : path;
    const segs = segments(scanned);

    let moduleRoot: string | null = null;
    let layerName: string | null = null;
    let owner: string | null = null;
    let dir = '/';

    for (let i = 0; i < segs.length; i += 1) {
        const segment = segs[i] as string;
        dir = joinPath(dir, segment);

        // Директория модулей без имени модуля за ней — обычная директория: модулем она не делает
        // ничего. Поиск `moduleDir` продолжается и после найденного слоя — модуль вправе лежать
        // внутри компонента слоя.
        const moduleName = segment === schema.moduleDir ? segs[i + 1] : undefined;
        if (moduleName !== undefined) {
            i += 1;
            dir = joinPath(dir, moduleName);
            moduleRoot = dir;
            layerName = null;
            owner = null;
            continue;
        }

        const names = moduleRoot === null ? schema.projectLayers : schema.moduleLayers;
        if (names.has(segment)) {
            // Перезапись, а не первое совпадение, — этим и задаётся deepest.
            layerName = segment;
            owner = dir;
        }
    }

    if (layerName !== null) {
        // Слой найден после последнего входа в модуль, поэтому контекст определяется тем же
        // `moduleRoot`, по которому выбирался набор имён.
        return {
            layer: moduleRoot === null ? rootLayer(layerName) : moduleLayer(layerName),
            owner,
            moduleRoot,
        };
    }

    if (moduleRoot === null) {
        return { layer: ROOT_UNKNOWN, owner: null, moduleRoot: null };
    }

    return {
        layer: isModuleEntry(path, moduleRoot) ? MODULE : MODULE_UNKNOWN,
        owner: moduleRoot,
        moduleRoot,
    };
}

/**
 * Публичный интерфейс модуля: сам модуль (цель вида `@/modules/order`) либо точка входа прямо в его
 * директории (`…/order/index.ts`). Единственное место, где смотрится имя файла, — и только у модуля:
 * баррель слоя остаётся слоем, а `…/order/lib/index.ts` — внутренностью модуля.
 */
function isModuleEntry(path: string, moduleRoot: string): boolean {
    if (path === moduleRoot) {
        return true;
    }

    return isEntryBasename(splitExtension(basename(path)).name) && dirname(path) === moduleRoot;
}
