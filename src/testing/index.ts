/**
 * Публичный интерфейс модуля: общий каркас тестов — тестер правил и пути к фикстуре.
 *
 * Сама фикстура (`fixtures/project/`) через баррель не проходит и не может: тесты обращаются к ней
 * как к путям на диске, а не как к модулям.
 */

export { consumerFile, fixtureRoot, repoRoot } from './paths.js';
export { createRuleTester } from './rule-tester.js';
