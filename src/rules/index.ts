import type { Rule } from 'eslint';

import { createRule as createNoBarrelBypassRule } from '@/rules/no-barrel-bypass/index.js';
import { createRule as createNoIllegalLayerDependencyRule } from '@/rules/no-illegal-layer-dependency/index.js';

export const rules = {
    'no-barrel-bypass': createNoBarrelBypassRule(),
    'no-illegal-layer-dependency': createNoIllegalLayerDependencyRule(),
} satisfies Record<string, Rule.RuleModule>;
