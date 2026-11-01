import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import St from 'gi://St';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {S} from '../strings.js';
import {DayChart} from './DayChart.js';
import {panelLabel} from './format.js';

export const Indicator = GObject.registerClass({
    GTypeName: 'DeepmonIndicator',
}, class Indicator extends PanelMenu.Button {
    _init({onRefresh, onOpenPrefs, onOpenPlatform, iconPath = null}) {
        super._init(0.0, 'DeepSeek Usage', false);
        this._onRefreshCallback = onRefresh;
        this._onOpenPrefsCallback = onOpenPrefs;
        this._onOpenPlatformCallback = onOpenPlatform;
        this._refreshing = false;
        this._view = null;

        this._label = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            clip_to_allocation: true,
            style_class: 'deepmon-panel-label',
        });
        this.add_child(this._label);

        this._buildMenu(iconPath);
        this.menu.box.add_style_class_name('deepmon-popup');
        this._menuSignal = this.menu.connect('open-state-changed', (menu, open) => {
            if (open)
                this._refresh();
        });
    }

    setState(view) {
        this._view = view;
        const label = panelLabel(view);
        this._label.text = label.text;
        this._label.style_class = label.styleClass
            ? `deepmon-panel-label ${label.styleClass}`
            : 'deepmon-panel-label';

        this._balanceLabel.text = view.balanceText || '—';
        this._captionsLabel.text = (view.captions ?? []).join(' · ');
        this._captionsLabel.visible = (view.captions ?? []).length > 0;
        this._statusLabel.text = view.statusText || '';
        this._statusLabel.visible = Boolean(view.statusText);

        this._setMessage(this._errorItem, view.errorText);
        this._setMessage(this._noticeItem, view.noticeText);

        this._periodLabels.today.text = view.periods.today;
        this._periodLabels.week.text = view.periods.week;
        this._periodLabels.month.text = view.periods.month;
        this._periodDaysLabel.text = view.periodDays ?? '';
        this._periodDaysLabel.visible = Boolean(view.periodDays);

        this._chart.setData(view.chart ?? []);
        this._limitItem.label.text = view.limitLabel || S.popup.limit.replace('{limit}', '—');
    }

    destroy() {
        if (this._menuSignal) {
            this.menu.disconnect(this._menuSignal);
            this._menuSignal = null;
        }
        this._chart = null;
        super.destroy();
        this._view = null;
    }

    _buildMenu(iconPath) {
        const header = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'deepmon-header',
        });
        const row = new St.BoxLayout({style_class: 'deepmon-header-row'});

        this._icon = new St.Icon({
            icon_size: 22,
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'deepmon-icon',
        });
        if (iconPath)
            this._icon.gicon = new Gio.FileIcon({file: Gio.File.new_for_path(iconPath)});
        else
            this._icon.visible = false;
        row.add_child(this._icon);

        const textBox = new St.BoxLayout({vertical: true, x_expand: true});
        this._titleLabel = new St.Label({text: S.popup.title, style_class: 'deepmon-caption'});
        this._balanceLabel = new St.Label({text: '—', style_class: 'deepmon-balance'});
        this._captionsLabel = new St.Label({text: '', style_class: 'deepmon-caption', visible: false});
        this._statusLabel = new St.Label({text: '', style_class: 'deepmon-status', visible: false});
        textBox.add_child(this._titleLabel);
        textBox.add_child(this._balanceLabel);
        textBox.add_child(this._captionsLabel);
        textBox.add_child(this._statusLabel);
        row.add_child(textBox);
        header.add_child(row);
        this.menu.addMenuItem(header);

        this._errorItem = this._messageItem('deepmon-error');
        this._noticeItem = this._messageItem('deepmon-notice');

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const periods = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const periodBox = new St.BoxLayout({x_expand: true, style_class: 'deepmon-periods'});
        this._periodLabels = {};
        this._periodCells = [];
        for (const [key, caption] of [['today', S.popup.today], ['week', S.popup.week], ['month', S.popup.month]]) {
            const cell = new St.BoxLayout({vertical: true, x_expand: true, style_class: 'deepmon-period-cell'});
            cell.add_child(new St.Label({
                text: caption,
                style_class: 'deepmon-caption',
                x_align: Clutter.ActorAlign.CENTER,
            }));
            const value = new St.Label({
                text: '—',
                style_class: 'deepmon-period-value',
                x_align: Clutter.ActorAlign.CENTER,
            });
            cell.add_child(value);
            periodBox.add_child(cell);
            this._periodCells.push(cell);
            this._periodLabels[key] = value;
        }
        periods.add_child(periodBox);
        this.menu.addMenuItem(periods);

        this._periodDaysLabel = new St.Label({
            text: '',
            style_class: 'deepmon-caption',
            x_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        const daysItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        daysItem.add_child(this._periodDaysLabel);
        this.menu.addMenuItem(daysItem);

        this._chart = new DayChart();
        const chartItem = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        chartItem.add_child(this._chart.actor);
        this.menu.addMenuItem(chartItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._refreshItem = this._actionItem(S.popup.refresh, () => this._refresh());
        this._limitItem = this._actionItem(S.popup.limit.replace('{limit}', '—'), () => this._openPrefs());
        this._openItem = this._actionItem(S.popup.open, () => this._onOpenPlatformCallback?.());
        this._settingsItem = this._actionItem(S.popup.settings, () => this._openPrefs());
    }

    _actionItem(text, callback) {
        const item = new PopupMenu.PopupMenuItem(text);
        item.connect('activate', () => callback());
        this.menu.addMenuItem(item);
        return item;
    }

    _messageItem(styleClass) {
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        item.visible = false;
        const label = new St.Label({text: '', style_class: styleClass});
        label.clutter_text.line_wrap = true;
        item.add_child(label);
        this.menu.addMenuItem(item);
        item._messageLabel = label;
        return item;
    }

    _setMessage(item, text) {
        item.visible = Boolean(text);
        item._messageLabel.text = text ?? '';
    }

    _openPrefs() {
        this._onOpenPrefsCallback?.();
    }

    _refresh() {
        if (this._refreshing)
            return;
        this._refreshing = true;
        this._refreshItem.setSensitive(false);
        const done = () => {
            this._refreshing = false;
            this._refreshItem.setSensitive(true);
        };
        try {
            const result = this._onRefreshCallback?.();
            if (result && typeof result.then === 'function')
                result.then(done, done);
            else
                done();
        } catch (error) {
            done();
            throw error;
        }
    }
});
