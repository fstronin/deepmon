import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {Config} from './config/Config.js';
import {SoupBalanceSource} from './balance/SoupBalanceSource.js';
import {JsonSpendingStore} from './spending/JsonSpendingStore.js';
import {RefreshSpending} from './spending/RefreshSpending.js';
import {localDate} from './spending/History.js';
import {KeyReader} from './storage/KeyReader.js';
import {KeyringKeyReader, PLATFORM_ATTRIBUTES} from './storage/KeyringKeyReader.js';
import {FileKeyReader, PLATFORM_TOKEN_PATTERN} from './storage/FileKeyReader.js';
import {PlatformUsageSource} from './usage/PlatformUsageSource.js';
import {dispatchAlert} from './alerting/AlertFlow.js';
import {ShellNotifier} from './alerting/ShellNotifier.js';
import {Indicator} from './panel/Indicator.js';
import {buildViewModel} from './panel/format.js';
import {mergeRefresh} from './panel/viewState.js';
import {S} from './strings.js';

const UUID = 'deepmon@fstronin';
const PLATFORM_URL = 'https://platform.deepseek.com';
const FORCE_REFRESH_AFTER_SECONDS = 60;

export default class DeepmonExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._config = new Config(this._settings);
        this._store = new JsonSpendingStore({
            path: GLib.build_filenamev([GLib.get_user_state_dir(), 'deepmon', 'history.json']),
        });
        this._source = new SoupBalanceSource({baseUrl: this._config.apiBaseUrl});
        this._keyReader = new KeyReader({
            keyring: new KeyringKeyReader(),
            file: new FileKeyReader({path: this._config.keyFilePath}),
        });
        this._usageSource = new PlatformUsageSource({baseUrl: this._config.platformBaseUrl});
        this._platformTokenReader = this._buildPlatformTokenReader();
        this._refreshUnit = new RefreshSpending({
            source: this._source,
            store: this._store,
            keyReader: this._keyReader,
            config: this._config,
            usageSource: this._usageSource,
            platformTokenReader: this._platformTokenReader,
        });
        this._notifier = new ShellNotifier();
        this._cancellable = new Gio.Cancellable();
        this._refreshing = false;
        this._timerId = null;
        this._timerMinutes = null;
        this._lastSuccessAt = null;
        this._merged = {summary: null, notice: null, error: null};

        this._indicator = new Indicator({
            onRefresh: () => this._requestRefresh({force: true}),
            onOpenPrefs: () => this.openPreferences(),
            onOpenPlatform: () => Gio.AppInfo.launch_default_for_uri(PLATFORM_URL, null),
            iconPath: this._iconPath(),
        });
        Main.panel.addToStatusArea(UUID, this._indicator);

        this._render(buildViewModel({
            summary: null,
            panelMode: this._config.panelMode,
            limitCents: this._config.dailyLimitCents,
        }));

        this._settingsId = this._config.connect(() => this._onSettingsChanged());
        this._armTimer(this._config.refreshMinutes);
        this._requestRefresh({force: true});
    }

    disable() {
        this._disarmTimer();
        if (this._settingsId !== undefined && this._config) {
            this._config.destroy();
            this._settingsId = undefined;
        }
        this._cancellable?.cancel();
        this._indicator?.destroy();
        this._indicator = null;
        this._refreshUnit = null;
        this._store = null;
        this._source = null;
        this._keyReader = null;
        this._notifier = null;
        this._cancellable = null;
        this._config = null;
        this._settings = null;
        this._merged = {summary: null, notice: null, error: null};
    }

    _buildPlatformTokenReader() {
        return new KeyReader({
            keyring: new KeyringKeyReader({attributes: PLATFORM_ATTRIBUTES}),
            file: new FileKeyReader({
                path: GLib.build_filenamev([GLib.get_user_config_dir(), 'deepmon', 'platform-token']),
                pattern: PLATFORM_TOKEN_PATTERN,
            }),
        });
    }

    _iconPath() {
        return GLib.build_filenamev([this.path, 'icons', 'deepseek-whale.png']);
    }

    _requestRefresh({force = false} = {}) {
        const now = Math.floor(Date.now() / 1000);
        if (!force && this._lastSuccessAt !== null && now - this._lastSuccessAt < FORCE_REFRESH_AFTER_SECONDS)
            return Promise.resolve();
        return this._refresh();
    }

    async _refresh() {
        if (this._refreshing || !this._refreshUnit)
            return;
        this._refreshing = true;
        try {
            const result = await this._refreshUnit.run({cancellable: this._cancellable});
            if (result.skipped)
                return;

            this._merged = mergeRefresh(this._merged, result);
            if (this._merged.summary?.updatedAt)
                this._lastSuccessAt = this._merged.summary.updatedAt;

            this._render(this._viewModel());
            this._handleLimit(result);
            this._handlePlatformExpiry(result);
        } catch (error) {
            logError(error, `[${UUID}] refresh`);
        } finally {
            this._refreshing = false;
        }
    }

    _viewModel() {
        return buildViewModel({
            summary: this._merged.summary,
            notice: this._merged.notice,
            error: this._merged.error,
            panelMode: this._config?.panelMode ?? 'both',
            limitCents: this._config?.dailyLimitCents ?? 0,
        });
    }

    _render(view) {
        this._indicator?.setState(view);
    }

    _handleLimit({summary, state}) {
        if (!summary || !state)
            return;
        dispatchAlert({
            summary,
            limitCents: this._config.dailyLimitCents,
            enabled: this._config.alertsEnabled,
            state,
            date: localDate(Math.floor(Date.now() / 1000)),
            save: next => this._store.save(next),
            notify: payload => this._notifier.notify(payload),
        });
    }

    // Токен платформы обновляется только пользователем, поэтому об истечении
    // сообщаем один раз — по переходу, а не на каждом опросе.
    _handlePlatformExpiry({platformError}) {
        if (!platformError?.authExpiredNew)
            return;
        this._notifier.notify({title: S.platform.title, body: S.platform.expired});
    }

    _onSettingsChanged() {
        if (!this._config)
            return;
        const minutes = this._config.refreshMinutes;
        if (minutes !== this._timerMinutes)
            this._armTimer(minutes);
        this._source = new SoupBalanceSource({baseUrl: this._config.apiBaseUrl});
        this._usageSource = new PlatformUsageSource({baseUrl: this._config.platformBaseUrl});
        this._keyReader = new KeyReader({
            keyring: new KeyringKeyReader(),
            file: new FileKeyReader({path: this._config.keyFilePath}),
        });
        this._platformTokenReader = this._buildPlatformTokenReader();
        this._refreshUnit = new RefreshSpending({
            source: this._source,
            store: this._store,
            keyReader: this._keyReader,
            config: this._config,
            usageSource: this._usageSource,
            platformTokenReader: this._platformTokenReader,
        });
        this._render(this._viewModel());
    }

    _armTimer(minutes) {
        this._disarmTimer();
        this._timerMinutes = minutes;
        this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, minutes * 60, () => {
            this._requestRefresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _disarmTimer() {
        if (this._timerId !== null) {
            GLib.source_remove(this._timerId);
            this._timerId = null;
        }
        this._timerMinutes = null;
    }
}
