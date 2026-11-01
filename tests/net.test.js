import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import {SoupBalanceSource} from '../src/deepmon@fstronin/balance/SoupBalanceSource.js';

const PORT = 18087;
const testDir = GLib.path_get_dirname(Gio.File.new_for_uri(import.meta.url).get_path());
let started = false;

function sleep(milliseconds) {
    return new Promise(resolve => {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, milliseconds, () => {
            resolve();
            return GLib.SOURCE_REMOVE;
        });
    });
}

async function get(url, {cancellable = null, session = null} = {}) {
    const own = session ?? new Soup.Session({timeout: 1});
    const message = Soup.Message.new('GET', url);
    return new Promise(resolve => {
        own.send_and_read_async(message, GLib.PRIORITY_DEFAULT, cancellable, (source, result) => {
            try {
                resolve({ok: true, status: message.get_status(), bytes: source.send_and_read_finish(result)});
            } catch (error) {
                resolve({ok: false, error});
            }
        });
    });
}

async function ensureServer() {
    if (started)
        return;
    started = true;
    Gio.Subprocess.new(['python3', GLib.build_filenamev([testDir, 'mock_server.py']), String(PORT), '30'],
        Gio.SubprocessFlags.STDOUT_SILENCE | Gio.SubprocessFlags.STDERR_SILENCE);
    for (let attempt = 0; attempt < 60; attempt++) {
        const response = await get(`http://127.0.0.1:${PORT}/ok/user/balance`);
        if (response.ok && response.status === 200)
            return;
        await sleep(100);
    }
    throw new Error('mock server did not start');
}

const src = scenario => new SoupBalanceSource({
    baseUrl: `http://127.0.0.1:${PORT}/${scenario}`,
    timeoutSeconds: 1,
});

export const tests = [
    {name: 'net: 200 -> снапшот', fn: async t => {
        await ensureServer();
        const r = await src('ok').request({key: 'sk-test'});
        t.ok(r.ok, 'ok');
        t.eq(r.snapshot.balances[0].total, 11840);
    }},
    {name: 'net: 401 -> auth', fn: async t => {
        await ensureServer();
        t.eq((await src('unauthorized').request({key: 'sk-test'})).code, 'auth');
    }},
    {name: 'net: 429 -> rate-limit', fn: async t => {
        await ensureServer();
        t.eq((await src('ratelimit').request({key: 'sk-test'})).code, 'rate-limit');
    }},
    {name: 'net: 500 -> server', fn: async t => {
        await ensureServer();
        t.eq((await src('server-error').request({key: 'sk-test'})).code, 'server');
    }},
    {name: 'net: битый JSON -> parse', fn: async t => {
        await ensureServer();
        t.eq((await src('broken').request({key: 'sk-test'})).code, 'parse');
    }},
    {name: 'net: таймаут -> network', fn: async t => {
        await ensureServer();
        t.eq((await src('slow').request({key: 'sk-test'})).code, 'network');
    }},
    {name: 'net: отмена -> cancelled', fn: async t => {
        await ensureServer();
        const cancellable = new Gio.Cancellable();
        const pending = src('slow').request({key: 'sk-test', cancellable});
        cancellable.cancel();
        t.eq((await pending).code, 'cancelled');
    }},
];
