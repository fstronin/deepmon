import {parseAmount, format, formatAmount, symbol} from '../src/deepmon@fstronin/money/Money.js';

export const tests = [
    {name: 'parseAmount: два знака', fn: t => t.eq(parseAmount('110.00'), 11000)},
    {name: 'parseAmount: один знак', fn: t => t.eq(parseAmount('0.1'), 10)},
    {name: 'parseAmount: мусор', fn: t => { t.eq(parseAmount('abc'), null); t.eq(parseAmount(''), null); }},
    {name: 'format: символ и два знака', fn: t => t.eq(format(11840, 'CNY'), '¥118.40')},
    {name: 'format: код без символа', fn: t => t.eq(format(1230, 'SGD'), 'SGD 12.30')},
    {name: 'formatAmount: отрицательные центы', fn: t => t.eq(formatAmount(-62), '-0.62')},
    {name: 'symbol', fn: t => { t.eq(symbol('USD'), '$'); t.eq(symbol('EUR'), '€'); }},
];
