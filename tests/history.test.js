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
    {name: 'summarize: пустая история', fn: t => {
        const s = H.summarize(H.empty(), at(2026, 11, 1, 12, 0), {chartDays: 14});
        t.eq(s.today.hasData, false);
        t.eq(s.today.spend, 0);
        t.eq(s.chart.length, 14);
        t.eq(s.chart[13].date, '2026-11-01');
        t.eq(s.chart.every(p => p.hasData === false), true);
        t.eq(s.currency, null);
        t.eq(s.updatedAt, null);
    }},
    {name: 'summarize: сегодня, 7 и 30 дней', fn: t => {
        let {state} = H.appendSample(H.empty(), sample(at(2026, 11, 1, 0, 1), 1000), {intervalMinutes: 15});
        ({state} = H.appendSample(state, sample(at(2026, 11, 1, 0, 16), 940), {intervalMinutes: 15}));
        const s = H.summarize(state, at(2026, 11, 1, 12, 0), {chartDays: 14, isAvailable: true});
        t.eq(s.today.spend, 60);
        t.eq(s.week.spend, 60);
        t.eq(s.month.spend, 60);
        t.eq(s.isAvailable, true);
        t.eq(s.week.daysWithData, 1);
        t.eq(s.today.hasData, true);
        t.eq(s.chart[13].spend, 60);
        t.eq(s.chart[13].approx, false);
        t.eq(s.balances.length, 1);
        t.eq(s.balances[0].total, 940);
    }},
    {name: 'summarize: approx доходит до графика и today', fn: t => {
        let {state} = H.appendSample(H.empty(), sample(at(2026, 11, 1, 9, 0), 1000), {intervalMinutes: 15});
        ({state} = H.appendSample(state, sample(at(2026, 11, 1, 9, 30), 970), {intervalMinutes: 15}));
        const s = H.summarize(state, at(2026, 11, 1, 12, 0), {chartDays: 14});
        t.eq(s.today.approx, true);
        t.eq(s.chart[13].approx, true);
    }},
    {name: 'adoptCurrency: пустая история принимает валюту', fn: t => {
        const r = H.adoptCurrency(H.empty(), 'USD');
        t.eq(r.state.primaryCurrency, 'USD');
        t.eq(r.archivedCurrency, null);
        t.eq(r.notice, null);
    }},
    {name: 'adoptCurrency: совпадение ничего не меняет', fn: t => {
        const {state} = H.appendSample(H.empty(), sample(at(2026, 11, 1, 0, 1), 1000), {intervalMinutes: 15});
        const r = H.adoptCurrency(state, 'CNY');
        t.deepEq(r.state, state);
        t.eq(r.archivedCurrency, null);
    }},
    {name: 'adoptCurrency: смена архивирует прежнюю', fn: t => {
        const {state} = H.appendSample(H.empty(), sample(at(2026, 11, 1, 0, 1), 1000), {intervalMinutes: 15});
        const r = H.adoptCurrency(state, 'USD');
        t.eq(r.archivedCurrency, 'CNY');
        t.eq(r.state.primaryCurrency, 'USD');
        t.eq(r.state.samples.length, 0);
        t.eq(r.state.days['2026-11-01'], undefined);
        t.ok(r.notice.includes('CNY'), 'notice содержит прежнюю валюту');
    }},
    {name: 'сериализация туда-обратно', fn: t => {
        const {state} = H.appendSample(H.empty(), sample(at(2026, 11, 1, 0, 1), 1000), {intervalMinutes: 15});
        const back = H.deserialize(H.serialize(state));
        t.ok(back.ok, 'ok');
        t.deepEq(back.state, state);
    }},
    {name: 'deserialize: битый JSON и чужая версия', fn: t => {
        t.eq(H.deserialize('{oops').code, 'corrupt');
        t.eq(H.deserialize('{"version":99,"samples":[]}').code, 'corrupt');
    }},
    {name: 'importCosts: заполняет дни без локальных данных', fn: t => {
        const now = at(2026, 11, 1, 10, 0);
        const state = H.importCosts(H.empty(), {
            currency: 'CNY',
            days: [{date: '2026-10-30', cents: 44}, {date: '2026-10-31', cents: 125}],
            now,
        });
        t.eq(state.imported['2026-10-30'], 44);
        t.eq(state.imported['2026-10-31'], 125);
        t.eq(state.importedCurrency, 'CNY');
        t.eq(state.importedAt, now);
    }},
    {name: 'importCosts: данные платформы главнее локальной дельты', fn: t => {
        let {state} = H.appendSample(H.empty(), sample(at(2026, 11, 1, 0, 1), 1000), {intervalMinutes: 15});
        ({state} = H.appendSample(state, sample(at(2026, 11, 1, 0, 16), 950), {intervalMinutes: 15}));
        state = H.importCosts(state, {
            currency: 'CNY',
            days: [{date: '2026-11-01', cents: 999}, {date: '2026-10-31', cents: 70}],
            now: at(2026, 11, 1, 10, 0),
        });
        const summary = H.summarize(state, at(2026, 11, 1, 12, 0), {chartDays: 14});
        t.eq(summary.today.spend, 999);
        t.eq(summary.today.approx, false);
        t.eq(summary.chart[12].spend, 70);
        t.eq(summary.chart[12].hasData, true);
        t.eq(summary.month.spend, 1069);
    }},
    {name: 'importCosts выживает rebuild и убирается prune', fn: t => {
        const state = H.importCosts(H.empty(), {
            currency: 'CNY',
            days: [{date: '2026-09-15', cents: 300}],
            now: at(2026, 11, 1, 10, 0),
        });
        const rebuilt = H.rebuild(state, {now: at(2026, 11, 1, 10, 0), intervalMinutes: 15});
        t.eq(rebuilt.imported['2026-09-15'], 300);
        const pruned = H.prune(rebuilt, {now: at(2026, 11, 1, 10, 0), sampleRetentionDays: 7, dayRetentionDays: 30});
        t.eq(pruned.imported['2026-09-15'], undefined);
    }},
];

function sample(t, total) {
    return {t, currency: 'CNY', total, granted: 0, toppedUp: total};
}
