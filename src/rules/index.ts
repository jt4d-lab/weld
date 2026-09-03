import type { Rule } from 'eslint';

import { createEntryPointEnv } from '../env/entry-point.js';
import { createRule as createNoBarrelBypass } from './no-barrel-bypass/index.js';

export const rules = {
    'no-barrel-bypass': createNoBarrelBypass(createEntryPointEnv()),
} satisfies Record<string, Rule.RuleModule>;

export type RuleName = keyof typeof rules;
