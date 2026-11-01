#!/usr/bin/env bash
# Проверка содержимого собранного deb-пакета без установки.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
DEB=$(ls -t "$ROOT"/../gnome-shell-extension-deepmon_*_all.deb 2>/dev/null | head -1 || true)
if [ -z "$DEB" ]; then
    echo "пакет не найден: сначала make deb"
    exit 1
fi

WORK=$(mktemp -d /tmp/deepmon-deb-XXXXXX)
trap 'rm -rf "$WORK"' EXIT
dpkg-deb -x "$DEB" "$WORK"

fail=0
check() {
    if [ -e "$WORK/$1" ]; then
        echo "ok $1"
    else
        echo "FAIL $1"
        fail=1
    fi
}

check usr/share/gnome-shell/extensions/deepmon@fstronin/metadata.json
check usr/share/gnome-shell/extensions/deepmon@fstronin/extension.js
check usr/share/gnome-shell/extensions/deepmon@fstronin/prefs.js
check usr/bin/deepmon-key
check usr/share/man/man1/deepmon-key.1.gz
check usr/share/glib-2.0/schemas/org.gnome.shell.extensions.deepmon.gschema.xml
check usr/share/glib-2.0/schemas/gnome-shell-extension-deepmon.gschema.override

if grep -q "enabled-extensions=\['deepmon@fstronin'\]" \
    "$WORK/usr/share/glib-2.0/schemas/gnome-shell-extension-deepmon.gschema.override"; then
    echo "ok расширение включается по умолчанию"
else
    echo "FAIL override не содержит enabled-extensions"
    fail=1
fi

if [ -e "$WORK/usr/share/glib-2.0/schemas/gschemas.compiled" ]; then
    echo "FAIL скомпилированная схема не должна поставляться пакетом"
    fail=1
else
    echo "ok gschemas.compiled не поставляется"
fi

if [ -e "$WORK/usr/share/gnome-shell/extensions/deepmon@fstronin/schemas" ]; then
    echo "FAIL каталог schemas попал в расширение: getSettings() ищет там gschemas.compiled и падает"
    fail=1
else
    echo "ok schemas не попадает в каталог расширения"
fi

EXT_IN_PKG="$WORK/usr/share/gnome-shell/extensions/deepmon@fstronin"
for entry in "$ROOT"/src/deepmon@fstronin/*; do
    name=$(basename "$entry")
    [ "$name" = "schemas" ] && continue
    if [ ! -e "$EXT_IN_PKG/$name" ]; then
        echo "FAIL в пакете нет $name"
        fail=1
    fi
done
echo "ok верхний уровень расширения на месте"

exit "$fail"
