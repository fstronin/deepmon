import {parseCostResponse} from '../src/deepmon@fstronin/usage/PlatformUsage.js';

const response = ({code = 0, biz = 0, blocks = [], days = null} = {}) => JSON.stringify({
    code,
    msg: '',
    data: {
        biz_code: biz,
        biz_msg: '',
        biz_data: days
            ? {total: [], days}
            : {data: blocks},
    },
});

const block = (currency, buckets) => ({
    currency,
    series: [{apiKey: {id: 1}, model: 'deepseek-chat', buckets}],
});

const at = (y, mo, d, h) => new Date(y, mo - 1, d, h).getTime() / 1000;

export const tests = [
    {name: 'бакеты складываются по локальным дням', fn: t => {
        const text = response({blocks: [
            block('USD', [
                {time: at(2026, 10, 30, 12), cost: {value: '0.44'}},
                {time: at(2026, 10, 31, 12), cost: {value: '1.25'}},
                {time: at(2026, 10, 31, 18), cost: {value: '0.05'}},
            ]),
        ]});
        const r = parseCostResponse(text, {currency: 'USD'});
        t.ok(r.ok, 'ok');
        t.eq(r.currency, 'USD');
        t.eq(r.days.length, 2);
        t.eq(r.days[0].cents, 44);
        t.eq(r.days[1].cents, 130);
    }},
    {name: 'валюта выбирается по кошельку, а не по первой блока', fn: t => {
        const text = response({blocks: [
            block('CNY', [{time: at(2026, 10, 31, 12), cost: {value: '7.00'}}]),
            block('USD', [{time: at(2026, 10, 31, 12), cost: {value: '1.25'}}]),
        ]});
        const r = parseCostResponse(text, {currency: 'USD'});
        t.eq(r.currency, 'USD');
        t.eq(r.days[0].cents, 125);
    }},
    {name: 'нулевые и отсутствующие стоимости не создают дни', fn: t => {
        const text = response({blocks: [block('USD', [
            {time: at(2026, 10, 31, 12), cost: {value: '0'}},
            {time: at(2026, 10, 31, 13)},
        ])]});
        const r = parseCostResponse(text, {currency: 'USD'});
        t.eq(r.days.length, 0);
    }},
    {name: 'ошибка энвелопы -> platform-api', fn: t => {
        t.eq(parseCostResponse(response({code: 40003}), {currency: 'USD'}).code, 'platform-api');
        t.eq(parseCostResponse(response({biz: 1}), {currency: 'USD'}).code, 'platform-api');
    }},
    {name: 'другой валюты нет -> platform-currency', fn: t => {
        const text = response({blocks: [block('CNY', [{time: at(2026, 10, 31, 12), cost: {value: '1'}}])]});
        t.eq(parseCostResponse(text, {currency: 'USD'}).code, 'platform-currency');
    }},
    {name: 'битый JSON и пустой ответ', fn: t => {
        t.eq(parseCostResponse('{oops', {currency: 'USD'}).code, 'platform-parse');
        t.eq(parseCostResponse(response({blocks: []}), {currency: 'USD'}).code, 'platform-parse');
    }},
];
