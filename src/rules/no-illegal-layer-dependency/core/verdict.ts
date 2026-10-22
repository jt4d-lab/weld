/**
 * Вердикт по одному импорту: легален он или нет. Весь ответ сводится к сравнению двух позиций в
 * развёрнутом порядке слоёв — `first(цель) < last(источник)`. Диапазон повторяющегося имени (`module`
 * вокруг слоёв модуля) этим же сравнением и работает, поэтому особых случаев у направления нет.
 *
 * Здесь же живёт классификация нарушений: какое из сообщений правила описывает найденный случай и
 * какими именами слоёв оно заполняется. Квалификатор в сообщениях не показывается — пользователь
 * писал в конфиг простые имена (`plainLayerName`), — а там, где простого имени не хватает (два
 * одноимённых слоя разных уровней), уровень называется словами.
 *
 * Чего здесь нет: проверки самого линтуемого файла (слоя источника может не быть в схеме — такой
 * файл правило репортит целиком, до обхода импортов) и специфаера, как он записан в исходнике: его
 * подставляет в данные сообщения вызывающий, разбор путей сюда не доходит.
 */

import type { LayerSchema, Qualified } from '@/settings/index.js';
import { isModuleLevel, MODULE, MODULE_UNKNOWN, plainLayerName } from '@/settings/index.js';

import type { LayerLocation } from '@/rules/no-illegal-layer-dependency/core/layer-of.js';

/** Сообщения правила, которые выдаёт вердикт. `undeclaredLayer` сюда не входит: он про файл целиком. */
export type MessageId =
    | 'illegalDependency'
    | 'illegalDependencyAcrossLevels'
    | 'horizontalDependency'
    | 'undeclaredTargetLayer'
    | 'moduleInternals';

export type Verdict =
    { ok: true } | { ok: false; messageId: MessageId; data: Record<string, string> };

const OK: Verdict = { ok: true };

/**
 * Как объявить в схеме слой, которого в ней нет. Совет один и тот же на обоих концах импорта: цель
 * без объявленного слоя разбирает `decide`, а сам линтуемый файл — правило (репорт на файл целиком
 * живёт вне вердикта), и формулировка не должна расходиться между ними.
 */
export function declareHint(layer: Qualified): string {
    if (layer === MODULE) {
        return `'@modules' in layers`;
    }

    if (layer === MODULE_UNKNOWN) {
        return `'@unknown' in moduleLayers`;
    }

    // Обычные имена слоёв в схеме есть всегда — `layerOf` берёт их из её же наборов, — поэтому
    // остаётся `root:unknown`: единственный слой, которому совет и нужен.
    return `'@unknown' in layers`;
}

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
        return undeclaredTarget(schema, from, to, fromLayer);
    }

    // Слоя источника может не быть в схеме — тогда у него нет и позиции: такое место недостижимо и
    // само импортировать не может. `-1` меньше любой позиции, поэтому отдельной ветки не нужно.
    const reach = schema.last.get(fromLayer) ?? -1;
    if (position < reach) {
        return OK;
    }

    // Горизонталь — одно и то же имя слоя у разных владельцев. У кода без владельца (`root:unknown`)
    // горизонталью оказывается любой такой импорт, включая соседний файл той же директории: одним
    // целым такой код не является. Поэтому сообщение говорит «из другого `<слой>`», а не «из другой
    // директории», — второе было бы неправдой ровно в этом случае.
    return fromLayer === to.layer ? horizontal(fromLayer) : illegal(fromLayer, to.layer);
}

/**
 * Цели нет в схеме: слой у неё есть, но проект его не объявлял. Таких слоёв ровно три — оба
 * неразмеченных и модуль как целое, — и каждый разбирается по-своему, потому что по-своему
 * исправляется.
 */
