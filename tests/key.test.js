import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {FileKeyReader} from '../src/deepmon@fstronin/storage/FileKeyReader.js';
import {KeyReader, fingerprint} from '../src/deepmon@fstronin/storage/KeyReader.js';

const KEY = 'sk-abcdefghijklmnop1234';
const testDir = GLib.path_get_dirname(Gio.File.new_for_uri(import.meta.url).get_path());
const root = GLib.path_get_dirname(testDir);
let counter = 0;

function writeKeyFile(content, mode) {
    counter += 1;
    const dir = GLib.build_filenamev([root, 'tests', 'tmp', `key-${counter}-${GLib.get_monotonic_time()}`]);
    GLib.mkdir_with_parents(dir, 0o700);
    const path = GLib.build_filenamev([dir, 'key']);
    GLib.file_set_contents(path, content);
    Gio.File.new_for_path(path).set_attribute_uint32('unix::mode', mode, Gio.FileQueryInfoFlags.NONE, null);
    return path;
}

export const tests = [
    {name: 'файл 0600 читается', fn: async t => {
        const path = writeKeyFile(KEY, 0o600);
        const r = await new FileKeyReader({path}).readKey();
        t.ok(r.ok, 'ok');
        t.eq(r.key, KEY);
        t.eq(r.source, 'file');
    }},
    {name: 'файл 0644 -> insecure-permissions', fn: async t => {
        const path = writeKeyFile(KEY, 0o644);
        const r = await new FileKeyReader({path}).readKey();
        t.eq(r.code, 'insecure-permissions');
    }},
    {name: 'нет файла и пустой файл -> no-key', fn: async t => {
        t.eq((await new FileKeyReader({path: '/nonexistent/deepmon/key'}).readKey()).code, 'no-key');
        t.eq((await new FileKeyReader({path: writeKeyFile('   \n', 0o600)}).readKey()).code, 'no-key');
    }},
    {name: 'нормализация: пробелы, кавычки, Bearer', fn: async t => {
        const path = writeKeyFile(`  "Bearer ${KEY}"\n\n`, 0o600);
        t.eq((await new FileKeyReader({path}).readKey()).key, KEY);
    }},
    {name: 'композиция: keyring важнее файла', fn: async t => {
        const keyring = {readKey: async () => ({ok: true, key: 'sk-keyring0000000000', source: 'keyring'})};
        const file = new FileKeyReader({path: writeKeyFile(KEY, 0o600)});
        const r = await new KeyReader({keyring, file}).readKey();
        t.eq(r.source, 'keyring');
    }},
    {name: 'композиция: keyring пуст -> файл', fn: async t => {
        const keyring = {readKey: async () => ({ok: false, code: 'no-key'})};
        const file = new FileKeyReader({path: writeKeyFile(KEY, 0o600)});
        t.eq((await new KeyReader({keyring, file}).readKey()).source, 'file');
    }},
    {name: 'fingerprint: 8 hex и стабильность', fn: t => {
        const a = fingerprint(KEY);
        t.eq(/^[0-9a-f]{8}$/.test(a), true);
        t.eq(fingerprint(KEY), a);
        t.ok(a !== fingerprint(`${KEY}x`), 'разные ключи');
    }},
    {name: 'зависшая связка не блокирует файл', fn: async t => {
        const keyring = {readKey: () => new Promise(() => {})};
        const file = new FileKeyReader({path: writeKeyFile(KEY, 0o600)});
        const r = await new KeyReader({keyring, file, keyringTimeoutMs: 50}).readKey();
        t.eq(r.source, 'file');
        t.eq(r.key, KEY);
    }},
    {name: 'зависшая связка без файла -> keyring-locked', fn: async t => {
        const keyring = {readKey: () => new Promise(() => {})};
        const file = {readKey: async () => ({ok: false, code: 'no-key'})};
        const r = await new KeyReader({keyring, file, keyringTimeoutMs: 50}).readKey();
        t.eq(r.code, 'keyring-locked');
    }},
];
