#!/usr/bin/env bash
#
# Проверяет, что опубликованный вид пакета действительно подключается в чужом
# проекте: собирает тарбол ровно так, как это сделает `npm publish`, ставит его
# во временный проект и запускает там ESLint.
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

cat > package.json <<'JSON'
{
  "name": "weld-smoke-consumer",
  "private": true,
  "version": "0.0.0",
  "type": "module"
}
JSON

cat > eslint.config.js <<'JS'
import weld from 'eslint-plugin-weld';

export default [
  weld.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  },
];
JS

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
INSPECT="$($CLI inspect src/example.js)"
grep -q "^file:  $TMP/project/src/example.js$" <<<"$INSPECT" || { echo "    неверный file: $INSPECT" >&2; exit 1; }
grep -q '^alias: ' <<<"$INSPECT" || { echo "    нет строки alias: $INSPECT" >&2; exit 1; }
echo "$INSPECT" | sed 's/^/    /'

CONFIG="$($CLI config src)"
grep -q "^file:  $TMP/project/src/example.js (sample of src)$" <<<"$CONFIG" || { echo "    неверная строка file: $CONFIG" >&2; exit 1; }
grep -q '^  repoRoot: ' <<<"$CONFIG" || { echo "    нет repoRoot: $CONFIG" >&2; exit 1; }
grep -q '^  aliases: (none)$' <<<"$CONFIG" || { echo "    неверные aliases: $CONFIG" >&2; exit 1; }
echo "$CONFIG" | sed 's/^/    /'

$CLI config --json src > "$TMP/config.json"
node -e "
  const assert = require('node:assert/strict');
  const data = require('$TMP/config.json');
  assert.equal(data.sampleOf, 'src');
  assert.ok(data.file.endsWith('/src/example.js'), 'file = ' + data.file);
  assert.ok(data.settings && typeof data.settings.repoRoot === 'string', 'нет settings.repoRoot');
  assert.ok(Array.isArray(data.settings.aliases), 'aliases — не массив');
  console.log('    json: ' + JSON.stringify(data.settings));
"

echo "==> Smoke-тест пройден"
