// Разбор ответа GET /user/balance и выбор валюты учёта. Чистые функции.
import {parseAmount} from '../money/Money.js';

export function parseBalanceResponse(text) {
    let payload;
    try {
        payload = JSON.parse(text);
    } catch (e) {
        return {ok: false, code: 'parse', detail: `не JSON: ${e.message}`};
    }

    const infos = payload?.balance_infos;
    if (!Array.isArray(infos) || infos.length === 0)
        return {ok: false, code: 'parse', detail: 'нет balance_infos'};

    const balances = [];
    for (const info of infos) {
        if (typeof info?.currency !== 'string' || info.currency === '')
            return {ok: false, code: 'parse', detail: 'нет currency'};
        const total = parseAmount(info.total_balance);
        if (total === null)
            return {ok: false, code: 'parse', detail: `total_balance: ${info.total_balance}`};
        balances.push({
            currency: info.currency,
            total,
            granted: parseAmount(info.granted_balance) ?? 0,
            toppedUp: parseAmount(info.topped_up_balance) ?? 0,
        });
    }

    return {ok: true, snapshot: {isAvailable: Boolean(payload.is_available), balances}};
}

export function selectBalance(balances, preferred, current = null) {
    const pick = currency => balances.find(balance => balance.currency === currency) ?? null;

    if (preferred) {
        const selected = pick(preferred);
        if (selected)
            return {ok: true, selected};
        return {ok: false, code: 'currency-unavailable', available: balances.map(balance => balance.currency)};
    }

    // Авто: держимся за валюту, которую уже ведём, иначе берём первую с деньгами,
    // иначе первую в ответе. Иначе пополнение другой валюты уводило бы историю в архив.
    if (current) {
        const selected = pick(current);
        if (selected)
            return {ok: true, selected};
    }

    const funded = balances.find(balance => balance.total > 0);
    return {ok: true, selected: funded ?? balances[0]};
}
