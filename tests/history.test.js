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
    {name: 'rebuild пересобирает день из снапшотов', fn: t => {
        let {state} = H.appendSample(H.empty(), sample(at(2026, 11, 1, 0, 1), 1000), {intervalMinutes: 15});
        ({state} = H.appendSample(state, sample(at(2026, 11, 1, 0, 16), 950), {intervalMinutes: 15}));
        const broken = JSON.parse(JSON.stringify(state));
        broken.days['2026-11-01'].spend = 999;
        const fixed = H.rebuild(broken, {now: at(2026, 11, 1, 0, 20), intervalMinutes: 15});
        t.eq(fixed.days['2026-11-01'].spend, 50);
        t.eq(fixed.days['2026-11-01'].approx, false);
    }},
    {name: 'rebuild идемпотентен', fn: t => {
        let {state} = H.appendSample(H.empty(), sample(at(2026, 11, 1, 0, 1), 1000), {intervalMinutes: 15});
        ({state} = H.appendSample(state, sample(at(2026, 11, 1, 0, 16), 950), {intervalMinutes: 15}));
        const a = H.rebuild(state, {now: at(2026, 11, 1, 0, 20), intervalMinutes: 15});
        const b = H.rebuild(a, {now: at(2026, 11, 1, 0, 20), intervalMinutes: 15});
        t.deepEq(b, a);
    }},
    {name: 'prune: снапшоты 7 дней, дни 400', fn: t => {
        let {state} = H.appendSample(H.empty(), sample(at(2026, 9, 1, 10, 0), 1000), {intervalMinutes: 15});
        ({state} = H.appendSample(state, sample(at(2026, 11, 1, 10, 0), 900), {intervalMinutes: 15}));
        const pruned = H.prune(state, {now: at(2026, 11, 1, 10, 1), sampleRetentionDays: 7, dayRetentionDays: 400});
        t.eq(pruned.samples.length, 1);
        t.ok(pruned.days['2026-09-01'] !== undefined, 'старый день сохранён');
    }},
    {name: 'prune удаляет дни старше 400', fn: t => {
        let {state} = H.appendSample(H.empty(), sample(at(2025, 1, 1, 10, 0), 1000), {intervalMinutes: 15});
        ({state} = H.appendSample(state, sample(at(2026, 11, 1, 10, 0), 900), {intervalMinutes: 15}));
        const pruned = H.prune(state, {now: at(2026, 11, 1, 10, 1), sampleRetentionDays: 7, dayRetentionDays: 400});
        t.eq(pruned.days['2025-01-01'], undefined);
    }},
];

function sample(t, total) {
    return {t, currency: 'CNY', total, granted: 0, toppedUp: total};
}
