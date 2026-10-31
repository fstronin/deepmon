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
