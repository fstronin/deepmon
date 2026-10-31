.PHONY: test test-net clean

test:
	gjs -m tests/run.js

clean:
	rm -rf tests/tmp
