import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {JsonSpendingStore} from '../src/deepmon@fstronin/spending/JsonSpendingStore.js';
import * as H from '../src/deepmon@fstronin/spending/History.js';

const testDir = GLib.path_get_dirname(Gio.File.new_for_uri(import.meta.url).get_path());
const root = GLib.path_get_dirname(testDir);
let counter = 0;

function freshPath(content = null) {
    counter += 1;
    const base = GLib.build_filenamev([root, 'tests', 'tmp', `case-${counter}-${GLib.get_monotonic_time()}`]);
    GLib.mkdir_with_parents(base, 0o700);
    const path = GLib.build_filenamev([base, 'history.json']);
    if (content !== null)
        GLib.file_set_contents(path, content);
    return path;
}

function listDir(path) {
    const enumerator = Gio.File.new_for_path(GLib.path_get_dirname(path))
        .enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    const names = [];
    for (let info = enumerator.next_file(null); info !== null; info = enumerator.next_file(null))
        names.push(info.get_name());
    return names;
}

export const tests = [
    {name: 'load: файла нет -> пустая история', fn: t => {
        const store = new JsonSpendingStore({path: freshPath()});
        const r = store.load();
        t.ok(r.ok, 'ok');
        t.deepEq(r.state, H.empty());
    }},
    {name: 'save/load: round-trip без *.tmp', fn: t => {
        const path = freshPath();
        const store = new JsonSpendingStore({path});
        const state = H.empty();
        state.primaryCurrency = 'CNY';
        t.ok(store.save(state).ok, 'save');
        t.deepEq(store.load().state, state);
        t.eq(listDir(path).filter(name => name.endsWith('.tmp')).length, 0);
    }},
    {name: 'save: каталог создаётся', fn: t => {
        const path = freshPath();
        new JsonSpendingStore({path}).save(H.empty());
        t.ok(Gio.File.new_for_path(path).query_exists(null), 'файл есть');
    }},
    {name: 'load: битый файл -> backup и пустая история', fn: t => {
        const path = freshPath('{oops');
        const r = new JsonSpendingStore({path}).load();
        t.ok(r.ok, 'ok');
        t.deepEq(r.state, H.empty());
        t.ok(r.warning, 'warning есть');
        t.eq(listDir(path).filter(name => name.includes('.corrupt-')).length, 1);
    }},
    {name: 'save: родитель — файл -> storage', fn: t => {
        const parent = freshPath('not a dir');
        const store = new JsonSpendingStore({path: `${parent}/history.json`});
        t.eq(store.save(H.empty()).code, 'storage');
    }},
    {name: 'archive: переименовывает файл', fn: t => {
        const path = freshPath();
        const store = new JsonSpendingStore({path});
        store.save(H.empty());
        const r = store.archive('CNY');
        t.ok(r.ok, 'ok');
        t.eq(listDir(path).filter(name => /^history\.json\.archive-CNY-\d+$/.test(name)).length, 1);
        t.ok(!Gio.File.new_for_path(path).query_exists(null), 'исходный файл исчез');
    }},
    {name: 'каталог 0700, файл 0600', fn: t => {
        const base = freshPath();
        const path = GLib.build_filenamev([GLib.path_get_dirname(base), 'state', 'deepmon', 'history.json']);
        new JsonSpendingStore({path}).save(H.empty());
        const dirMode = Gio.File.new_for_path(GLib.path_get_dirname(path))
            .query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null)
            .get_attribute_uint32('unix::mode') & 0o777;
        const fileMode = Gio.File.new_for_path(path)
            .query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null)
            .get_attribute_uint32('unix::mode') & 0o777;
        t.eq(dirMode, 0o700);
        t.eq(fileMode, 0o600);
    }},
];
