#!/usr/bin/env bash
#
# Проверяет, что опубликованный вид пакета действительно подключается в чужом
# проекте: собирает тарбол ровно так, как это сделает `npm publish`, ставит его
# во временный проект, запускает там ESLint и проверяет установленный бинарь
# `weld`: команды, флаги, коды возврата и выбор конфига в монорепе.
#
# Использование: scripts/smoke-test.sh [версия-eslint]
#
# Версия ESLint по умолчанию — старший поддерживаемый мажор, а не latest: выход
# нового мажора не должен менять результат проверки без правки в репозитории.

set -euo pipefail

ESLINT_VERSION="${1:-10}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

read -r PKG_NAME PKG_VERSION < <(node -p "const p=require('$ROOT/package.json'); p.name+' '+p.version")

echo "==> Собираю тарбол $PKG_NAME@$PKG_VERSION"
(cd "$ROOT" && yarn pack --out "$TMP/plugin.tgz" >/dev/null)

echo "==> Готовлю временный проект в $TMP/project (eslint@$ESLINT_VERSION)"
mkdir -p "$TMP/project/src"
cd "$TMP/project"

# Конфиг проекта-потребителя: рекомендуемый набор плюс files-слой на src. Сценарии отличаются только
# настройками WELD — ради этого их и сравнивают, — поэтому конфиг пишется один раз, а различие
# приходит параметром: префикс алиаса без `/*`, пусто — конфиг без настроек вовсе.
write_config() {
    local path="$1" alias_prefix="${2:-}"
    {
        cat <<'CONFIG'
import weld from 'eslint-plugin-weld';

export default [
  weld.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
CONFIG
        if [ -n "$alias_prefix" ]; then
            printf "    settings: { weld: { aliases: { '%s/*': ['./src/*'] } } },\n" "$alias_prefix"
        fi
        cat <<'CONFIG'
  },
];
CONFIG
    } > "$path"
}

cat > package.json <<'JSON'
{
  "name": "weld-smoke-consumer",
  "private": true,
  "version": "0.0.0",
  "type": "module"
}
JSON

write_config "$TMP/project/eslint.config.js"

cat > src/example.js <<'JS'
import { helper } from './helper.js';

export const value = helper();
JS

npm install --silent --no-audit --no-fund "$TMP/plugin.tgz" "eslint@$ESLINT_VERSION"

echo "==> Проверяю, что плагин грузится как ESM-модуль и попадает в конфиг"
node --input-type=module -e "
  import assert from 'node:assert/strict';
  import { ESLint } from 'eslint';

  const plugin = (await import('$PKG_NAME')).default;
  assert.equal(plugin.meta.name, '$PKG_NAME');
  assert.equal(plugin.meta.version, '$PKG_VERSION', 'версия в meta не совпала с package.json');
  assert.ok(plugin.configs.recommended, 'нет configs.recommended');
  assert.ok(plugin.rules && typeof plugin.rules === 'object', 'нет реестра правил');
  console.log('    meta:', JSON.stringify(plugin.meta));

  const config = await new ESLint().calculateConfigForFile('src/example.js');
  const plugins = Array.isArray(config.plugins) ? config.plugins : Object.keys(config.plugins ?? {});
  assert.ok(plugins.includes('weld'), 'плагин weld не найден в конфиге, plugins = ' + plugins.join(', '));
  console.log('    plugins:', plugins.join(', '));
"

echo "==> Запускаю ESLint в проекте-потребителе"
npx --no-install eslint src/example.js

# CLI проверяется здесь, а не в unit-тестах: `bin` из `package.json`, shebang и второй entry `tsup`
# живут только в упакованном виде, и увидеть их может только установленный пакет.
CLI="./node_modules/.bin/weld"

echo "==> Проверяю, что бинарь weld установлен и исполняемый"
test -x "$CLI"
[ "$($CLI --version)" = "$PKG_VERSION" ] || { echo "    --version не совпал с package.json: $($CLI --version)" >&2; exit 1; }
echo "    version: $($CLI --version)"

echo "==> Проверяю weld inspect и weld config в проекте-потребителе"
# `--no-color` в проверках с grep: под FORCE_COLOR вывод был бы с escape-последовательностями.
# `file:` и `config:` печатаются от корня репозитория: корень зависит от места запуска, а вывод — нет.
INSPECT="$($CLI inspect --no-color src/example.js)"
grep -q '^file:  src/example.js$' <<<"$INSPECT" || { echo "    неверный file: $INSPECT" >&2; exit 1; }
grep -q '^alias: ' <<<"$INSPECT" || { echo "    нет строки alias: $INSPECT" >&2; exit 1; }
echo "$INSPECT" | sed 's/^/    /'

