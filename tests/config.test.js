import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {Config} from '../src/deepmon@fstronin/config/Config.js';

const testDir = GLib.path_get_dirname(Gio.File.new_for_uri(import.meta.url).get_path());
const root = GLib.path_get_dirname(testDir);
let source = null;

function compiledSchemas() {
    if (source)
        return source;
    const dir = GLib.build_filenamev([root, 'tests', 'tmp', 'schemas']);
    GLib.mkdir_with_parents(dir, 0o700);
    const schemaPath = GLib.build_filenamev([root, 'src', 'deepmon@fstronin', 'schemas',
        'org.gnome.shell.extensions.deepmon.gschema.xml']);
    const [, contents] = Gio.File.new_for_path(schemaPath).load_contents(null);
    GLib.file_set_contents(GLib.build_filenamev([dir, 'org.gnome.shell.extensions.deepmon.gschema.xml']), contents);

    const [ok, , stderr] = GLib.spawn_command_line_sync(`glib-compile-schemas ${dir}`);
    if (!ok)
        throw new Error(`glib-compile-schemas: ${new TextDecoder().decode(stderr)}`);

    source = Gio.SettingsSchemaSource.new_from_directory(dir, Gio.SettingsSchemaSource.get_default(), false);
    return source;
}

function schemaSettings() {
    const schema = compiledSchemas().lookup('org.gnome.shell.extensions.deepmon', true);
    return new Gio.Settings({settings_schema: schema, backend: Gio.memory_settings_backend_new()});
}

function defaultKeyPath() {
    return GLib.build_filenamev([GLib.get_user_config_dir(), 'deepmon', 'key']);
}

export const tests = [
    {name: 'значения по умолчанию', fn: t => {
        const c = new Config(schemaSettings());
        t.eq(c.refreshMinutes, 15);
        t.eq(c.dailyLimitCents, 100);
        t.eq(c.alertsEnabled, true);
        t.eq(c.panelMode, 'both');
        t.eq(c.chartDays, 14);
        t.eq(c.apiBaseUrl, 'https://api.deepseek.com');
        t.eq(c.currency, '');
        t.eq(c.keyFilePath, defaultKeyPath());
    }},
    {name: 'dailyLimitCents округляет', fn: t => {
        const settings = schemaSettings();
        settings.set_double('daily-limit', 0.015);
        t.eq(new Config(settings).dailyLimitCents, 2);
    }},
    {name: 'panel-mode принимает только enum', fn: t => {
        const settings = schemaSettings();
        t.eq(settings.set_string('panel-mode', 'nonsense'), false);
        t.eq(new Config(settings).panelMode, 'both');
    }},
    {name: 'connect/destroy не текут', fn: t => {
        const c = new Config(schemaSettings());
        let calls = 0;
        const id = c.connect(() => calls++);
        t.ok(typeof id === 'number', 'id');
        c.destroy();
    }},
];
