import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import Adw from 'gi://Adw';
import Secret from 'gi://Secret';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {KeyringKeyReader, KEYRING_ATTRIBUTES, PLATFORM_ATTRIBUTES, keyringSchema} from './storage/KeyringKeyReader.js';
import {FileKeyReader, PLATFORM_TOKEN_PATTERN} from './storage/FileKeyReader.js';
import {KeyReader, fingerprint} from './storage/KeyReader.js';
import {Config} from './config/Config.js';

const PANEL_MODES = ['both', 'balance', 'spend'];
const PANEL_TITLES = ['Баланс и трата', 'Только баланс', 'Только трата'];
const KEY_RE = /^sk-[A-Za-z0-9_-]{16,}$/;

export default class DeepmonPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const page = new Adw.PreferencesPage({
            title: 'Deepmon',
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        page.add(this._limitGroup(settings));
        page.add(this._refreshGroup(settings));
        page.add(this._panelGroup(settings));
        page.add(this._currencyGroup(settings));
        page.add(this._keyGroup(settings, window));
    }

    _currencyGroup(settings) {
        const group = new Adw.PreferencesGroup({title: 'Валюта'});
        const row = new Adw.EntryRow({title: 'Код валюты (пусто — авто)'});
        row.text = settings.get_string('currency');
        row.connect('changed', () => {
            const value = row.text.trim().toUpperCase();
            const valid = value === '' || /^[A-Z]{3}$/.test(value);
            row.remove_css_class('error');
            if (!valid) {
                row.add_css_class('error');
                return;
            }
            if (value !== settings.get_string('currency'))
                settings.set_string('currency', value);
        });
        group.add(row);
        return group;
    }

    _limitGroup(settings) {
        const group = new Adw.PreferencesGroup({title: 'Уведомления'});

        const toggle = new Adw.SwitchRow({title: 'Оповещать о превышении дневного порога'});
        settings.bind('daily-limit-enabled', toggle, 'active', Gio.SettingsBindFlags.DEFAULT);

        const threshold = new Adw.SpinRow({
            title: 'Порог в день',
            digits: 2,
            adjustment: new Gtk.Adjustment({lower: 0, upper: 10000, step_increment: 0.1}),
        });
        threshold.value = settings.get_double('daily-limit');
        threshold.connect('notify::value', () => settings.set_double('daily-limit', threshold.value));
        toggle.bind_property('active', threshold, 'sensitive', GObject.BindingFlags.SYNC_CREATE);

        group.add(toggle);
        group.add(threshold);
        return group;
    }

    _refreshGroup(settings) {
        const group = new Adw.PreferencesGroup({title: 'Обновление'});
        const row = new Adw.SpinRow({
            title: 'Интервал опроса, мин',
            adjustment: new Gtk.Adjustment({lower: 1, upper: 120, step_increment: 1}),
        });
        row.value = settings.get_uint('refresh-minutes');
        row.connect('notify::value', () => settings.set_uint('refresh-minutes', Math.round(row.value)));
        group.add(row);
        return group;
    }

    _panelGroup(settings) {
        const group = new Adw.PreferencesGroup({title: 'Панель'});

        const mode = new Adw.ComboRow({
            title: 'Показывать',
            model: Gtk.StringList.new(PANEL_TITLES),
        });
        mode.selected = Math.max(0, PANEL_MODES.indexOf(settings.get_string('panel-mode')));
        mode.connect('notify::selected', () => settings.set_string('panel-mode', PANEL_MODES[mode.selected]));

        const days = new Adw.SpinRow({
            title: 'Дней на графике',
            adjustment: new Gtk.Adjustment({lower: 7, upper: 90, step_increment: 1}),
        });
        days.value = settings.get_uint('chart-days');
        days.connect('notify::value', () => settings.set_uint('chart-days', Math.round(days.value)));

        group.add(mode);
        group.add(days);
        return group;
    }

    _keyGroup(settings, window) {
        const group = new Adw.PreferencesGroup({title: 'Ключ API'});
        const config = new Config(settings);
        const row = new Adw.ActionRow({title: 'Ключ', subtitle: 'проверяю…'});

        const saveButton = new Gtk.Button({label: 'Сохранить…', valign: Gtk.Align.CENTER});
        const deleteButton = new Gtk.Button({label: 'Удалить', valign: Gtk.Align.CENTER});
        row.add_suffix(saveButton);
        row.add_suffix(deleteButton);
        group.add(row);

        row.bind_property('subtitle', row, 'tooltip_text', GObject.BindingFlags.SYNC_CREATE);

        const refreshStatus = () => {
            const reader = new KeyReader({
                keyring: new KeyringKeyReader(),
                file: new FileKeyReader({path: config.keyFilePath}),
            });
            reader.readKey().then(result => {
                if (!result.ok) {
                    row.subtitle = 'не задан ни в связке ключей, ни в файле';
                    return;
                }
                const source = result.source === 'keyring' ? 'keyring' : config.keyFilePath;
                row.subtitle = `${source}: sk-…${result.key.slice(-4)} · sha256 ${fingerprint(result.key)}`;
            });
        };
        refreshStatus();

        saveButton.connect('clicked', () => this._askForKey(window, refreshStatus));
        deleteButton.connect('clicked', () => {
            try {
                Secret.password_clear_sync(keyringSchema(), KEYRING_ATTRIBUTES, null);
                refreshStatus();
            } catch (error) {
                row.subtitle = `не удалось удалить: ${error.message}`;
            }
        });

        const platformPath = GLib.build_filenamev([GLib.get_user_config_dir(), 'deepmon', 'platform-token']);
        const platformRow = new Adw.ActionRow({title: 'Токен платформы', subtitle: 'проверяю…'});
        const platformSave = new Gtk.Button({label: 'Сохранить…', valign: Gtk.Align.CENTER});
        const platformDelete = new Gtk.Button({label: 'Удалить', valign: Gtk.Align.CENTER});
        platformRow.add_suffix(platformSave);
        platformRow.add_suffix(platformDelete);
        group.add(platformRow);

        const refreshPlatformStatus = () => {
            const reader = new KeyReader({
                keyring: new KeyringKeyReader({attributes: PLATFORM_ATTRIBUTES}),
                file: new FileKeyReader({path: platformPath, pattern: PLATFORM_TOKEN_PATTERN}),
            });
            reader.readKey().then(result => {
                if (!result.ok) {
                    platformRow.subtitle = 'не задан — история только по локальным опросам';
                    return;
                }
                const source = result.source === 'keyring' ? 'keyring' : platformPath;
                platformRow.subtitle = `${source}: sha256 ${fingerprint(result.key)}`;
            });
        };
        refreshPlatformStatus();

        platformSave.connect('clicked', () => this._askForKey(window, refreshPlatformStatus, {
            title: 'Токен веб-сессии платформы',
            entryTitle: 'userToken',
            hint: 'Приватный эндпоинт даёт дневные расходы за прошлые дни. Токен — это доступ ко всему аккаунту.',
            attributes: PLATFORM_ATTRIBUTES,
            label: 'DeepSeek platform session token',
            pattern: PLATFORM_TOKEN_PATTERN,
            invalid: 'Неверный токен: ожидается строка от 16 символов.',
        }));
        platformDelete.connect('clicked', () => {
            try {
                Secret.password_clear_sync(keyringSchema(), PLATFORM_ATTRIBUTES, null);
                refreshPlatformStatus();
            } catch (error) {
                platformRow.subtitle = `не удалось удалить: ${error.message}`;
            }
        });

        return group;
    }

    _askForKey(window, onSaved, {
        title = 'Ключ DeepSeek API',
        entryTitle = 'sk-…',
        hint: hintText = 'Вставьте ключ DeepSeek API, он сохранится в связке ключей GNOME.',
        attributes = KEYRING_ATTRIBUTES,
        label = 'DeepSeek API key',
        pattern = KEY_RE,
        invalid = 'Неверный формат: ожидается sk-… длиной от 16 символов.',
    } = {}) {
        const dialog = new Adw.Dialog({title, content_width: 460});
        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            margin_top: 18,
            margin_bottom: 18,
            margin_start: 18,
            margin_end: 18,
        });
        const entry = new Adw.PasswordEntryRow({title: entryTitle});
        const hint = new Gtk.Label({label: hintText, wrap: true, xalign: 0});
        const actions = new Gtk.Box({spacing: 8, halign: Gtk.Align.END});
        const cancel = new Gtk.Button({label: 'Отмена'});
        const save = new Gtk.Button({label: 'Сохранить', css_classes: ['suggested-action']});
        actions.append(cancel);
        actions.append(save);

        box.append(entry);
        box.append(hint);
        box.append(actions);
        dialog.set_child(box);

        cancel.connect('clicked', () => dialog.close());
        save.connect('clicked', () => {
            const key = entry.text.trim();
            if (!pattern.test(key)) {
                hint.label = invalid;
                return;
            }
            try {
                Secret.password_store_sync(keyringSchema(), attributes,
                    Secret.COLLECTION_DEFAULT, label, key, null);
                dialog.close();
                onSaved();
            } catch (error) {
                hint.label = `Не удалось сохранить: ${error.message}`;
            }
        });

        dialog.present(window);
    }
}
