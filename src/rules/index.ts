import type { Rule } from 'eslint';

export const rules = {} satisfies Record<string, Rule.RuleModule>;

export type RuleName = keyof typeof rules;
