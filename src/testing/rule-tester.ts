import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';

/**
 * Общая настройка `RuleTester` — парсер и уровень языка в одном месте на все правила. К баррелям
 * отношения не имеет, поэтому живёт здесь, а не в директории конкретного правила: иначе тесты
 * второго правила либо тянули бы его через сосед-правило, либо завели бы свою копию, и настройки
 * парсера у двух правил разъехались бы.
 */
export function createRuleTester(): RuleTester {
    return new RuleTester({
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            parser: tseslint.parser,
        },
    });
}
