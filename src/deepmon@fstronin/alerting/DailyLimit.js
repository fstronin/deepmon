// Политика дневного уведомления: одна функция решения и текст сообщения.
import {format} from '../money/Money.js';
import {S} from '../strings.js';

export function evaluate({summary, limitCents, enabled, alerts, date}) {
    const spend = summary.today.spend;
    const fire = Boolean(enabled)
        && limitCents > 0
        && spend > limitCents
        && alerts[date]?.limit !== limitCents;
    return {fire, spend, limit: limitCents};
}

export function alertText({spend, limit, currency}) {
    return {
        title: S.alert.title,
        body: S.alert.body
            .replace('{spend}', format(spend, currency))
            .replace('{limit}', format(limit, currency)),
    };
}
