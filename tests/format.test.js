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
        t.ok(view.statusText.includes('exhausted'), view.statusText);
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
    {name: 'в нормальном состоянии служебных строк нет', fn: t => {
        const view = buildViewModel({summary: summary(62), panelMode: 'both', limitCents: 100});
        t.eq(view.statusText, '');
        t.eq(view.captions, undefined);
        t.deepEq(view.limitRatio, {text: '¥0.62 / 1.00', over: false});
    }},
    {name: 'превышение порога помечается', fn: t => {
        const view = buildViewModel({summary: summary(143), panelMode: 'both', limitCents: 100});
        t.deepEq(view.limitRatio, {text: '¥1.43 / 1.00', over: true});
    }},
    {name: 'без порога отношения нет', fn: t => {
        const view = buildViewModel({summary: summary(143), panelMode: 'both', limitCents: 0});
        t.eq(view.limitRatio, null);
    }},
    {name: 'ошибка остаётся в статусной строке', fn: t => {
        const view = buildViewModel({summary: summary(62), error: {code: 'network'},
            panelMode: 'both', limitCents: 100});
        t.eq(view.statusText.includes('no connection'), true);
    }},
    {name: 'периоды без хвоста дней', fn: t => {
        const view = buildViewModel({summary: summary(62), panelMode: 'both'});
        t.eq(view.periods.week, '4.10');
        t.eq(view.periods.month, '17.85');
    }},
    {name: 'periodDays: склонение по числу дней', fn: t => {
        const days = n => buildViewModel({
            summary: {...summary(62), month: {spend: 100, daysWithData: n}},
            panelMode: 'both',
        }).periodDays;
        t.eq(days(1), 'data: 1 day of 30');
        t.eq(days(3), 'data: 3 days of 30');
        t.eq(days(12), 'data: 12 days of 30');
        t.eq(days(22), 'data: 22 days of 30');
        t.eq(days(30), null);
    }},
];
