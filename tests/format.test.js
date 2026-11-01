import {buildViewModel, panelLabel, barHeights} from '../src/deepmon@fstronin/panel/format.js';

const summary = over => ({
    currency: 'CNY',
    isAvailable: true,
    updatedAt: 1767225000,
    balances: [{currency: 'CNY', total: 11840, granted: 0, toppedUp: 11840}],
    today: {spend: over, approx: false, coveredFrom: null, hasData: true},
    week: {spend: 410, daysWithData: 5},
    month: {spend: 1785, daysWithData: 12},
    chart: Array.from({length: 14}, (_, i) => ({
        date: `2026-10-${19 + i}`,
        spend: i === 13 ? over : 0,
        approx: false,
        hasData: true,
    })),
});

export const tests = [
    {name: 'label: баланс и трата', fn: t => t.eq(panelLabel(buildViewModel({summary: summary(62), panelMode: 'both'})).text, '¥118.40 ↓0.62')},
    {name: 'label: трата 0 -> только баланс', fn: t => t.eq(panelLabel(buildViewModel({summary: summary(0), panelMode: 'both'})).text, '¥118.40')},
    {name: 'label: превышение -> глиф и класс', fn: t => {
        const label = panelLabel(buildViewModel({summary: summary(143), panelMode: 'both', limitCents: 100}));
        t.eq(label.text, '¥118.40 ↓1.43 ⚠');
        t.eq(label.styleClass, 'deepmon-over-limit');
    }},
    {name: 'label: режим spend', fn: t => t.eq(panelLabel(buildViewModel({summary: summary(62), panelMode: 'spend'})).text, '↓0.62')},
    {name: 'label: режим balance', fn: t => t.eq(panelLabel(buildViewModel({summary: summary(62), panelMode: 'balance'})).text, '¥118.40')},
    {name: 'label: ошибка без данных -> заглушка', fn: t => {
        const label = panelLabel(buildViewModel({summary: null, error: {code: 'no-key'}, panelMode: 'both'}));
        t.eq(label.text, 'DeepSeek ⚠');
        t.eq(label.styleClass, 'deepmon-stale');
    }},
    {name: 'label: ошибка с данными -> цифры и stale', fn: t => {
        const label = panelLabel(buildViewModel({summary: summary(62), error: {code: 'network'}, panelMode: 'both'}));
        t.eq(label.text, '¥118.40 ↓0.62');
        t.eq(label.styleClass, 'deepmon-stale');
    }},
    {name: 'statusText: баланс исчерпан', fn: t => {
        const view = buildViewModel({summary: {...summary(0), isAvailable: false}, panelMode: 'both'});
        t.ok(view.statusText.includes('исчерпан'), view.statusText);
    }},
    {name: 'barHeights: пропорция, минимум и пустой день', fn: t => {
        const points = [
            {spend: 100, hasData: true},
            {spend: 50, hasData: true},
            {spend: 1, hasData: true},
            {spend: 0, hasData: false},
        ];
        t.deepEq(barHeights(points), [44, 22, 3, 2]);
    }},
    {name: 'barHeights: все нули не делит на ноль', fn: t => t.deepEq(barHeights([{spend: 0, hasData: true}]), [2])},
    {name: 'extras с кодом валюты и подпись порога', fn: t => {
        const data = summary(62);
        data.balances.push({currency: 'USD', total: 725, granted: 0, toppedUp: 725});
        const view = buildViewModel({summary: data, panelMode: 'both', limitCents: 100});
        t.deepEq(view.extras, ['USD 7.25']);
        t.eq(view.limitLabel, 'Порог: ¥1.00/день');
    }},
    {name: 'granted и toppedUp показываются только ненулевыми', fn: t => {
        const data = summary(62);
        data.balances = [{currency: 'CNY', total: 11840, granted: 1000, toppedUp: 10840}];
        const view = buildViewModel({summary: data, panelMode: 'both', limitCents: 100});
        t.deepEq(view.funding, ['грант ¥10.00', 'пополнено ¥108.40']);
    }},
];
