import Secret from 'gi://Secret';

export const KEYRING_ATTRIBUTES = {application: 'deepmon', account: 'deepseek-api'};

let schema = null;

export function keyringSchema() {
    schema ??= Secret.Schema.new('org.freedesktop.Secret.Generic', Secret.SchemaFlags.NONE, {
        application: Secret.SchemaAttributeType.STRING,
        account: Secret.SchemaAttributeType.STRING,
    });
    return schema;
}

export class KeyringKeyReader {
    readKey() {
        return new Promise(resolve => {
            const fail = error => resolve({ok: false, code: 'keyring-locked', detail: error?.message ?? 'keyring'});
            try {
                Secret.password_lookup(keyringSchema(), KEYRING_ATTRIBUTES, null, (source, result) => {
                    let value;
                    try {
                        value = Secret.password_lookup_finish(result);
                    } catch (error) {
                        fail(error);
                        return;
                    }
                    const key = Array.isArray(value) ? value[0] : value;
                    resolve(key
                        ? {ok: true, key, source: 'keyring'}
                        : {ok: false, code: 'no-key', detail: 'элемент связки не найден'});
                });
            } catch (error) {
                fail(error);
            }
        });
    }
}
