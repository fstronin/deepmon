.PHONY: test test-net clean

test:
	gjs -m tests/run.js --skip net.test.js

test-net:
	gjs -m tests/run.js --only net.test.js

clean:
	rm -rf tests/tmp
