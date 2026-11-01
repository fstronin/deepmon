#!/usr/bin/gjs -m
// Раннер тестов домена: находит tests/*.test.js, импортирует и прогоняет.
// Контракт файла теста: export const tests = [{name, fn}], fn(t) принимает
// ассерты t.eq / t.ok / t.deepEq; async fn поддерживается.
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import system from 'system';
// Язык тестов фиксируется окружением (LANGUAGE=en в Makefile).

const selfFile = Gio.File.new_for_uri(import.meta.url);
const testDir = GLib.path_get_dirname(selfFile.get_path());
const dir = Gio.File.new_for_path(testDir);
const enumerator = dir.enumerate_children('standard::name,standard::type',
    Gio.FileQueryInfoFlags.NONE, null);

const names = [];
for (let info = enumerator.next_file(null); info !== null; info = enumerator.next_file(null)) {
    if (info.get_file_type() === Gio.FileType.REGULAR && info.get_name().endsWith('.test.js'))
        names.push(info.get_name());
}
names.sort();

function selected(name) {
    const only = ARGV.indexOf('--only');
    const skip = ARGV.indexOf('--skip');
    if (only !== -1 && !name.includes(ARGV[only + 1]))
        return false;
    if (skip !== -1 && name.includes(ARGV[skip + 1]))
        return false;
    return true;
}

function deepEqual(a, b) {
    if (a === b)
        return true;
    if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object')
        return false;
    if (Array.isArray(a) !== Array.isArray(b))
        return false;
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length)
        return false;
    return ka.every(k => deepEqual(a[k], b[k]));
}

function makeAsserts(failures) {
    const record = (ok, label, actual, expected) => {
        if (!ok)
            failures.push({label, actual, expected});
    };
    return {
        eq: (actual, expected, label = '') => record(Object.is(actual, expected), label, actual, expected),
        ok: (cond, label = '') => record(Boolean(cond), label, Boolean(cond), true),
        deepEq: (actual, expected, label = '') => record(deepEqual(actual, expected), label, actual, expected),
    };
}

let passed = 0;
const failed = [];

for (const file of names) {
    if (!selected(file))
        continue;
    let mod;
    try {
        mod = await import(Gio.File.new_for_path(GLib.build_filenamev([testDir, file])).get_uri());
    } catch (e) {
        print(`FAIL ${file} :: import — ${e.message}`);
        failed.push(`${file} :: import`);
        continue;
    }
    for (const test of mod.tests ?? []) {
        const failures = [];
        try {
            await test.fn(makeAsserts(failures));
        } catch (e) {
            failures.push({label: 'threw', actual: e.message, expected: 'no exception'});
        }
        if (failures.length === 0) {
            passed++;
            print(`ok ${file} :: ${test.name}`);
            continue;
        }
        for (const f of failures) {
            print(`FAIL ${file} :: ${test.name}${f.label ? ` [${f.label}]` : ''}`);
            print(`  expected: ${JSON.stringify(f.expected)}`);
            print(`  actual:   ${JSON.stringify(f.actual)}`);
        }
        failed.push(`${file} :: ${test.name}`);
    }
}

print(`${passed}/${passed + failed.length} ok`);
system.exit(failed.length === 0 ? 0 : 1);
