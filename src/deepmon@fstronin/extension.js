import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {Indicator} from './panel/Indicator.js';
import {buildViewModel} from './panel/format.js';

const UUID = 'deepmon@fstronin';

// Временная сборка для headless-проверки UI: сеть и настройки подключаются в Task 15.
function staticSummary() {
    const now = Math.floor(Date.now() / 1000);
    const chart = [];
    const date = new Date();
    const days = [];
    for (let back = 13; back >= 0; back--) {
        const day = new Date(date.getTime());
        day.setDate(day.getDate() - back);
        days.push(day);
    }
    days.forEach((day, index) => {
        chart.push({
            date: `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`,
            spend: index === days.length - 1 ? 62 : 0,
            approx: false,
            hasData: true,
        });
    });
    return {
        currency: 'CNY',
        isAvailable: true,
        updatedAt: now,
        balances: [{currency: 'CNY', total: 11840, granted: 0, toppedUp: 11840}],
        today: {spend: 62, approx: false, coveredFrom: now, hasData: true},
        week: {spend: 410, daysWithData: 7},
        month: {spend: 1785, daysWithData: 14},
        chart,
    };
}

export default class DeepmonExtension extends Extension {
    enable() {
        this._indicator = new Indicator({
            onRefresh: () => Promise.resolve(),
            onOpenPrefs: () => this.openPreferences(),
            onOpenPlatform: () => {},
        });
        Main.panel.addToStatusArea(UUID, this._indicator);
        this._indicator.setState(buildViewModel({
            summary: staticSummary(),
            panelMode: 'both',
            limitCents: 100,
        }));
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
