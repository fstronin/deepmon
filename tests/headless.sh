#!/usr/bin/env bash
# Headless-проверка расширения: поднимает отдельный gnome-shell с probe-расширением,
# которое включает deepmon, читает реальные акторы и пишет JSON-отчёт.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d /tmp/deepmon-headless-XXXXXX)
SHELL_LOG="$WORK/shell.log"
REPORT="$WORK/report.json"
trap 'rm -rf "$WORK"' EXIT

export HOME="$WORK/home"
export XDG_DATA_HOME="$WORK/data"
export XDG_CONFIG_HOME="$WORK/config"
export XDG_STATE_HOME="$WORK/state"
export XDG_CACHE_HOME="$WORK/cache"
export GSETTINGS_BACKEND=keyfile
mkdir -p "$HOME" "$XDG_DATA_HOME/gnome-shell/extensions" "$XDG_CONFIG_HOME" "$XDG_STATE_HOME" "$XDG_CACHE_HOME"

cp -a "$ROOT/src/deepmon@fstronin" "$XDG_DATA_HOME/gnome-shell/extensions/deepmon@fstronin"
glib-compile-schemas "$XDG_DATA_HOME/gnome-shell/extensions/deepmon@fstronin/schemas"

PROBE_DIR="$XDG_DATA_HOME/gnome-shell/extensions/probe@test"
mkdir -p "$PROBE_DIR"
cp "$ROOT/tests/probe/probe@test/metadata.json" "$PROBE_DIR/"
sed "s|@REPORT@|$REPORT|" "$ROOT/tests/probe/probe@test/extension.js" > "$PROBE_DIR/extension.js"

if [ -n "${DEEPMON_PREPARE:-}" ]; then
    bash -c "$DEEPMON_PREPARE"
fi

gsettings set org.gnome.shell enabled-extensions "['probe@test']"

timeout 200 dbus-run-session -- bash -s <<INNER || true
set -u
export HOME="$HOME" XDG_DATA_HOME="$XDG_DATA_HOME" XDG_CONFIG_HOME="$XDG_CONFIG_HOME"
export XDG_STATE_HOME="$XDG_STATE_HOME" XDG_CACHE_HOME="$XDG_CACHE_HOME"
export GSETTINGS_BACKEND=keyfile LIBGL_ALWAYS_SOFTWARE=1
gnome-shell --wayland --headless > "$SHELL_LOG" 2>&1 &
SHELL_PID=\$!
for i in \$(seq 1 150); do
    if gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus \
        --method org.freedesktop.DBus.NameHasOwner org.gnome.Shell 2>/dev/null | grep -q true; then
        break
    fi
    sleep 0.2
done
for i in \$(seq 1 200); do
    [ -f "$REPORT" ] && grep -q "\"done\":true" "$REPORT" && break
    sleep 0.2
done
kill \$SHELL_PID 2>/dev/null || true
INNER

if [ ! -f "$REPORT" ]; then
    echo "нет отчёта probe; последние строки лога шелла:"
    tail -40 "$SHELL_LOG" || true
    exit 1
fi

if [ "${DEEPMON_VERBOSE:-0}" = "1" ]; then
    grep -iE 'deepmon|probe|Gjs-CRITICAL|JS ERROR' "$SHELL_LOG" | tail -40 || true
fi

cat "$REPORT"
echo
python3 - "$REPORT" <<'PY'
import json
import sys

report = json.load(open(sys.argv[1]))
checks = {
    'indicatorFound': report.get('indicatorFound') is True,
    'labelText': report.get('labelText') == '¥118.40 ↓0.62',
    'menuItems': len(report.get('menuItems') or []) == 4,
    'barCount': report.get('barCount') == 14,
    'noLeak': report.get('uiGroupChildrenAfterDisable') == report.get('uiGroupChildrenBefore'),
}
for name, ok in checks.items():
    print(('ok ' if ok else 'FAIL ') + name)
if 'enableError' in report:
    print('enableError:', report['enableError'])
sys.exit(0 if all(checks.values()) else 1)
PY
