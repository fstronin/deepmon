// Домен истории расходов: снапшоты баланса, пары, дневные агрегаты.
// Без GI: даты считаются локальными компонентами Date, деньги — центы.
const VERSION = 1;
const FIRST_SAMPLE_SLACK_SECONDS = 300;

export function empty() {
    return {
        version: VERSION,
        primaryCurrency: null,
        samples: [],
        days: {},
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
    const sumWindow = size => {
        let spend = 0;
        let daysWithData = 0;
        for (let back = 0; back < size; back++) {
            const day = state.days[shiftDays(now, -back)];
            if (!day)
                continue;
            spend += day.spend;
            daysWithData += 1;
        }
        return {spend, daysWithData};
    };

    const todayDate = shiftDays(now, 0);
    const today = state.days[todayDate];
    const chart = [];
    for (let back = chartDays - 1; back >= 0; back--) {
        const date = shiftDays(now, -back);
        const day = state.days[date];
        chart.push({
            date,
            spend: day?.spend ?? 0,
            approx: day?.approx ?? false,
            hasData: Boolean(day),
        });
    }

    const last = state.samples.length > 0 ? state.samples[state.samples.length - 1] : null;
    return {
        currency: state.primaryCurrency,
        isAvailable: Boolean(isAvailable),
        balances: last
            ? [{currency: state.primaryCurrency, total: last.total, granted: last.granted, toppedUp: last.toppedUp}]
            : [],
        today: {
            spend: today?.spend ?? 0,
            approx: today?.approx ?? false,
            coveredFrom: today?.coveredFrom ?? null,
            hasData: Boolean(today),
        },
        week: sumWindow(7),
        month: sumWindow(30),
        chart,
        updatedAt: state.lastSuccessAt,
    };
}
