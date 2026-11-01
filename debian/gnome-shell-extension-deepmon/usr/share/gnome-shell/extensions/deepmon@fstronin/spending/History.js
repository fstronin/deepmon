// Домен истории расходов: снапшоты баланса, пары, дневные агрегаты.
// Без GI: даты считаются локальными компонентами Date, деньги — центы.
import {S} from '../strings.js';

const VERSION = 1;
const FIRST_SAMPLE_SLACK_SECONDS = 300;

export function empty() {
    return {
        version: VERSION,
        primaryCurrency: null,
        samples: [],
        days: {},
        imported: {},
        importedCurrency: null,
        importedAt: null,
        alerts: {},
        lastSuccessAt: null,
    };
}

export function localDate(unixSeconds) {
    const d = new Date(unixSeconds * 1000);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${month}-${day}`;
}

function localTimeOfDay(unixSeconds) {
    const d = new Date(unixSeconds * 1000);
    return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
}

function clone(state) {
    return JSON.parse(JSON.stringify(state));
}

export function appendSample(state, sample, {intervalMinutes}) {
    if (state.primaryCurrency !== null && state.primaryCurrency !== sample.currency)
        return {ok: false, code: 'currency-unavailable'};

    const next = clone(state);
    const previous = next.samples.length > 0 ? next.samples[next.samples.length - 1] : null;
    const intervalSeconds = intervalMinutes * 60;

    next.primaryCurrency = sample.currency;
    next.samples.push({
        t: sample.t,
        total: sample.total,
        granted: sample.granted ?? 0,
        toppedUp: sample.toppedUp ?? 0,
    });
    next.lastSuccessAt = sample.t;

    const date = localDate(sample.t);
    let day = next.days[date];
    if (!day) {
        day = {
            spend: 0,
            topup: 0,
            close: sample.total,
            samples: 0,
            approx: localTimeOfDay(sample.t) > intervalSeconds + FIRST_SAMPLE_SLACK_SECONDS,
            coveredFrom: sample.t,
        };
        next.days[date] = day;
    }

    if (previous) {
        const delta = sample.total - previous.total;
        if (delta < 0)
            day.spend += -delta;
        else if (delta > 0)
            day.topup += delta;
        if (sample.t - previous.t > 2 * intervalSeconds)
            day.approx = true;
    }

    day.close = sample.total;
    day.samples += 1;
    return {ok: true, state: next};
}

export function prune(state, {now, sampleRetentionDays = 7, dayRetentionDays = 400}) {
    const next = clone(state);
    const sampleCutoff = now - sampleRetentionDays * 86400;
    next.samples = next.samples.filter(sample => sample.t >= sampleCutoff);

    const dayCutoff = localDate(now - dayRetentionDays * 86400);
    for (const date of Object.keys(next.days)) {
        if (date < dayCutoff)
            delete next.days[date];
    }
    next.imported ??= {};
    for (const date of Object.keys(next.imported)) {
        if (date < dayCutoff)
            delete next.imported[date];
    }
    return next;
}

export function importCosts(state, {currency, days, now, dayRetentionDays = 400}) {
    const next = clone(state);
    next.imported ??= {};
    for (const {date, cents} of days)
        next.imported[date] = cents;
    next.importedCurrency = currency;
    next.importedAt = now;

    const cutoff = localDate(now - dayRetentionDays * 86400);
    for (const date of Object.keys(next.imported)) {
        if (date < cutoff)
            delete next.imported[date];
    }
    return next;
}

export function rebuild(state, {now, intervalMinutes, sampleRetentionDays = 7, dayRetentionDays = 400}) {
    const next = clone(state);
    const windowStart = localDate(now - sampleRetentionDays * 86400);
    for (const date of Object.keys(next.days)) {
        if (date >= windowStart)
            delete next.days[date];
    }

    const intervalSeconds = intervalMinutes * 60;
    let previous = null;
    for (const sample of next.samples) {
        const date = localDate(sample.t);
        let day = next.days[date];
        if (!day) {
            day = {
                spend: 0,
                topup: 0,
                close: sample.total,
                samples: 0,
                approx: localTimeOfDay(sample.t) > intervalSeconds + FIRST_SAMPLE_SLACK_SECONDS,
                coveredFrom: sample.t,
            };
            next.days[date] = day;
        }
        if (previous) {
            const delta = sample.total - previous.total;
            if (delta < 0)
                day.spend += -delta;
            else if (delta > 0)
                day.topup += delta;
            if (sample.t - previous.t > 2 * intervalSeconds)
                day.approx = true;
        }
        day.close = sample.total;
        day.samples += 1;
        previous = sample;
    }

    return prune(next, {now, sampleRetentionDays, dayRetentionDays});
}

function shiftDays(unixSeconds, deltaDays) {
    const d = new Date(unixSeconds * 1000);
    d.setDate(d.getDate() + deltaDays);
    return localDate(d.getTime() / 1000);
}

export function summarize(state, now, {chartDays, isAvailable = false}) {
    const dayView = date => {
        const imported = state.imported?.[date];
        if (imported !== undefined)
            return {spend: imported, approx: false, hasData: true, coveredFrom: null};
        const local = state.days[date];
        if (local)
            return {spend: local.spend, approx: local.approx, hasData: true, coveredFrom: local.coveredFrom};
        return {spend: 0, approx: false, hasData: false, coveredFrom: null};
    };

    const sumWindow = size => {
        let spend = 0;
        let daysWithData = 0;
        for (let back = 0; back < size; back++) {
            const view = dayView(shiftDays(now, -back));
            if (!view.hasData)
                continue;
            spend += view.spend;
            daysWithData += 1;
        }
        return {spend, daysWithData};
    };

    const today = dayView(shiftDays(now, 0));
    const chart = [];
    for (let back = chartDays - 1; back >= 0; back--) {
        const date = shiftDays(now, -back);
        const view = dayView(date);
        chart.push({date, spend: view.spend, approx: view.approx, hasData: view.hasData});
    }

    const last = state.samples.length > 0 ? state.samples[state.samples.length - 1] : null;
    return {
        currency: state.primaryCurrency,
        isAvailable: Boolean(isAvailable),
        balances: last
            ? [{currency: state.primaryCurrency, total: last.total, granted: last.granted, toppedUp: last.toppedUp}]
            : [],
        today: {
            spend: today.spend,
            approx: today.approx,
            coveredFrom: today.coveredFrom,
            hasData: today.hasData,
        },
        week: sumWindow(7),
        month: sumWindow(30),
        chart,
        updatedAt: state.lastSuccessAt,
    };
}

export function adoptCurrency(state, currency) {
    if (state.primaryCurrency === currency)
        return {state: clone(state), notice: null, archivedCurrency: null};

    if (state.primaryCurrency === null)
        return {state: {...clone(state), primaryCurrency: currency}, notice: null, archivedCurrency: null};

    const archived = state.primaryCurrency;
    const fresh = empty();
    fresh.primaryCurrency = currency;
    return {
        state: fresh,
        notice: S.notice.currencyChanged.replace('{currency}', archived),
        archivedCurrency: archived,
    };
}

export function serialize(state) {
    return JSON.stringify(state, null, 2);
}

export function deserialize(text) {
    let parsed;
    try {
        parsed = JSON.parse(text);
    } catch (e) {
        return {ok: false, code: 'corrupt', detail: `не JSON: ${e.message}`};
    }

    if (parsed?.version !== VERSION)
        return {ok: false, code: 'corrupt', detail: `версия ${parsed?.version}`};
    if (!Array.isArray(parsed.samples) || typeof parsed.days !== 'object' || parsed.days === null ||
        typeof parsed.alerts !== 'object' || parsed.alerts === null)
        return {ok: false, code: 'corrupt', detail: 'структура истории не соответствует версии'};
    if (parsed.primaryCurrency !== null && typeof parsed.primaryCurrency !== 'string')
        return {ok: false, code: 'corrupt', detail: 'primaryCurrency не строка'};

    return {
        ok: true,
        state: {
            ...parsed,
            imported: parsed.imported ?? {},
            importedCurrency: parsed.importedCurrency ?? null,
            importedAt: parsed.importedAt ?? null,
        },
    };
}
