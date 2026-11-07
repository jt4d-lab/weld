/**
 * Слой собирает эффективную конфигурацию WELD для файла из нескольких источников: `settings.weld`,
 * переопределений из опций правила и автопоиска алиасов в tsconfig. В отличие от `src/settings/`,
 * который разбирает отдельный источник настроек, этот слой определяет приоритеты и результат для
 * конкретного файла, включая подъем корня до якорей алиасов.
 *
 * - слияние источников настроек: опции перекрывают `settings.weld` по полю;
 * - выбор источника алиасов: `options.aliases` → `settings.weld.aliases` → tsconfig;
 * - подъем корня репозитория до общей директории с якорями алиасов из tsconfig;
 * - ленивый резолв частей `WeldTarget` (`getFromFile` / `getRoot` / `getFsHost` / `getAliases`) с
 *   мемоизацией в пределах одного вызова;
 * - кривой tsconfig не валит резолв: логируется и дает пустые алиасы;
 * - шов `fsHostOverride` для тестов, без ESLint на входе и выходе.
 */

export type { WeldResolveInput, WeldResolveOptions, WeldTarget } from './resolve.js';
export { resolveForFile } from './resolve.js';
export type { ConfigReport, ConfigReportResult } from './report.js';
export { reportForFile } from './report.js';
