#!/usr/bin/env bash
# Headless-проверка расширения: отдельный gnome-shell с probe-расширением включает
# deepmon, читает реальные акторы и пишет JSON-отчёт.
# DEEPMON_MODE=e2e дополнительно поднимает mock-сервер, кладёт ключ и настраивает схему.
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
MODE=${DEEPMON_MODE:-static}
WORK=$(mktemp -d /tmp/deepmon-headless-XXXXXX)
SHELL_LOG="$WORK/shell.log"
REPORT="$WORK/report.json"
MOCK_PID=""

cleanup() {
    [ -n "$MOCK_PID" ] && kill "$MOCK_PID" 2>/dev/null || true
    rm -rf "$WORK"
}
trap cleanup EXIT

export HOME="$WORK/home"
export XDG_DATA_HOME="$WORK/data"
export XDG_CONFIG_HOME="$WORK/config"
export XDG_STATE_HOME="$WORK/state"
export XDG_CACHE_HOME="$WORK/cache"
export GSETTINGS_BACKEND=keyfile
mkdir -p "$HOME" "$XDG_DATA_HOME/gnome-shell/extensions" "$XDG_CONFIG_HOME" "$XDG_STATE_HOME" "$XDG_CACHE_HOME"

cp -a "$ROOT/src/deepmon@fstronin" "$XDG_DATA_HOME/gnome-shell/extensions/deepmon@fstronin"
if [ "$MODE" = "system" ]; then
    # Системная установка: схемы лежат только в системном каталоге, каталога schemas/
    # внутри расширения нет — ровно как в пакете.
    rm -rf "$XDG_DATA_HOME/gnome-shell/extensions/deepmon@fstronin/schemas"
else
    glib-compile-schemas "$XDG_DATA_HOME/gnome-shell/extensions/deepmon@fstronin/schemas"
fi

SCHEMA_DIR="$WORK/schemas"
mkdir -p "$SCHEMA_DIR"
cp "$ROOT/src/deepmon@fstronin/schemas/org.gnome.shell.extensions.deepmon.gschema.xml" "$SCHEMA_DIR/"
glib-compile-schemas "$SCHEMA_DIR"
export GSETTINGS_SCHEMA_DIR="$SCHEMA_DIR"

PROBE_DIR="$XDG_DATA_HOME/gnome-shell/extensions/probe@test"
mkdir -p "$PROBE_DIR"
cp "$ROOT/tests/probe/probe@test/metadata.json" "$PROBE_DIR/"
sed "s|@REPORT@|$REPORT|" "$ROOT/tests/probe/probe@test/extension.js" > "$PROBE_DIR/extension.js"

HISTORY=""
if [ "$MODE" = "e2e" ]; then
    mkdir -p "$XDG_CONFIG_HOME/deepmon"
    printf 'sk-test000000000000000000\n' > "$XDG_CONFIG_HOME/deepmon/key"
    chmod 600 "$XDG_CONFIG_HOME/deepmon/key"
    python3 "$ROOT/tests/mock_server.py" 18087 60 >/dev/null 2>&1 &
    MOCK_PID=$!
    sleep 0.5
    gsettings set org.gnome.shell.extensions.deepmon api-base-url 'http://127.0.0.1:18087/ok'
    gsettings set org.gnome.shell.extensions.deepmon key-file "$XDG_CONFIG_HOME/deepmon/key"
    gsettings set org.gnome.shell.extensions.deepmon refresh-minutes 1
    export PROBE_EXPECT='¥118.40'
    EXPECT_LABEL='¥118.40'
    EXPECT_BARS='14'
    HISTORY="$XDG_STATE_HOME/deepmon/history.json"
else
    export PROBE_EXPECT='DeepSeek'
    EXPECT_LABEL='DeepSeek ⚠'
    EXPECT_BARS=''
fi

gsettings set org.gnome.shell enabled-extensions "['probe@test']"

timeout 200 dbus-run-session -- bash -s <<INNER || true
set -u
export HOME="$HOME" XDG_DATA_HOME="$XDG_DATA_HOME" XDG_CONFIG_HOME="$XDG_CONFIG_HOME"
export XDG_STATE_HOME="$XDG_STATE_HOME" XDG_CACHE_HOME="$XDG_CACHE_HOME"
export GSETTINGS_BACKEND=keyfile GSETTINGS_SCHEMA_DIR="$GSETTINGS_SCHEMA_DIR" LIBGL_ALWAYS_SOFTWARE=1
export PROBE_EXPECT="${PROBE_EXPECT:-}"
gnome-shell --wayland --headless > "$SHELL_LOG" 2>&1 &
SHELL_PID=\$!
for i in \$(seq 1 150); do
    if gdbus call --session --dest org.freedesktop.DBus --object-path /org/freedesktop/DBus \
        --method org.freedesktop.DBus.NameHasOwner org.gnome.Shell 2>/dev/null | grep -q true; then
        break
    fi
    sleep 0.2
done
for i in \$(seq 1 250); do
    if [ -f "$REPORT" ] && grep -q '"done":true' "$REPORT"; then
        break
    fi
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
    grep -iE 'deepmon|probe|Gjs-CRITICAL|JS Error|JS ERROR' "$SHELL_LOG" | tail -40 || true
fi

cat "$REPORT"
echo
set +e
python3 - "$REPORT" "$EXPECT_LABEL" "$EXPECT_BARS" "$HISTORY" <<'PY'
import json
import sys

report = json.load(open(sys.argv[1]))
expected_label, expected_bars, history = sys.argv[2], sys.argv[3], sys.argv[4]
checks = {
    'indicatorFound': report.get('indicatorFound') is True,
    'labelText': report.get('labelText') == expected_label,
    'menuItems': len(report.get('menuItems') or []) == 4,
    'noLeak': report.get('uiGroupChildrenAfterDisable') == report.get('uiGroupChildrenBefore'),
}
if expected_bars:
    checks['barCount'] = report.get('barCount') == int(expected_bars)
checks['icon'] = report.get('iconVisible') is True and report.get('iconHasGicon') is True
if history:
    try:
        state = json.load(open(history))
        checks['historyFile'] = state.get('primaryCurrency') == 'CNY' and len(state.get('samples') or []) >= 1
    except (OSError, ValueError) as error:
        print('history:', error)
        checks['historyFile'] = False
for name, ok in checks.items():
    print(('ok ' if ok else 'FAIL ') + name)
if 'enableError' in report:
    print('enableError:', report['enableError'])
sys.exit(0 if all(checks.values()) else 1)
PY
STATUS=$?
set -e
if [ "$STATUS" -ne 0 ]; then
    echo "--- shell.log tail ---"
    tail -40 "$SHELL_LOG"
fi
exit $STATUS
