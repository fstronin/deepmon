import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const UUID = 'deepmon@fstronin';
const REPORT = '@REPORT@';
const EXPECT = GLib.getenv('PROBE_EXPECT') ?? '';
const TICK_MS = 100;
const MAX_TICKS = 120;

function write(patch) {
    let current = {};
    try {
        const [, bytes] = Gio.File.new_for_path(REPORT).load_contents(null);
        current = JSON.parse(new TextDecoder().decode(bytes));
    } catch (error) {
        current = {};
    }
    GLib.file_set_contents(REPORT, JSON.stringify({...current, ...patch}));
}

function textOf(item) {
    try {
        return item?.label?.text ?? item?.text?._text ?? '';
    } catch (error) {
        return '';
    }
}

function collectItems(menu) {
    const items = menu?._getMenuItems?.() ?? menu?.box?.get_children?.() ?? [];
    return Array.from(items).map(textOf).filter(text => text !== '');
}

function finish(area) {
    write({
        labelText: area._label?.text ?? null,
        labelClass: area._label?.get_style_class_name?.() ?? null,
        menuItems: collectItems(area.menu),
        barCount: area._chart?.barCount ?? 0,
    });
    Main.extensionManager.disableExtension(UUID);
    write({uiGroupChildrenAfterDisable: Main.uiGroup.get_n_children(), done: true});
}

function measure(area) {
    return {
        menuIsOpen: Boolean(area.menu?.isOpen),
        iconVisible: Boolean(area._icon?.visible),
        iconHasGicon: Boolean(area._icon?.gicon),
        periodDaysText: area._periodDaysLabel?.text ?? null,
        periodValues: ['today', 'week', 'month'].map(key => area._periodLabels?.[key]?.text ?? null),
    };
}

export default class ProbeExtension extends Extension {
    enable() {
        write({uiGroupChildrenBefore: Main.uiGroup.get_n_children()});
        try {
            Promise.resolve(Main.extensionManager.enableExtension(UUID))
                .catch(error => write({enableError: String(error)}));
        } catch (error) {
            write({enableError: String(error)});
        }
        this._waitForIndicator(0);
    }

    _waitForIndicator(tries) {
        const area = Main.panel.statusArea[UUID];
        if (area) {
            write({indicatorFound: true});
            this._waitForLabel(area, 0);
            return;
        }
        if (tries >= MAX_TICKS) {
            write({indicatorFound: false});
            return;
        }
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, TICK_MS, () => {
            this._waitForIndicator(tries + 1);
            return GLib.SOURCE_REMOVE;
        });
    }

    _waitForLabel(area, tries) {
        const text = area._label?.text ?? '';
        if (EXPECT === '' || text.includes(EXPECT) || tries >= MAX_TICKS) {
            area.menu.open();
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
                write(measure(area));
                area.menu.close();
                finish(area);
                return GLib.SOURCE_REMOVE;
            });
            return;
        }
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, TICK_MS, () => {
            this._waitForLabel(area, tries + 1);
            return GLib.SOURCE_REMOVE;
        });
    }

    disable() {}
}
