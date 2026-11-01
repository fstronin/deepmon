import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import {parseCostResponse} from './PlatformUsage.js';

function isCancelled(error) {
    return typeof error?.matches === 'function'
        && error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}

// Приватный эндпоинт платформы (нужен токен веб-сессии, не ключ API).
export class PlatformUsageSource {
    constructor({baseUrl, timeoutSeconds = 20}) {
        this._baseUrl = baseUrl.replace(/\/+$/, '');
        this._session = new Soup.Session({timeout: timeoutSeconds});
    }

    requestCosts({token, start, end, tz, currency = null, cancellable = null}) {
        const query = `start=${start}&end=${end}&tz=${tz}`;
        const url = `${this._baseUrl}/api/v0/usage/by_api_key/cost?${query}`;
        let message;
        try {
            message = Soup.Message.new('GET', url);
        } catch (error) {
            return Promise.resolve({ok: false, code: 'platform-network', detail: error.message});
        }
        message.request_headers.append('Authorization', `Bearer ${token}`);
        message.request_headers.append('Accept', 'application/json');
        message.request_headers.append('x-client-platform', 'web');

        return new Promise(resolve => {
            this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable,
                (session, result) => {
                    let bytes;
                    try {
                        bytes = session.send_and_read_finish(result);
                    } catch (error) {
                        resolve(isCancelled(error)
                            ? {ok: false, code: 'cancelled', detail: error.message}
                            : {ok: false, code: 'platform-network', detail: error.message});
                        return;
                    }

                    let status;
                    try {
                        status = message.status_code;
                    } catch (error) {
                        resolve({ok: false, code: 'platform-parse', detail: error.message});
                        return;
                    }
                    if (status === 401 || status === 403) {
                        resolve({ok: false, code: 'platform-auth', detail: `HTTP ${status}`});
                        return;
                    }
                    if (status !== 200) {
                        resolve({ok: false, code: 'platform-server', detail: `HTTP ${status}`});
                        return;
                    }

                    resolve(parseCostResponse(new TextDecoder().decode(bytes.get_data()), {currency}));
                });
        });
    }
}
