.PHONY: test test-net schemas verify-ui clean

test:
	gjs -m tests/run.js --skip net.test.js

test-net:
	gjs -m tests/run.js --only net.test.js

schemas:
	glib-compile-schemas src/deepmon@fstronin/schemas

clean:
	rm -rf tests/tmp

verify-ui:
	bash tests/headless.sh
