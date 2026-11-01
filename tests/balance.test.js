import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {parseBalanceResponse, selectBalance} from '../src/deepmon@fstronin/balance/Balance.js';

function readFixture(name) {
    const dir = GLib.path_get_dirname(Gio.File.new_for_uri(import.meta.url).get_path());
    const [, bytes] = Gio.File.new_for_path(GLib.build_filenamev([dir, 'fixtures', name]))
        .load_contents(null);
    return new TextDecoder().decode(bytes);
}

export const tests = [
    {name: 'parse: CNY из фикстуры', fn: t => {
        const r = parseBalanceResponse(readFixture('balance-cny.json'));
        t.ok(r.ok, 'ok');
        t.eq(r.snapshot.balances[0].total, 11840);
        t.eq(r.snapshot.balances[0].granted, 1000);
        t.eq(r.snapshot.isAvailable, true);
    }},
    {name: 'parse: is_available=false — валидный снапшот', fn: t => {
        const r = parseBalanceResponse('{"is_available":false,"balance_infos":[{"currency":"CNY","total_balance":"0.00","granted_balance":"0.00","topped_up_balance":"0.00"}]}');
        t.ok(r.ok, 'ok');
        t.eq(r.snapshot.isAvailable, false);
    }},
    {name: 'parse: пустой balance_infos', fn: t => {
        const r = parseBalanceResponse('{"is_available":true,"balance_infos":[]}');
        t.ok(!r.ok, 'не ok');
        t.eq(r.code, 'parse');
    }},
    {name: 'parse: нечисловой total_balance', fn: t => {
        const r = parseBalanceResponse('{"is_available":true,"balance_infos":[{"currency":"CNY","total_balance":"n/a"}]}');
        t.eq(r.code, 'parse');
    }},
    {name: 'selectBalance: авто берёт первую', fn: t => {
        const r = selectBalance([{currency: 'CNY', total: 1}, {currency: 'USD', total: 2}], '');
        t.eq(r.selected.currency, 'CNY');
    }},
    {name: 'selectBalance: заданная закреплена', fn: t => {
        const r = selectBalance([{currency: 'CNY', total: 1}, {currency: 'USD', total: 2}], 'USD');
        t.eq(r.selected.total, 2);
    }},
    {name: 'selectBalance: отсутствующая', fn: t => {
        const r = selectBalance([{currency: 'CNY', total: 1}], 'USD');
        t.ok(!r.ok, 'не ok');
        t.eq(r.code, 'currency-unavailable');
        t.deepEq(r.available, ['CNY']);
    }},
];
