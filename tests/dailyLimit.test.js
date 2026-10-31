import {evaluate, alertText} from '../src/deepmon@fstronin/alerting/DailyLimit.js';

const sum = spend => ({today: {spend}, currency: 'CNY'});

export const tests = [
    {name: 'выключено -> никогда', fn: t => t.eq(evaluate({summary: sum(500), limitCents: 100, enabled: false, alerts: {}, date: '2026-11-01'}).fire, false)},
    {name: 'порог 0 -> никогда', fn: t => t.eq(evaluate({summary: sum(500), limitCents: 0, enabled: true, alerts: {}, date: '2026-11-01'}).fire, false)},
    {name: 'ниже порога -> нет', fn: t => t.eq(evaluate({summary: sum(50), limitCents: 100, enabled: true, alerts: {}, date: '2026-11-01'}).fire, false)},
    {name: 'выше порога -> да', fn: t => t.eq(evaluate({summary: sum(143), limitCents: 100, enabled: true, alerts: {}, date: '2026-11-01'}).fire, true)},
    {name: 'повтор в тот же день -> нет', fn: t => t.eq(evaluate({summary: sum(200), limitCents: 100, enabled: true, alerts: {'2026-11-01': {limit: 100, spend: 143}}, date: '2026-11-01'}).fire, false)},
    {name: 'порог снизили -> да', fn: t => t.eq(evaluate({summary: sum(200), limitCents: 150, enabled: true, alerts: {'2026-11-01': {limit: 100, spend: 143}}, date: '2026-11-01'}).fire, true)},
    {name: 'порог повысили -> нет', fn: t => t.eq(evaluate({summary: sum(200), limitCents: 300, enabled: true, alerts: {'2026-11-01': {limit: 100, spend: 143}}, date: '2026-11-01'}).fire, false)},
    {name: 'новый день -> да', fn: t => t.eq(evaluate({summary: sum(200), limitCents: 100, enabled: true, alerts: {'2026-10-31': {limit: 100, spend: 143}}, date: '2026-11-01'}).fire, true)},
    {name: 'alertText', fn: t => {
        const a = alertText({spend: 143, limit: 100, currency: 'CNY'});
        t.eq(a.title, 'DeepSeek: расходы');
        t.eq(a.body, 'Сегодня ¥1.43 — выше порога ¥1.00');
    }},
];
