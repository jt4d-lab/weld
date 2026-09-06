import type { Rule } from 'eslint';

import { createRule as createNoBarrelBypassRule } from '@/rules/no-barrel-bypass/index.js';

export const rules = {
    'no-barrel-bypass': createNoBarrelBypassRule(),
} satisfies Record<string, Rule.RuleModule>;

export type RuleName = keyof typeof rules;
