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
    return `${prefix}${formatAmount(period.spend)}`;
}

function pluralDays(count) {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11)
        return `${count} день`;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14))
        return `${count} дня`;
    return `${count} дней`;
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
                week: periodText(summary.week, false),
                month: periodText(summary.month, false),
            }
            : {today: '—', week: '—', month: '—'},
        periodDays: summary && summary.month.daysWithData < 30
            ? S.popup.periodDays.replace('{days}', pluralDays(summary.month.daysWithData))
            : null,
        chart: summary?.chart ?? [],
        limitRatio: summary && limitCents > 0
            ? {
                text: S.popup.limitRatio
                    .replace('{spent}', format(summary.today.spend, summary.currency))
                    .replace('{limit}', formatAmount(limitCents)),
                over: summary.today.spend > limitCents,
            }
            : null,
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
