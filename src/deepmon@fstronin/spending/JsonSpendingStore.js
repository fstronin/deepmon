import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as History from './History.js';

function errorKind(error) {
    if (typeof error?.matches === 'function') {
        if (error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
            return 'not-found';
        if (error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.EXISTS))
            return 'exists';
    }
    return 'other';
}

export class JsonSpendingStore {
    constructor({path}) {
        this._path = path;
    }

    load() {
        try {
            this._ensureDir();
            const [, bytes] = this._file().load_contents(null);
            const parsed = History.deserialize(new TextDecoder().decode(bytes));
            if (parsed.ok)
                return {ok: true, state: parsed.state};

            const backup = this._backup();
            return {
                ok: true,
                state: History.empty(),
                warning: backup ? `${parsed.detail}; бэкап: ${backup}` : parsed.detail,
            };
        } catch (error) {
            if (errorKind(error) === 'not-found')
                return {ok: true, state: History.empty()};
            return {ok: false, code: 'storage', detail: error.message};
        }
    }

    save(state) {
        try {
            this._ensureDir();
            this._file().replace_contents(History.serialize(state), null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION, null);
            return {ok: true};
        } catch (error) {
            return {ok: false, code: 'storage', detail: error.message};
        }
    }

    archive(currency) {
        const suffix = `.archive-${currency}-${Math.floor(Date.now() / 1000)}`;
        const target = Gio.File.new_for_path(this._path + suffix);
        try {
            this._file().move(target, Gio.FileCopyFlags.NONE, null, null);
            return {ok: true, path: target.get_path()};
        } catch (error) {
            return {ok: false, code: 'storage', detail: error.message};
        }
    }

    _file() {
        return Gio.File.new_for_path(this._path);
    }

    _ensureDir() {
        const dir = Gio.File.new_for_path(GLib.path_get_dirname(this._path));
        try {
            dir.make_directory_with_parents(null);
        } catch (error) {
            if (errorKind(error) !== 'exists')
                throw error;
        }
    }

    // Повреждённый файл не удаляем: переносим в сторону, чтобы данные остались
    // доступны для разбора. Неудача переноса не мешает работать с пустой историей,
    // поэтому сообщаем о ней через warning вызывающего, а не исключением.
    _backup() {
        const target = Gio.File.new_for_path(`${this._path}.corrupt-${Math.floor(Date.now() / 1000)}`);
        try {
            this._file().move(target, Gio.FileCopyFlags.NONE, null, null);
            return target.get_path();
        } catch (error) {
            return null;
        }
    }
}
