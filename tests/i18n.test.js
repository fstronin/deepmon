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

// Разбор GNU .mo: без него тест зависел бы от установленных в системе локалей,
// а gettext в C-локали игнорирует LANGUAGE.
function parseMo(path) {
    const [ok, bytes] = Gio.File.new_for_path(path).load_contents(null);
    if (!ok)
        throw new Error(`cannot read ${path}`);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (view.getUint32(0, true) !== 0x950412de)
        throw new Error(`bad .mo magic in ${path}`);
    const count = view.getUint32(8, true);
    const originals = view.getUint32(12, true);
    const translations = view.getUint32(16, true);
    const read = (table, index) => {
        const length = view.getUint32(table + index * 8, true);
        const offset = view.getUint32(table + index * 8 + 4, true);
        return new TextDecoder().decode(bytes.slice(offset, offset + length));
    };
    const map = new Map();
    for (let index = 0; index < count; index++)
        map.set(read(originals, index), read(translations, index));
    return map;
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

function readMo(lang) {
    return parseMo(GLib.build_filenamev([root, 'src', 'deepmon@fstronin', 'locale', lang,
        'LC_MESSAGES', 'deepmon.mo']));
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
    {name: 'скомпилированные каталоги содержат переводы', fn: t => {
        const ru = readMo('ru');
        const zh = readMo('zh_CN');
        t.eq(ru.get('Settings'), 'Настройки');
        t.eq(zh.get('Settings'), '设置');
        t.eq(ru.get('cli\u0004API key'), 'ключ API');
    }},
    {name: 'формы множественного числа в каталогах', fn: t => {
        const ru = readMo('ru').get('day\u0000days').split('\u0000');
        const zh = readMo('zh_CN').get('day\u0000days').split('\u0000');
        t.deepEq(ru, ['день', 'дня', 'дней']);
        t.deepEq(zh, ['天']);
    }},
];
