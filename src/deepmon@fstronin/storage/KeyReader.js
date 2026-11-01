import GLib from 'gi://GLib';

const DEFAULT_KEYRING_TIMEOUT_MS = 2000;

export class KeyReader {
    constructor({keyring, file, keyringTimeoutMs = DEFAULT_KEYRING_TIMEOUT_MS}) {
        this._keyring = keyring;
        this._file = file;
        this._keyringTimeoutMs = keyringTimeoutMs;
    }

    async readKey() {
        const fromKeyring = await this._readKeyring();
        if (fromKeyring.ok)
            return fromKeyring;

        const fromFile = await this._file.readKey();
        if (fromFile.ok)
            return fromFile;

        // Открытый файл ключа опаснее отсутствия ключа: этот код важнее прочих.
        const code = fromFile.code === 'insecure-permissions' ? 'insecure-permissions' : fromKeyring.code;
        return {ok: false, code, detail: fromFile.detail ?? fromKeyring.detail};
    }

    // Связка ключей может быть недоступна (сервис не отвечает, сессия без keyring):
    // без таймаута D-Bus-вызов не вызывает колбэк и чтение ключа висит навсегда.
    _readKeyring() {
        return new Promise(resolve => {
            let settled = false;
            const settle = result => {
                if (settled)
                    return;
                settled = true;
                resolve(result);
            };
            const timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._keyringTimeoutMs, () => {
                settle({ok: false, code: 'keyring-locked', detail: 'связка ключей не отвечает'});
                return GLib.SOURCE_REMOVE;
            });

            this._keyring.readKey().then(result => {
                if (settled)
                    return;
                GLib.source_remove(timerId);
                settle(result);
            }, error => {
                if (settled)
                    return;
                GLib.source_remove(timerId);
                settle({ok: false, code: 'keyring-locked', detail: error.message});
            });
        });
    }
}

export function fingerprint(key) {
    return GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, key, -1).slice(0, 8);
}
