// Единственное место порядка «решение → сохранение отметки → уведомление».
import {evaluate, alertText} from './DailyLimit.js';

export function dispatchAlert({summary, limitCents, enabled, state, date, save, notify}) {
    const decision = evaluate({summary, limitCents, enabled, alerts: state.alerts, date});
    if (!decision.fire)
        return {notified: false};

    state.alerts[date] = {limit: decision.limit, spend: decision.spend};
    const saved = save(state);
    if (!saved.ok)
        return {notified: false, error: saved};

    notify(alertText({
        spend: decision.spend,
        limit: decision.limit,
        currency: summary.currency,
    }));
    return {notified: true};
}
