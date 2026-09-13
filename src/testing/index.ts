/**
 * Публичный интерфейс модуля: общий каркас тестов — тестер правил, пути к фикстуре и временный
 * проект на диске.
 *
 * Сама фикстура (`fixtures/project/`) через баррель не проходит и не может: тесты обращаются к ней
 * как к путям на диске, а не как к модулям.
 */

export { consumerFile, consumerJsFile, fixtureRoot, repoRoot } from './paths.js';
export { createRuleTester } from './rule-tester.js';
export { cleanupTmpProjects, makeTmpProject } from './tmp-project.js';
