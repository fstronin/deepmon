// Чистая view-модель панели и геометрия столбцов графика.
import {format, formatAmount} from '../money/Money.js';
import {S} from '../strings.js';

function hhmm(unixSeconds) {
    const date = new Date(unixSeconds * 1000);
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function errorText(error) {
    if (!error)
        return '';
    const template = S.errors[error.code] ?? error.code;
    return template
        .replace('{status}', error.status ?? error.detail ?? '')
        .replace('{time}', error.time ?? hhmm(Date.now() / 1000))
        .replace('{path}', error.detail ?? '')
        .replace('{currency}', error.currency ?? '')
        .replace('{available}', (error.available ?? []).join(', '));
}

function periodText(period, withApprox) {
    const prefix = withApprox && period.approx ? S.popup.approxPrefix : '';
    const suffix = period.daysWithData !== undefined && period.daysWithData < 30 && period.windowDays
        ? S.popup.daysSuffix.replace('{days}', String(period.daysWithData))
        : '';
    return `${prefix}${formatAmount(period.spend)}${suffix}`;
}

export function buildViewModel({summary, notice = null, error = null, panelMode = 'both', limitCents = 0}) {
    const dataAvailable = Boolean(summary);
    const overLimit = dataAvailable && limitCents > 0 && summary.today.spend > limitCents;
    const stale = Boolean(error) && dataAvailable;
    const blocking = Boolean(error) && !dataAvailable;

    const balance = summary
        ? (summary.balances.find(item => item.currency === summary.currency) ?? summary.balances[0] ?? null)
        : null;

    let statusText = '';
    if (error)
        statusText = errorText(error);
    else if (summary && summary.isAvailable === false)
        statusText = S.popup.unavailable;
    else if (summary && summary.updatedAt)
        statusText = S.popup.updated.replace('{time}', hhmm(summary.updatedAt));

    return {
        mode: panelMode,
        currency: summary?.currency ?? null,
        balanceText: balance ? format(balance.total, balance.currency) : '',
        spend: summary?.today.spend ?? 0,
        spendText: summary ? formatAmount(summary.today.spend) : '',
        overLimit,
        stale,
        blocking,
        dataAvailable,
        isAvailable: summary?.isAvailable ?? false,
        periods: summary
            ? {
                today: periodText(summary.today, true),
                week: periodText({...summary.week, windowDays: 7}, false),
                month: periodText({...summary.month, windowDays: 30}, false),
            }
            : {today: '—', week: '—', month: '—'},
        chart: summary?.chart ?? [],
        extras: summary
            ? summary.balances
                .filter(item => item.currency !== summary.currency)
                .map(item => `${item.currency} ${formatAmount(item.total)}`)
            : [],
        funding: summary && balance
            ? [
                balance.granted > 0
                    ? S.popup.granted.replace('{amount}', format(balance.granted, balance.currency))
                    : null,
                balance.toppedUp > 0
                    ? S.popup.toppedUp.replace('{amount}', format(balance.toppedUp, balance.currency))
                    : null,
            ].filter(line => line !== null)
            : [],
        limitLabel: summary && limitCents > 0
            ? S.popup.limit.replace('{limit}', format(limitCents, summary.currency))
            : S.popup.limit.replace('{limit}', '—'),
        statusText,
        errorText: errorText(error),
        noticeText: notice ?? '',
    };
}

export function panelLabel(view) {
    if (view.blocking)
        return {text: S.panel.blocked, styleClass: 'deepmon-stale'};

    const spend = view.spendText;
    let text;
    if (view.mode === 'balance')
        text = view.balanceText;
    else if (view.mode === 'spend')
        text = `${S.panel.arrow}${spend || '0.00'}`;
    else
        text = view.spend > 0 ? `${view.balanceText} ${S.panel.arrow}${spend}` : view.balanceText;

    if (view.overLimit)
        text = `${text} ${S.panel.overLimit}`;

    const styleClass = view.overLimit
        ? 'deepmon-over-limit'
        : (view.stale || view.blocking ? 'deepmon-stale' : null);
    return {text, styleClass};
}

export function barHeights(points, {maxHeight = 44, minVisible = 3, emptyHeight = 2} = {}) {
    const spends = points.map(point => (point.hasData === false ? 0 : point.spend));
    const max = Math.max(0, ...spends);
    return points.map((point, index) => {
        const spend = spends[index];
        if (point.hasData === false || spend === 0 || max === 0)
            return emptyHeight;
        return Math.max(minVisible, Math.round(spend / max * maxHeight));
    });
}
