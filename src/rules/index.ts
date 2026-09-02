import type { Rule } from 'eslint';

/**
 * Реестр правил плагина.
 *
 * Пока пуст: плагин опубликован как основа, правила проверки импортов
 * добавляются следующими релизами. Каждое новое правило регистрируется здесь
 * и должно иметь парный раздел в документации подхода.
 */
export const rules = {} satisfies Record<string, Rule.RuleModule>;

export type RuleName = keyof typeof rules;
