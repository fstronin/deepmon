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
import {S} from './strings.js';

const PANEL_MODES = ['both', 'balance', 'spend'];
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
        const group = new Adw.PreferencesGroup({title: S.prefs.groupCurrency});
        const row = new Adw.EntryRow({title: S.prefs.currencyCode});
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
        const group = new Adw.PreferencesGroup({title: S.prefs.groupNotifications});

        const toggle = new Adw.SwitchRow({title: S.prefs.notifyToggle});
        settings.bind('daily-limit-enabled', toggle, 'active', Gio.SettingsBindFlags.DEFAULT);

        const threshold = new Adw.SpinRow({
            title: S.prefs.threshold,
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
        const group = new Adw.PreferencesGroup({title: S.prefs.groupRefresh});
        const row = new Adw.SpinRow({
            title: S.prefs.interval,
            adjustment: new Gtk.Adjustment({lower: 1, upper: 120, step_increment: 1}),
        });
        row.value = settings.get_uint('refresh-minutes');
        row.connect('notify::value', () => settings.set_uint('refresh-minutes', Math.round(row.value)));
        group.add(row);
        return group;
    }

    _panelGroup(settings) {
        const group = new Adw.PreferencesGroup({title: S.prefs.groupPanel});

        const mode = new Adw.ComboRow({
            title: S.prefs.show,
            model: Gtk.StringList.new([S.prefs.modeBoth, S.prefs.modeBalance, S.prefs.modeSpend]),
        });
        mode.selected = Math.max(0, PANEL_MODES.indexOf(settings.get_string('panel-mode')));
        mode.connect('notify::selected', () => settings.set_string('panel-mode', PANEL_MODES[mode.selected]));

        const days = new Adw.SpinRow({
            title: S.prefs.chartDays,
            adjustment: new Gtk.Adjustment({lower: 7, upper: 90, step_increment: 1}),
        });
        days.value = settings.get_uint('chart-days');
        days.connect('notify::value', () => settings.set_uint('chart-days', Math.round(days.value)));

        group.add(mode);
        group.add(days);
        return group;
    }

    _keyGroup(settings, window) {
        const group = new Adw.PreferencesGroup({title: S.prefs.groupKey});
        const config = new Config(settings);
        const row = new Adw.ActionRow({title: S.prefs.keyRow, subtitle: S.prefs.checking});

        const saveButton = new Gtk.Button({label: S.prefs.save, valign: Gtk.Align.CENTER});
        const deleteButton = new Gtk.Button({label: S.prefs.delete, valign: Gtk.Align.CENTER});
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
                    row.subtitle = S.prefs.keyMissing;
                    return;
                }
                const source = result.source === 'keyring' ? 'keyring' : config.keyFilePath;
                row.subtitle = S.prefs.keyStatus
                    .replace('{source}', source)
                    .replace('{tail}', S.prefs.keyTail.replace('{tail}', result.key.slice(-4)))
                    .replace('{hash}', fingerprint(result.key));
            });
        };
        refreshStatus();

        saveButton.connect('clicked', () => this._askForKey(window, refreshStatus));
        deleteButton.connect('clicked', () => {
            try {
                Secret.password_clear_sync(keyringSchema(), KEYRING_ATTRIBUTES, null);
                refreshStatus();
            } catch (error) {
                row.subtitle = S.prefs.deleteFailed.replace('{detail}', error.message);
            }
        });

        const platformPath = GLib.build_filenamev([GLib.get_user_config_dir(), 'deepmon', 'platform-token']);
        const platformRow = new Adw.ActionRow({title: S.prefs.platformRow, subtitle: S.prefs.checking});
        const platformSave = new Gtk.Button({label: S.prefs.save, valign: Gtk.Align.CENTER});
        const platformDelete = new Gtk.Button({label: S.prefs.delete, valign: Gtk.Align.CENTER});
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
                    platformRow.subtitle = S.prefs.platformMissing;
                    return;
                }
                const source = result.source === 'keyring' ? 'keyring' : platformPath;
                platformRow.subtitle = S.prefs.platformStatus
                    .replace('{source}', source)
                    .replace('{hash}', fingerprint(result.key));
            });
        };
        refreshPlatformStatus();

        platformSave.connect('clicked', () => this._askForKey(window, refreshPlatformStatus, {
            title: S.prefs.dialogPlatformTitle,
            entryTitle: S.prefs.dialogPlatformEntry,
            hint: S.prefs.dialogPlatformHint,
            attributes: PLATFORM_ATTRIBUTES,
            label: 'DeepSeek platform session token',
            pattern: PLATFORM_TOKEN_PATTERN,
            invalid: S.prefs.invalidToken,
        }));
        platformDelete.connect('clicked', () => {
            try {
                Secret.password_clear_sync(keyringSchema(), PLATFORM_ATTRIBUTES, null);
                refreshPlatformStatus();
            } catch (error) {
                platformRow.subtitle = S.prefs.deleteFailed.replace('{detail}', error.message);
            }
        });

        return group;
    }

    _askForKey(window, onSaved, {
        title = S.prefs.dialogKeyTitle,
        entryTitle = S.prefs.dialogKeyEntry,
        hint: hintText = S.prefs.dialogKeyHint,
        attributes = KEYRING_ATTRIBUTES,
        label = 'DeepSeek API key',
        pattern = KEY_RE,
        invalid = S.prefs.invalidKey,
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
        const cancel = new Gtk.Button({label: S.prefs.cancel});
        const save = new Gtk.Button({label: S.prefs.saveButton, css_classes: ['suggested-action']});
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
                hint.label = S.prefs.saveFailed.replace('{detail}', error.message);
            }
        });

        dialog.present(window);
    }
}
