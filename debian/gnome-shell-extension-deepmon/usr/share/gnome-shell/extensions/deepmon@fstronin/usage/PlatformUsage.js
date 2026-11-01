// Разбор приватного ответа платформы usage/by_api_key/cost → дневные суммы в центах.
import {localDate} from '../spending/History.js';

export function parseCostResponse(text, {currency = null} = {}) {
    let payload;
    try {
        payload = JSON.parse(text);
    } catch (error) {
        return {ok: false, code: 'platform-parse', detail: `не JSON: ${error.message}`};
    }

    if (payload?.code !== 0)
        return {ok: false, code: 'platform-api', detail: `code ${payload?.code}: ${payload?.msg ?? ''}`};
    if (payload?.data?.biz_code !== undefined && payload.data.biz_code !== 0)
        return {ok: false, code: 'platform-api', detail: `biz_code ${payload.data.biz_code}`};

    const blocks = payload?.data?.biz_data?.data;
    if (!Array.isArray(blocks) || blocks.length === 0)
        return {ok: false, code: 'platform-parse', detail: 'нет biz_data.data'};

    const block = currency ? blocks.find(item => item?.currency === currency) : blocks[0];
    if (!block)
        return {ok: false, code: 'platform-currency', detail: `в ответе нет валюты ${currency}`};

    const totals = new Map();
    for (const series of block.series ?? []) {
        for (const bucket of series?.buckets ?? []) {
            // Реальный ответ отдаёт cost строкой; объект {value} — на случай смены формы.
            const raw = bucket?.cost;
            const value = typeof raw === 'object' && raw !== null ? Number(raw.value) : Number(raw);
            if (!Number.isFinite(value) || value <= 0)
                continue;
            const cents = Math.round(value * 100);
            if (cents <= 0)
                continue;
            const date = localDate(bucket.time);
            totals.set(date, (totals.get(date) ?? 0) + cents);
        }
    }

    const days = [...totals.entries()]
        .sort(([left], [right]) => (left < right ? -1 : 1))
        .map(([date, cents]) => ({date, cents}));
    return {ok: true, currency: block.currency, days};
}
