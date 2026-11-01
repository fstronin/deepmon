// Use case одного цикла: ключ → запрос → выбор валюты → история → сохранение → сводка.
import {selectBalance} from '../balance/Balance.js';
import {fingerprint} from '../storage/KeyReader.js';
import * as History from './History.js';

const DEFAULT_INTERVAL_MINUTES = 15;

export class RefreshSpending {
    constructor({source, store, keyReader, config, now, intervalMinutes = null}) {
        this._source = source;
        this._store = store;
        this._keyReader = keyReader;
        this._config = config;
        this._now = now ?? (() => Math.floor(Date.now() / 1000));
        this._intervalMinutes = intervalMinutes;
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

        const response = await this._source.request({key: keyResult.key, cancellable});
        if (!response.ok) {
            if (response.code === 'auth')
                this._authFingerprint = keyFingerprint;
            return this._result({error: {code: response.code, detail: response.detail}});
        }

        const selection = selectBalance(response.snapshot.balances, this._config.currency);
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

        const state = History.rebuild(appended.state, {now: this._now(), intervalMinutes: this._interval()});
        const saved = this._store.save(state);
        const summary = History.summarize(state, this._now(), {
            chartDays: this._config.chartDays,
            isAvailable: response.snapshot.isAvailable,
        });
        summary.balances = response.snapshot.balances;
        this._authFingerprint = null;

        return saved.ok
            ? {summary, notice: adopted.notice, state, error: null}
            : {summary, notice: adopted.notice, state, error: {code: 'storage', detail: saved.detail}};
    }

    _interval() {
        return this._intervalMinutes ?? this._config.refreshMinutes ?? DEFAULT_INTERVAL_MINUTES;
    }

    _result({error = null, skipped = undefined} = {}) {
        return {summary: null, notice: null, state: null, error, skipped};
    }
}
