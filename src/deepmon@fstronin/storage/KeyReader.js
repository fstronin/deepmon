import GLib from 'gi://GLib';

export class KeyReader {
    constructor({keyring, file}) {
        this._keyring = keyring;
        this._file = file;
    }

    async readKey() {
        const fromKeyring = await this._keyring.readKey();
        if (fromKeyring.ok)
            return fromKeyring;

        const fromFile = await this._file.readKey();
        if (fromFile.ok)
            return fromFile;

        // Открытый файл ключа опаснее отсутствия ключа: этот код важнее прочих.
        const code = fromFile.code === 'insecure-permissions' ? 'insecure-permissions' : fromKeyring.code;
        return {ok: false, code, detail: fromFile.detail ?? fromKeyring.detail};
    }
}

export function fingerprint(key) {
    return GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, key, -1).slice(0, 8);
}
