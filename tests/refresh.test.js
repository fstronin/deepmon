import {RefreshSpending} from '../src/deepmon@fstronin/spending/RefreshSpending.js';
import * as H from '../src/deepmon@fstronin/spending/History.js';

const t0 = new Date(2026, 10, 1, 12, 0).getTime() / 1000;
const snap = (total, currency = 'CNY') => ({
    isAvailable: true,
    balances: [{currency, total, granted: 0, toppedUp: total}],
});

function fakeStore(state) {
    const saved = [];
    const archived = [];
    return {
        saved,
        archived,
        load: () => ({ok: true, state}),
        save: next => {
            saved.push(next);
            return {ok: true};
        },
        archive: currency => {
            archived.push(currency);
            return {ok: true, path: '/tmp/archive'};
        },
    };
}

const okKeyReader = () => ({readKey: async () => ({ok: true, key: 'sk-aaaaaaaaaaaaaaaaaa', source: 'file'})});
const okSource = snapshot => ({request: async () => ({ok: true, snapshot})});
const failSource = code => ({request: async () => ({ok: false, code})});

function make({source, store, keyReader, currency, config} = {}) {
    return new RefreshSpending({
        source,
        store,
        keyReader: keyReader ?? okKeyReader(),
        config: config ?? {currency: currency ?? '', chartDays: 14},
        now: () => t0,
    });
}

export const tests = [
    {name: 'успех: снапшот в историю, файл сохранён, сводка есть', fn: async t => {
        const store = fakeStore(H.empty());
        const r = await make({source: okSource(snap(11840)), store}).run();
        t.ok(r.error === null, 'без ошибки');
        t.eq(r.summary.today.hasData, true);
        t.eq(store.saved.length, 1);
        t.eq(store.saved[0].samples.length, 1);
    }},
    {name: 'сеть упала: история и сохранение не тронуты', fn: async t => {
        const store = fakeStore(H.empty());
        const r = await make({source: failSource('network'), store}).run();
        t.eq(r.error.code, 'network');
        t.eq(store.saved.length, 0);
        t.eq(r.state, null);
    }},
    {name: 'auth: повтор с тем же ключом пропускается', fn: async t => {
        let calls = 0;
        const source = {request: async () => {
            calls++;
            return {ok: false, code: 'auth'};
        }};
        const unit = make({source, store: fakeStore(H.empty())});
        await unit.run();
        const second = await unit.run();
        t.eq(calls, 1);
        t.eq(second.skipped, 'auth-unchanged');
    }},
    {name: 'ключ сменился: после auth запрос повторяется', fn: async t => {
        let calls = 0;
        let key = 'sk-aaaaaaaaaaaaaaaaaa';
        const source = {request: async () => {
            calls++;
            return {ok: false, code: 'auth'};
        }};
        const keyReader = {readKey: async () => ({ok: true, key, source: 'file'})};
        const unit = make({source, keyReader, store: fakeStore(H.empty())});
        await unit.run();
        key = 'sk-bbbbbbbbbbbbbbbbbb';
        await unit.run();
        t.eq(calls, 2);
    }},
    {name: 'нет ключа: запроса нет', fn: async t => {
        let calls = 0;
        const source = {request: async () => {
            calls++;
            return {ok: true, snapshot: snap(1)};
        }};
        const keyReader = {readKey: async () => ({ok: false, code: 'no-key'})};
        const r = await make({source, keyReader, store: fakeStore(H.empty())}).run();
        t.eq(calls, 0);
        t.eq(r.error.code, 'no-key');
    }},
    {name: 'валюта недоступна -> ошибка без изменения истории', fn: async t => {
        const store = fakeStore(H.empty());
        const r = await make({source: okSource(snap(100)), store, currency: 'USD'}).run();
        t.eq(r.error.code, 'currency-unavailable');
        t.eq(store.saved.length, 0);
    }},
    {name: 'смена валюты архивирует и начинает заново', fn: async t => {
        let {state} = H.appendSample(H.empty(),
            {t: t0 - 3600, currency: 'CNY', total: 1000, granted: 0, toppedUp: 1000}, {intervalMinutes: 15});
        const store = fakeStore(state);
        const r = await make({source: okSource(snap(200, 'USD')), store, currency: 'USD'}).run();
        t.deepEq(store.archived, ['CNY']);
        t.eq(r.state.primaryCurrency, 'USD');
        t.eq(r.state.samples.length, 1);
        t.ok(r.notice, 'notice есть');
    }},
];
