import * as H from '../src/deepmon@fstronin/spending/History.js';

const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).getTime() / 1000;

export const tests = [
    {name: 'empty: пустое состояние', fn: t => {
        const s = H.empty();
        t.deepEq(s.samples, []);
        t.eq(s.primaryCurrency, null);
        t.eq(s.lastSuccessAt, null);
    }},
    {name: 'первый снапшот задаёт валюту и день', fn: t => {
        const {state} = H.appendSample(H.empty(), {t: at(2026, 11, 1, 10, 0), currency: 'CNY', total: 11840, granted: 1000, toppedUp: 10840}, {intervalMinutes: 15});
        t.eq(state.primaryCurrency, 'CNY');
        t.eq(state.days['2026-11-01'].close, 11840);
        t.eq(state.days['2026-11-01'].spend, 0);
        t.eq(state.days['2026-11-01'].samples, 1);
    }},
    {name: 'уменьшение -> spend', fn: t => {
        let {state} = H.appendSample(H.empty(), sample(at(2026, 11, 1, 10, 0), 11840), {intervalMinutes: 15});
        ({state} = H.appendSample(state, sample(at(2026, 11, 1, 10, 15), 11778), {intervalMinutes: 15}));
        t.eq(state.days['2026-11-01'].spend, 62);
        t.eq(state.days['2026-11-01'].topup, 0);
    }},
    {name: 'увеличение -> topup, spend не отрицателен', fn: t => {
        let {state} = H.appendSample(H.empty(), sample(at(2026, 11, 1, 10, 0), 100), {intervalMinutes: 15});
        ({state} = H.appendSample(state, sample(at(2026, 11, 1, 10, 15), 50100), {intervalMinutes: 15}));
        t.eq(state.days['2026-11-01'].topup, 50000);
        t.eq(state.days['2026-11-01'].spend, 0);
    }},
    {name: 'пара через полночь падает в день cur', fn: t => {
        let {state} = H.appendSample(H.empty(), sample(at(2026, 10, 31, 23, 50), 1000), {intervalMinutes: 15});
        ({state} = H.appendSample(state, sample(at(2026, 11, 1, 0, 5), 940), {intervalMinutes: 15}));
        t.eq(state.days['2026-11-01'].spend, 60);
        t.eq(state.days['2026-10-31'].spend, 0);
    }},
    {name: 'разрыв больше 2 интервалов -> approx', fn: t => {
        let {state} = H.appendSample(H.empty(), sample(at(2026, 11, 1, 10, 0), 1000), {intervalMinutes: 15});
        ({state} = H.appendSample(state, sample(at(2026, 11, 1, 12, 0), 900), {intervalMinutes: 15}));
        t.eq(state.days['2026-11-01'].approx, true);
    }},
    {name: 'первый снапшот дня позже порога -> approx', fn: t => {
        const {state} = H.appendSample(H.empty(), sample(at(2026, 11, 1, 9, 0), 1000), {intervalMinutes: 15});
        t.eq(state.days['2026-11-01'].approx, true);
        t.eq(state.days['2026-11-01'].coveredFrom, at(2026, 11, 1, 9, 0));
    }},
    {name: 'coveredFrom на втором снапшоте не меняется', fn: t => {
        let {state} = H.appendSample(H.empty(), sample(at(2026, 11, 1, 0, 1), 1000), {intervalMinutes: 15});
        ({state} = H.appendSample(state, sample(at(2026, 11, 1, 0, 16), 990), {intervalMinutes: 15}));
        t.eq(state.days['2026-11-01'].coveredFrom, at(2026, 11, 1, 0, 1));
    }},
];

function sample(t, total) {
    return {t, currency: 'CNY', total, granted: 0, toppedUp: total};
}