CONFIG="$($CLI config --no-color src)"
grep -qxF 'file:   src/example.js (sample of src)' <<<"$CONFIG" || { echo "    неверная строка file: $CONFIG" >&2; exit 1; }
grep -qxF 'config: eslint.config.js' <<<"$CONFIG" || { echo "    неверная строка config: $CONFIG" >&2; exit 1; }
grep -q '^  repoRoot: ' <<<"$CONFIG" || { echo "    нет repoRoot: $CONFIG" >&2; exit 1; }
grep -q '^  aliases: (none)$' <<<"$CONFIG" || { echo "    неверные aliases: $CONFIG" >&2; exit 1; }
echo "$CONFIG" | sed 's/^/    /'

$CLI config --json src > "$TMP/config.json"
node -e "
  const assert = require('node:assert/strict');
  const data = require('$TMP/config.json');
  assert.equal(data.sampleOf, 'src');
  assert.equal(data.file, 'src/example.js');
  assert.equal(data.configFile, 'eslint.config.js');
  assert.equal(data.settings.repoRoot, '$TMP/project', 'repoRoot должен остаться абсолютным');
  assert.ok(Array.isArray(data.settings.aliases), 'aliases — не массив');
  console.log('    json: ' + JSON.stringify(data.settings));
"

echo "==> Проверяю, что --config отменяет поиск конфига"
# Настройки второго конфига отличаются от найденного (`@smoke/*` против пустых алиасов), иначе
# проверка не отличила бы примененный конфиг от подобранного поиском.
write_config "$TMP/project/eslint.config.other.mjs" '@smoke'

OTHER="$($CLI config --no-color --config eslint.config.other.mjs src)"
grep -qxF 'config: eslint.config.other.mjs' <<<"$OTHER" || { echo "    применен не тот конфиг: $OTHER" >&2; exit 1; }
grep -qxF '    @smoke/* → /src/*' <<<"$OTHER" || { echo "    настройки не из --config: $OTHER" >&2; exit 1; }
echo "$OTHER" | sed 's/^/    /'

echo "==> Проверяю, что конфиг не становится сэмплом директории"
# `eslint.config.other.mjs` лежит в корне проекта и попадает под конфиг без `files`, но сэмплом он
# быть не может: иначе `weld config .` печатал бы настройки конфига вместо файла проекта.
DOT="$($CLI config --no-color .)"
grep -qxF 'file:   src/example.js (sample of .)' <<<"$DOT" || { echo "    сэмплом стал не файл проекта: $DOT" >&2; exit 1; }
grep -qxF 'config: eslint.config.js' <<<"$DOT" || { echo "    неверная строка config: $DOT" >&2; exit 1; }
echo "$DOT" | sed 's/^/    /'

echo "==> Проверяю, что конфиг выбирается по пути аргумента, а не по cwd"
# Регрессия, ради которой появился собственный поиск: на ESLint 9 конфиг ищется только от `cwd`,
# поэтому из корня проекта виден лишь корневой конфиг. Пакетный обязан выиграть — и по строке
# `config:`, и по настройкам, иначе проверка ничего не отличает.
mkdir -p packages/a/src

write_config "$TMP/project/packages/a/eslint.config.js" '@pkg'

cat > packages/a/src/x.js <<'PACKAGE_FILE'
export const x = 1;
PACKAGE_FILE

NESTED="$($CLI config --no-color packages/a/src/x.js)"
grep -qxF 'file:   packages/a/src/x.js' <<<"$NESTED" || { echo "    неверный file: $NESTED" >&2; exit 1; }
grep -qxF 'config: packages/a/eslint.config.js' <<<"$NESTED" || { echo "    применен не пакетный конфиг: $NESTED" >&2; exit 1; }
grep -qxF '    @pkg/* → /src/*' <<<"$NESTED" || { echo "    настройки не из пакетного конфига: $NESTED" >&2; exit 1; }
echo "$NESTED" | sed 's/^/    /'

# Директория: конфиг выбирается по самому пути, а сэмплом становится файл пакета, а не его конфиг
# (`eslint.config.js` сортируется раньше `src/`).
NESTED_DIR="$($CLI config --no-color packages/a)"
grep -qxF 'file:   packages/a/src/x.js (sample of packages/a)' <<<"$NESTED_DIR" || { echo "    сэмплом стал не файл пакета: $NESTED_DIR" >&2; exit 1; }
grep -qxF 'config: packages/a/eslint.config.js' <<<"$NESTED_DIR" || { echo "    применен не пакетный конфиг: $NESTED_DIR" >&2; exit 1; }

