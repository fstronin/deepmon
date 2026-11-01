import {dispatchAlert} from '../src/deepmon@fstronin/alerting/AlertFlow.js';

const summary = {today: {spend: 143}, currency: 'CNY'};
const state = () => ({alerts: {}});
const base = () => ({
    summary,
    limitCents: 100,
    enabled: true,
    date: '2026-11-01',
    state: state(),
    save: () => ({ok: true}),
    notify: () => {},
});

export const tests = [
    {name: 'сработало: сохранили и уведомили', fn: t => {
        const calls = [];
        const input = base();
        input.notify = payload => calls.push(payload);
        const result = dispatchAlert(input);
        t.eq(result.notified, true);
        t.eq(input.state.alerts['2026-11-01'].limit, 100);
        t.eq(calls.length, 1);
        t.eq(calls[0].title, 'DeepSeek: spending');
    }},
    {name: 'не сохранилось: уведомления нет', fn: t => {
        let notified = 0;
        const input = base();
        input.save = () => ({ok: false, code: 'storage'});
        input.notify = () => notified++;
        const result = dispatchAlert(input);
        t.eq(result.notified, false);
        t.eq(notified, 0);
        t.eq(result.error.code, 'storage');
    }},
    {name: 'ниже порога: ничего не делаем', fn: t => {
        let notified = 0;
        let saves = 0;
        const input = base();
        input.summary = {today: {spend: 10}, currency: 'CNY'};
        input.save = () => {
            saves++;
            return {ok: true};
        };
        input.notify = () => notified++;
        const result = dispatchAlert(input);
        t.eq(result.notified, false);
        t.eq(notified, 0);
        t.eq(saves, 0);
    }},
];
