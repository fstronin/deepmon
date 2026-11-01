#!/usr/bin/env bash
# Локальная сборка .deb без debhelper (на машинах, где его нет).
# Источник правды один: debian/install (карта файлов), debian/control (описание),
# debian/changelog (версия), debian/postinst|postrm (скрипты).
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

PKG=gnome-shell-extension-deepmon
VERSION=$(dpkg-parsechangelog -S Version)
OUT="../${PKG}_${VERSION}_all.deb"
STAGE=$(mktemp -d /tmp/deepmon-deb-stage-XXXXXX)
trap 'rm -rf "$STAGE"' EXIT

while read -r source target; do
    [ -z "${source:-}" ] && continue
    case "$source" in \#*) continue ;; esac
    install -d "$STAGE/$target"
    cp -a "$source" "$STAGE/$target"
done < debian/install

# Скомпилированная схема не должна попасть в каталог расширения.
rm -f "$STAGE/usr/share/gnome-shell/extensions/deepmon@fstronin/schemas/gschemas.compiled"

install -d "$STAGE/DEBIAN"
MAINTAINER=$(grep -m1 '^Maintainer:' debian/control | sed 's/^Maintainer: *//')
{
    sed -n '/^Package:/,$p' debian/control | head -1
    echo "Version: ${VERSION}"
    echo "Maintainer: ${MAINTAINER}"
    sed -n '/^Package:/,$p' debian/control | tail -n +2
} | sed -e 's/, *\${misc:Depends}//' -e 's/\${misc:Depends}//' > "$STAGE/DEBIAN/control"
install -m 0755 debian/postinst "$STAGE/DEBIAN/postinst"
install -m 0755 debian/postrm "$STAGE/DEBIAN/postrm"

gzip -9n "$STAGE/usr/share/man/man1/deepmon-key.1"

dpkg-deb --build --root-owner-group "$STAGE" "$OUT"
echo "собран пакет: $OUT"
