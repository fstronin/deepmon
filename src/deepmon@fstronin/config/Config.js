import GLib from 'gi://GLib';

export class Config {
    constructor(settings) {
        this._settings = settings;
        this._handlerId = undefined;
    }

    get refreshMinutes() {
        return this._settings.get_uint('refresh-minutes');
    }

    get dailyLimitCents() {
        return Math.round(this._settings.get_double('daily-limit') * 100);
    }

    get alertsEnabled() {
        return this._settings.get_boolean('daily-limit-enabled');
    }

    get panelMode() {
        return this._settings.get_string('panel-mode');
    }

    get chartDays() {
        return this._settings.get_uint('chart-days');
    }

    get apiBaseUrl() {
        return this._settings.get_string('api-base-url');
    }

    get platformBaseUrl() {
        return this._settings.get_string('platform-base-url');
    }

    get currency() {
        return this._settings.get_string('currency').trim();
    }

    get keyFilePath() {
        const configured = this._settings.get_string('key-file');
        return configured !== ''
            ? configured
            : GLib.build_filenamev([GLib.get_user_config_dir(), 'deepmon', 'key']);
    }

    connect(callback) {
        this._handlerId = this._settings.connect('changed', () => callback());
        return this._handlerId;
    }

    destroy() {
        if (this._handlerId !== undefined) {
            this._settings.disconnect(this._handlerId);
            this._handlerId = undefined;
        }
        this._settings = null;
    }
}
