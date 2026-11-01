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
check usr/share/glib-2.0/schemas/gschemas.compiled

if [ -e "$WORK/usr/share/gnome-shell/extensions/deepmon@fstronin/schemas/gschemas.compiled" ]; then
    echo "FAIL скомпилированная схема попала в каталог расширения"
    fail=1
fi

if grep -q 'org.gnome.shell.extensions.deepmon' "$WORK/usr/share/glib-2.0/schemas/gschemas.compiled"; then
    echo "ok схема скомпилирована"
else
    echo "FAIL схема не скомпилирована"
    fail=1
fi

exit "$fail"
