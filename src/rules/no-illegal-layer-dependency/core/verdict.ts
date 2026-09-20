/**
 * Вердикт по одному импорту: легален он или нет. Весь ответ сводится к сравнению двух позиций в
 * развёрнутом порядке слоёв — `first(цель) < last(источник)`. Диапазон повторяющегося имени (`module`
 * вокруг слоёв модуля) этим же сравнением и работает, поэтому особых случаев у направления нет.
 *
 * Здесь же живёт классификация нарушений: какое из сообщений правила описывает найденный случай и
 * какими именами слоёв оно заполняется. Квалификатор в сообщениях не показывается — пользователь
 * писал в конфиг простые имена (`plainLayerName`).
 *
 * Чего здесь нет: проверки самого линтуемого файла (слоя источника может не быть в схеме — такой
 * файл правило репортит целиком, до обхода импортов) и специфаера, как он записан в исходнике: его
 * подставляет в данные сообщения вызывающий, разбор путей сюда не доходит.
 */

import type { LayerSchema, Qualified } from '@/settings/index.js';
import { MODULE, MODULE_UNKNOWN, plainLayerName, ROOT_UNKNOWN } from '@/settings/index.js';

import type { LayerLocation } from '@/rules/no-illegal-layer-dependency/core/layer-of.js';

/** Сообщения правила, которые выдаёт вердикт. `undeclaredLayer` сюда не входит: он про файл целиком. */
export type MessageId =
    'illegalDependency' | 'horizontalDependency' | 'undeclaredTargetLayer' | 'moduleInternals';

export type Verdict =
    { ok: true } | { ok: false; messageId: MessageId; data: Record<string, string> };

const OK: Verdict = { ok: true };

/**
 * Права источника: неразмеченный код модуля получает права модуля целиком. Такой файл — часть
 * модуля, и импортировать он вправе всё, что вправе модуль; объявленный `@unknown` в `moduleLayers`
 * управляет только доступом к такому коду извне, то есть целью, а не источником.
 *
 * Цена принята осознанно: неразмеченный код модуля получает права шире, чем размеченный (`module` —
 * диапазон, `module:entities` — точка).
 */
export function sourceRights(layer: Qualified): Qualified {
    return layer === MODULE_UNKNOWN ? MODULE : layer;
}

/** Легален ли импорт из `from` в `to`. `from` и `to` — результаты `layerOf`. */
export function decide(schema: LayerSchema, from: LayerLocation, to: LayerLocation): Verdict {
    // Общий владелец — одна директория слоя (или один модуль), её внутренние связи правилу не
    // принадлежат. Два `null` общим владельцем не считаются: код вне слоёв и вне модулей не образует
    // целого, внутри которого что-то было бы «своим».
    if (from.owner !== null && from.owner === to.owner) {
        return OK;
    }

    const fromLayer = sourceRights(from.layer);
    const position = schema.first.get(to.layer);
    if (position === undefined) {
        return undeclaredTarget(from, to, fromLayer);
    }

    // Слоя источника может не быть в схеме — тогда у него нет и позиции: такое место недостижимо и
    // само импортировать не может. `-1` меньше любой позиции, поэтому отдельной ветки не нужно.
    const reach = schema.last.get(fromLayer) ?? -1;
    if (position < reach) {
        return OK;
    }

    return fromLayer === to.layer
        ? violation('horizontalDependency', { layer: plainLayerName(fromLayer) })
        : illegal(fromLayer, to.layer);
}

/**
 * Цели нет в схеме: слой у неё есть, но проект его не объявлял. Таких слоёв ровно три — оба
 * неразмеченных и модуль как целое, — и каждый разбирается по-своему, потому что по-своему
 * исправляется.
 */
function undeclaredTarget(from: LayerLocation, to: LayerLocation, fromLayer: Qualified): Verdict {
    if (to.layer === MODULE_UNKNOWN) {
        if (to.moduleRoot !== null && to.moduleRoot === from.moduleRoot) {
            // Неразмеченный файл своего же модуля: совет «иди через баррель» был бы здесь советом
            // импортировать самого себя, поэтому остаётся разметка.
            return declareTarget(to.layer, `'@unknown' in moduleLayers`);
        }

        return violation('moduleInternals', { fromLayer: plainLayerName(fromLayer) });
    }

    if (to.layer === ROOT_UNKNOWN) {
        return declareTarget(to.layer, `'@unknown' in layers`);
    }

    if (to.layer === MODULE) {
        return declareTarget(to.layer, `'@modules' in layers`);
    }

    // Обычные имена слоёв в индексах есть всегда: `layerOf` берёт их из тех же наборов, которые
    // разбор схемы положил в порядок. Ветка нужна для тотальности, а не для случая.
    return illegal(fromLayer, to.layer);
}

function declareTarget(layer: Qualified, declare: string): Verdict {
    return violation('undeclaredTargetLayer', { layer: plainLayerName(layer), declare });
}

function illegal(fromLayer: Qualified, toLayer: Qualified): Verdict {
    return violation('illegalDependency', {
        fromLayer: plainLayerName(fromLayer),
        toLayer: plainLayerName(toLayer),
    });
}

function violation(messageId: MessageId, data: Record<string, string>): Verdict {
    return { ok: false, messageId, data };
}
