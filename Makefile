.PHONY: all build check test test-net schemas verify-ui verify-e2e verify-system dev-install dev-remove deb verify-deb clean

# Первые цели — для dh_auto_build/dh_auto_test: сборки нет, тесты отдельной целью.
all: build

build:
	@echo "deepmon: сборки нет, исходники используются как есть"

check: test

test:
	gjs -m tests/run.js --skip net.test.js

test-net:
	gjs -m tests/run.js --only net.test.js

schemas:
	glib-compile-schemas src/deepmon@fstronin/schemas

verify-ui:
	bash tests/headless.sh

verify-e2e:
	DEEPMON_MODE=e2e bash tests/headless.sh

verify-system:
	DEEPMON_MODE=system bash tests/headless.sh

dev-install:
	install -d "$(HOME)/.local/share/gnome-shell/extensions/deepmon@fstronin"
	cp -a src/deepmon@fstronin/. "$(HOME)/.local/share/gnome-shell/extensions/deepmon@fstronin/"
	glib-compile-schemas "$(HOME)/.local/share/gnome-shell/extensions/deepmon@fstronin/schemas"

dev-remove:
	rm -rf "$(HOME)/.local/share/gnome-shell/extensions/deepmon@fstronin"

deb: clean
	@if command -v dh >/dev/null 2>&1; then \
		dpkg-buildpackage -us -uc -b; \
	else \
		echo "debhelper не установлен — локальная сборка (каноническая: sudo apt install debhelper)"; \
		bash tests/build-deb.sh; \
	fi

verify-deb:
	bash tests/verify-deb.sh

clean:
	rm -rf tests/tmp
	rm -f src/deepmon@fstronin/schemas/gschemas.compiled
	rm -rf debian/.debhelper debian/debhelper-build-stamp debian/files debian/*.substvars debian/*.debhelper
