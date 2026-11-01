import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export const KEY_PATTERN = /^sk-[A-Za-z0-9_-]{16,}$/;
export const PLATFORM_TOKEN_PATTERN = /^[A-Za-z0-9._-]{16,}$/;

function normalize(text) {
    let value = text.trim();
    for (let pass = 0; pass < 2; pass++) {
        if (value.startsWith('Bearer '))
            value = value.slice('Bearer '.length).trim();
        if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))))
            value = value.slice(1, -1).trim();
    }
    return value;
}

export class FileKeyReader {
    constructor({path, pattern = KEY_PATTERN}) {
        this._path = path;
        this._pattern = pattern;
    }

    async readKey() {
        const file = Gio.File.new_for_path(this._path);
        let info;
        try {
            info = file.query_info('unix::mode', Gio.FileQueryInfoFlags.NONE, null);
        } catch (error) {
            return {ok: false, code: 'no-key', detail: `нет файла: ${this._path}`};
        }

        const mode = info.get_attribute_uint32('unix::mode');
        if ((mode & 0o077) !== 0)
            return {ok: false, code: 'insecure-permissions', detail: this._path};

        let contents;
        try {
            [, contents] = file.load_contents(null);
        } catch (error) {
            return {ok: false, code: 'no-key', detail: error.message};
        }

        const key = normalize(new TextDecoder().decode(contents));
        if (!this._pattern.test(key))
            return {ok: false, code: 'no-key', detail: `пустой или неверный ключ: ${this._path}`};
        return {ok: true, key, source: 'file'};
    }
}
