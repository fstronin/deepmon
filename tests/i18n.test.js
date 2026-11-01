import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {KEYS} from '../src/deepmon@fstronin/strings.js';

const testDir = GLib.path_get_dirname(Gio.File.new_for_uri(import.meta.url).get_path());
const root = GLib.path_get_dirname(testDir);

function unquote(quoted) {
    const inner = quoted.trim().slice(1, -1);
    return inner.replace(/\\(["\\nt])/g, (match, code) => ({
        '"': '"', '\\': '\\', 'n': '\n', 't': '\t',
    })[code]);
}

function parsePo(text) {
    const entries = new Set();
    let context = null;
    let msgid = null;
    let inMsgid = false;
    const flush = () => {
        if (msgid !== null && msgid !== '')
            entries.add(context ? `${context}\u0004${msgid}` : msgid);
        context = null;
        msgid = null;
        inMsgid = false;
    };
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (line === '') {
            flush();
            continue;
        }
        if (line.startsWith('#'))
            continue;
        if (line.startsWith('msgctxt ')) {
            context = unquote(line.slice('msgctxt '.length));
            continue;
        }
        if (line.startsWith('msgid_plural')) {
            inMsgid = false;
            continue;
        }
        if (line.startsWith('msgid ')) {
            msgid = unquote(line.slice('msgid '.length));
            inMsgid = true;
            continue;
        }
        if (line.startsWith('msgstr')) {
            inMsgid = false;
            continue;
        }
        if (line.startsWith('"') && inMsgid)
            msgid += unquote(line);
    }
    flush();
    return entries;
}

function leaves(node) {
    const out = [];
    for (const value of Object.values(node)) {
        if (typeof value === 'string')
            out.push(value);
        else
            out.push(...leaves(value));
    }
    return out;
}

function poKey(msgid) {
    return msgid.includes('|') ? msgid.replace('|', '\u0004') : msgid;
}

function readPo(lang) {
    const path = GLib.build_filenamev([root, 'po', `${lang}.po`]);
    const [, bytes] = Gio.File.new_for_path(path).load_contents(null);
    return parsePo(new TextDecoder().decode(bytes));
}

export const tests = [
    {name: 'все строки есть в ru.po и zh_CN.po', fn: t => {
        const ru = readPo('ru');
        const zh = readPo('zh_CN');
        const missing = [];
        for (const msgid of leaves(KEYS)) {
            const key = poKey(msgid);
            if (!ru.has(key))
                missing.push(`ru: ${msgid.slice(0, 40)}`);
            if (!zh.has(key))
                missing.push(`zh_CN: ${msgid.slice(0, 40)}`);
        }
        t.deepEq(missing, []);
    }},
    {name: 'ru, zh_CN и en отдают свои строки', fn: t => {
        const probe = GLib.build_filenamev([root, 'tests', 'locale-probe.js']);
        const read = lang => {
            const [ok, stdout, stderr] = GLib.spawn_command_line_sync(
                `/bin/sh -c "LANGUAGE=${lang} gjs -m '${probe}'"`);
            if (!ok)
                return [`error: ${new TextDecoder().decode(stderr)}`];
            return new TextDecoder().decode(stdout).trim().split('\n');
        };
        t.deepEq(read('ru'), ['Настройки', '3 дня']);
        t.deepEq(read('zh_CN'), ['设置', '3 天']);
        t.deepEq(read('en'), ['Settings', '3 days']);
    }},
];
