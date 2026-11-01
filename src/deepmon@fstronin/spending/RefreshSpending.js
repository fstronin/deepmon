// Use case одного цикла: ключ → запрос → выбор валюты → история → сохранение → сводка.
import {selectBalance} from '../balance/Balance.js';
import {fingerprint} from '../storage/KeyReader.js';
import * as History from './History.js';
import {S} from '../strings.js';

const DEFAULT_INTERVAL_MINUTES = 15;

export class RefreshSpending {
    constructor({source, store, keyReader, config, now, intervalMinutes = null,
        usageSource = null, platformTokenReader = null, importIntervalSeconds = 3600}) {
        this._source = source;
        this._store = store;
        this._keyReader = keyReader;
        this._config = config;
        this._now = now ?? (() => Math.floor(Date.now() / 1000));
        this._intervalMinutes = intervalMinutes;
        this._usageSource = usageSource;
        this._platformTokenReader = platformTokenReader;
        this._importIntervalSeconds = importIntervalSeconds;
        this._inFlight = false;
        this._authFingerprint = null;
    }

    async run({cancellable = null} = {}) {
        if (this._inFlight)
            return this._result({skipped: 'in-flight'});

        this._inFlight = true;
        try {
            return await this._runOnce(cancellable);
        } finally {
            this._inFlight = false;
        }
    }

    async _runOnce(cancellable) {
        const keyResult = await this._keyReader.readKey();
        if (!keyResult.ok)
            return this._result({error: {code: keyResult.code, detail: keyResult.detail}});

        const keyFingerprint = fingerprint(keyResult.key);
        if (this._authFingerprint === keyFingerprint)
            return this._result({skipped: 'auth-unchanged'});

        const loaded = this._store.load();
        if (!loaded.ok)
            return this._result({error: {code: loaded.code, detail: loaded.detail}});
        const warning = loaded.warning ?? null;

        const response = await this._source.request({key: keyResult.key, cancellable});
        if (!response.ok) {
            if (response.code === 'auth')
                this._authFingerprint = keyFingerprint;
            return this._result({error: {code: response.code, detail: response.detail}});
        }

        const selection = selectBalance(response.snapshot.balances, this._config.currency, loaded.state.primaryCurrency);
        if (!selection.ok) {
            return this._result({
                error: {code: selection.code, currency: this._config.currency, available: selection.available},
            });
        }

        const adopted = History.adoptCurrency(loaded.state, selection.selected.currency);
        if (adopted.archivedCurrency) {
            const archived = this._store.archive(adopted.archivedCurrency);
            if (!archived.ok)
                return this._result({error: {code: 'storage', detail: archived.detail}});
        }

        const appended = History.appendSample(adopted.state, {
            t: this._now(),
            ...selection.selected,
            isAvailable: response.snapshot.isAvailable,
        }, {intervalMinutes: this._interval()});
        if (!appended.ok)
            return this._result({error: {code: appended.code}});

        let state = History.rebuild(appended.state, {now: this._now(), intervalMinutes: this._interval()});
        const platform = await this._importPlatform(state);
        state = platform.state;
        const saved = this._store.save(state);
        const summary = History.summarize(state, this._now(), {
            chartDays: this._config.chartDays,
            isAvailable: response.snapshot.isAvailable,
        });
        summary.balances = response.snapshot.balances;
        this._authFingerprint = null;

        const platformWarning = platform.error ? platform.error.detail : null;
        const messages = [warning, platformWarning].filter(Boolean);
        const combinedWarning = messages.length > 0 ? messages.join('; ') : null;
        const extra = platform.error ? {platformError: platform.error} : {};
        return saved.ok
            ? {summary, notice: adopted.notice, warning: combinedWarning, state, error: null, ...extra}
            : {summary, notice: adopted.notice, warning: combinedWarning, state, error: {code: 'storage', detail: saved.detail}, ...extra};
    }

    // Необязательное обогащение: дневные стоимости с платформы (нужен токен веб-сессии).
    // Любая проблема оставляет локальную историю как есть.
    async _importPlatform(state) {
        if (!this._usageSource || !this._platformTokenReader)
            return {state, error: null};

        let token;
        try {
            token = await this._platformTokenReader.readKey();
        } catch (error) {
            return {state, error: {code: 'platform-internal', detail: error.message}};
        }
        if (!token.ok)
            return {state, error: null};

        const tokenFingerprint = fingerprint(token.key);
        if (state.platformAuthFingerprint === tokenFingerprint)
            return {state, error: {code: 'platform-auth', detail: S.platform.expired, authExpiredNew: false}};

        const now = this._now();
        if (state.importedAt && now - state.importedAt < this._importIntervalSeconds)
            return {state, error: null};

        // Окно покрывает и график, и колонку «30 дней».
        const span = Math.max(this._config.chartDays ?? 14, 30);
        const startDate = new Date(now * 1000);
        startDate.setHours(0, 0, 0, 0);
        startDate.setDate(startDate.getDate() - (span - 1));
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + span);

        let costs;
        try {
            costs = await this._usageSource.requestCosts({
                token: token.key,
                start: Math.floor(startDate.getTime() / 1000),
                end: Math.floor(endDate.getTime() / 1000),
                tz: -new Date(now * 1000).getTimezoneOffset() * 60,
                currency: state.primaryCurrency,
            });
        } catch (error) {
            return {state, error: {code: 'platform-internal', detail: error.message}};
        }

        if (!costs.ok) {
            const expired = costs.code === 'platform-auth';
            return {
                state: expired
                    ? History.markPlatformAuth(state, {fingerprint: tokenFingerprint, now})
                    : state,
                error: {
                    code: costs.code,
                    detail: expired ? S.platform.expired : S.platform.failed.replace('{code}', costs.code),
                    authExpiredNew: expired && state.platformAuthFingerprint !== tokenFingerprint,
                },
            };
        }
        if (costs.currency !== state.primaryCurrency)
            return {state, error: {code: 'platform-currency', detail: S.platform.failed.replace('{code}', 'platform-currency')}};

        return {
            state: History.clearPlatformAuth(History.importCosts(state, {
                currency: costs.currency,
                days: costs.days,
                now,
                balanceCents: state.samples.length > 0 ? state.samples[state.samples.length - 1].total : null,
            })),
            error: null,
        };
    }

    _interval() {
        return this._intervalMinutes ?? this._config.refreshMinutes ?? DEFAULT_INTERVAL_MINUTES;
    }

    _result({error = null, skipped = undefined} = {}) {
        return {summary: null, notice: null, state: null, error, skipped, warning: null};
    }
}