function undeclaredTarget(
    schema: LayerSchema,
    from: LayerLocation,
    to: LayerLocation,
    fromLayer: Qualified,
): Verdict {
    // Необъявленными бывают ровно три слоя — оба неразмеченных и модуль как целое: обычные имена
    // `layerOf` берёт из тех же наборов, которые разбор схемы положил в порядок, и в индексах они
    // есть всегда. Отдельного разбора требует только `module:unknown` — он делится на свой модуль и
    // чужой.
    if (to.layer !== MODULE_UNKNOWN) {
        return declareTarget(to.layer);
    }

    // В схеме нет `@modules` — модулей для неё не существует вовсе, и совет про `moduleLayers` вёл
    // бы в конфиг, который разбор схемы отвергает исключением (`moduleLayers` без `@modules` —
    // ошибка), а совет идти через баррель — в такой же необъявленный слой `module`. Первый шаг
    // здесь один, и он тот же, каким правило репортит сам файл внутри такого модуля: объявить
    // `@modules`. Ветка «свой модуль» до этого места не доходит — источник внутри модуля при схеме
    // без `@modules` сам оказывается слоем вне схемы, и его импорты не проверяются.
    if (!schema.first.has(MODULE)) {
        return declareTarget(MODULE);
    }

    if (to.moduleRoot !== null && to.moduleRoot === from.moduleRoot) {
        // Неразмеченный файл своего же модуля: совет «иди через баррель» был бы здесь советом
        // импортировать самого себя, поэтому остаётся разметка.
        return declareTarget(to.layer);
    }

    return violation('moduleInternals', { fromLayer: plainLayerName(fromLayer) });
}

function declareTarget(layer: Qualified): Verdict {
    return violation('undeclaredTargetLayer', {
        layer: plainLayerName(layer),
        declare: declareHint(layer),
    });
}

/**
 * Горизонталь: слой сам себе не разрешён. Совет — смежный повтор имени, и список в нём назван
 * явно: слой модуля повторяется в `moduleLayers`, повтор того же имени в `layers` разбор схемы
 * отверг бы как обычное имя, объявленное в обоих списках.
 *
 * Модуль целиком (`module`) сюда не доходит: `@modules` всегда разворачивается в два `module`
 * вокруг слоёв модуля, то есть у него всегда диапазон, а не точка. Совет повторить `module` был бы
 * советом объявить зарезервированное имя.
 */
function horizontal(layer: Qualified): Verdict {
    return violation('horizontalDependency', {
        layer: plainLayerName(layer),
        list: isModuleLevel(layer) ? 'moduleLayers' : 'layers',
    });
}

/**
 * Нарушение направления. Простыми именами слоёв обычно и исчерпывается, но одно и то же простое имя
 * может прийти с двух уровней: `@unknown` объявляется и в `layers`, и в `moduleLayers`, и это разные
 * слои. Сообщение с двумя одинаковыми именами прочиталось бы как «слой не может импортировать сам
 * себя» (да ещё и как горизонталь, которой этот случай не является), поэтому у такой пары своё
 * сообщение — с уровнем каждого конца.
 *
 * Совпасть простые имена больше никак не могут: одно имя на одном уровне — это один и тот же слой,
 * то есть горизонталь (её разобрали выше), а обычное имя сразу в обоих списках отвергает разбор
 * схемы.
 */
function illegal(fromLayer: Qualified, toLayer: Qualified): Verdict {
    const from = plainLayerName(fromLayer);
    const to = plainLayerName(toLayer);

    if (from === to) {
        return violation('illegalDependencyAcrossLevels', {
            fromLayer: from,
            fromLevel: levelText(fromLayer),
            toLayer: to,
            toLevel: levelText(toLayer),
        });
    }

    return violation('illegalDependency', { fromLayer: from, toLayer: to });
}

/** Уровень слоя словами: то, чем различаются два одноимённых слоя в сообщении. */
function levelText(layer: Qualified): string {
    return isModuleLevel(layer) ? 'inside a module' : 'outside modules';
}

function violation(messageId: MessageId, data: Record<string, string>): Verdict {
    return { ok: false, messageId, data };
}
