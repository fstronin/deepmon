import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import {parseBalanceResponse} from './Balance.js';

function isCancelled(error) {
    return typeof error?.matches === 'function'
        && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}

export class SoupBalanceSource {
    constructor({baseUrl, timeoutSeconds = 30}) {
        this._baseUrl = baseUrl.replace(/\/+$/, '');
        this._session = new Soup.Session({timeout: timeoutSeconds});
    }

    request({key, cancellable = null}) {
        const url = `${this._baseUrl}/user/balance`;
        let message;
        try {
            message = Soup.Message.new('GET', url);
        } catch (error) {
            return Promise.resolve({ok: false, code: 'network', detail: error.message});
        }
        message.request_headers.append('Authorization', `Bearer ${key}`);
        message.request_headers.append('Accept', 'application/json');

        return new Promise(resolve => {
            this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable,
                (session, result) => {
                    let bytes;
                    try {
                        bytes = session.send_and_read_finish(result);
                    } catch (error) {
                        resolve(isCancelled(error)
                            ? {ok: false, code: 'cancelled', detail: error.message}
                            : {ok: false, code: 'network', detail: error.message});
                        return;
                    }

                    let status;
                    try {
                        status = message.status_code;
                    } catch (error) {
                        resolve({ok: false, code: 'parse', detail: error.message});
                        return;
                    }
                    if (status === 401 || status === 403) {
                        resolve({ok: false, code: 'auth', detail: `HTTP ${status}`});
                        return;
                    }
                    if (status === 429) {
                        resolve({ok: false, code: 'rate-limit', detail: 'HTTP 429'});
                        return;
                    }
                    if (status !== 200) {
                        resolve({ok: false, code: 'server', detail: `HTTP ${status}`});
                        return;
                    }

                    resolve(parseBalanceResponse(new TextDecoder().decode(bytes.get_data())));
                });
        });
    }
}