echo "==> Проверяю, что сэмпл принадлежит выбранному конфигу"
# Файлы пакета описывает его собственный конфиг: `config packages` не должен печатать файл пакета
# вместе с корневым `config:` — прямой запрос того же файла ответил бы другим конфигом и другими
# настройками, то есть пара `file:`/`config:` описывала бы разные конфиги одного файла.
set +e
PACKAGES="$($CLI config --no-color packages 2>&1 >/dev/null)"
PACKAGES_CODE=$?
set -e
[ "$PACKAGES_CODE" -ne 0 ] || { echo "    файл пакета стал сэмплом packages: $PACKAGES" >&2; exit 1; }
grep -qxF 'error: no lintable files in packages' <<<"$PACKAGES" || { echo "    неверное сообщение: $PACKAGES" >&2; exit 1; }
echo "    $PACKAGES"

# Tool-конфиг в корне проекта: `jest.config.js` сортируется раньше `src/`, но настроек WELD ему не
# достается. Глобальный слой подключен так же, как в README (`weld.configs.recommended` на все файлы), —
# без него проверка ничего не отличает: конфиг из одних files-слоев сам оставляет tool-конфиги без
# значений по умолчанию. Глобальный слой делает конфиг любого линтуемого файла непустым, и отсеивать
# tool-конфиг должно именно отсутствие настроек.
mkdir -p "$TMP/tool/src"
ln -s "$TMP/project/node_modules" "$TMP/tool/node_modules"
echo '{ "name": "weld-smoke-tool", "private": true, "type": "module" }' > "$TMP/tool/package.json"
write_config "$TMP/tool/eslint.config.js" '@tool'
echo 'export default {};' > "$TMP/tool/jest.config.js"
touch "$TMP/tool/src/a.js"
TOOL="$(cd "$TMP/tool" && "$TMP/project/node_modules/.bin/weld" config --no-color .)"
grep -qxF 'file:   src/a.js (sample of .)' <<<"$TOOL" || { echo "    сэмплом стал tool-конфиг: $TOOL" >&2; exit 1; }
grep -qxF 'config: eslint.config.js' <<<"$TOOL" || { echo "    неверная строка config: $TOOL" >&2; exit 1; }
grep -qxF '    @tool/* → /src/*' <<<"$TOOL" || { echo "    настройки не из конфига проекта: $TOOL" >&2; exit 1; }
echo "$TOOL" | sed 's/^/    /'

echo "==> Проверяю отрицательные случаи: код 1 и сообщение об ошибке"
set +e
TEXT_ERROR="$($CLI inspect src/missing.js 2>&1 >/dev/null)"
TEXT_CODE=$?
JSON_ERROR="$($CLI inspect --json src/missing.js 2>/dev/null)"
JSON_CODE=$?
set -e

[ "$TEXT_CODE" -ne 0 ] || { echo "    отсутствующий путь не вернул код ошибки" >&2; exit 1; }
grep -q '^error: path does not exist: src/missing.js$' <<<"$TEXT_ERROR" || { echo "    неверное сообщение: $TEXT_ERROR" >&2; exit 1; }
[ "$JSON_CODE" -ne 0 ] || { echo "    отсутствующий путь в --json не вернул код ошибки" >&2; exit 1; }
grep -q '"error": "path does not exist: src/missing.js"' <<<"$JSON_ERROR" || { echo "    неверный JSON ошибки: $JSON_ERROR" >&2; exit 1; }
echo "    $TEXT_ERROR"

# Проект без ESLint-конфига: `eslint` есть (через симлинк на node_modules), конфига нет.
mkdir -p "$TMP/standalone/src"
ln -s "$TMP/project/node_modules" "$TMP/standalone/node_modules"
echo '{ "name": "weld-smoke-standalone", "private": true, "type": "module" }' > "$TMP/standalone/package.json"
touch "$TMP/standalone/src/a.js"
set +e
CONFIGLESS="$(cd "$TMP/standalone" && "$TMP/project/node_modules/.bin/weld" config --no-color src/a.js 2>&1 >/dev/null)"
CONFIGLESS_CODE=$?
set -e
[ "$CONFIGLESS_CODE" -ne 0 ] || { echo "    проект без конфига не вернул код ошибки" >&2; exit 1; }
grep -q '^error: no eslint config found for src/a.js$' <<<"$CONFIGLESS" || { echo "    неверное сообщение: $CONFIGLESS" >&2; exit 1; }
echo "    $CONFIGLESS"

echo "==> Smoke-тест пройден"
