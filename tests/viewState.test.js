import {mergeRefresh} from '../src/deepmon@fstronin/panel/viewState.js';

const summary = {today: {spend: 62}, currency: 'CNY'};
const other = {today: {spend: 0}, currency: 'CNY'};

export const tests = [
    {name: 'ошибка после успеха сохраняет сводку и notice', fn: t => {
        const merged = mergeRefresh(
            {summary, notice: 'валюта изменена', error: null},
            {summary: null, notice: null, error: {code: 'network'}, warning: null});
        t.eq(merged.summary, summary);
        t.eq(merged.notice, 'валюта изменена');
        t.eq(merged.error.code, 'network');
    }},
    {name: 'успех заменяет сводку и снимает ошибку', fn: t => {
        const merged = mergeRefresh(
            {summary, notice: 'старое', error: {code: 'network'}},
            {summary: other, notice: null, error: null, warning: null});
        t.eq(merged.summary, other);
        t.eq(merged.notice, null);
        t.eq(merged.error, null);
    }},
    {name: 'первая ошибка без данных не выдумывает сводку', fn: t => {
        const merged = mergeRefresh(
            {summary: null, notice: null, error: null},
            {summary: null, notice: null, error: {code: 'no-key'}, warning: null});
        t.eq(merged.summary, null);
        t.eq(merged.error.code, 'no-key');
    }},
    {name: 'предупреждение хранилища показывается как notice', fn: t => {
        const merged = mergeRefresh(
            {summary: null, notice: null, error: null},
            {summary, notice: null, error: null, warning: 'повреждённый файл сохранён'});
        t.eq(merged.notice, 'повреждённый файл сохранён');
        t.eq(merged.summary, summary);
    }},
];
