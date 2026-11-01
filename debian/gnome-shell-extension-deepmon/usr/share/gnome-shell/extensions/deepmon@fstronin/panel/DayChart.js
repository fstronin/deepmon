import Clutter from 'gi://Clutter';
import St from 'gi://St';
import {barHeights} from './format.js';

const BAR_HEIGHT = 44;

export class DayChart {
    constructor() {
        this._bars = [];
        this._actor = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            style_class: 'deepmon-chart',
        });
        this._labels = new St.BoxLayout({
            vertical: false,
            x_expand: true,
            style_class: 'deepmon-chart-labels',
        });
        this._container = new St.BoxLayout({vertical: true, x_expand: true});
        this._container.add_child(this._actor);
        this._container.add_child(this._labels);
    }

    get actor() {
        return this._container;
    }

    get barCount() {
        return this._bars.length;
    }

    setData(points) {
        this._actor.destroy_all_children();
        this._labels.destroy_all_children();
        this._bars = [];
        if (points.length === 0)
            return;

        const heights = barHeights(points, {maxHeight: BAR_HEIGHT});
        points.forEach((point, index) => {
            const bar = new St.Widget({
                y_align: Clutter.ActorAlign.END,
                x_expand: true,
                style_class: 'deepmon-bar',
            });
            bar.set_style(`height: ${heights[index]}px;`);
            if (point.hasData === false)
                bar.add_style_class_name('deepmon-bar-empty');
            else if (point.approx)
                bar.add_style_class_name('deepmon-bar-approx');
            this._actor.add_child(bar);
            this._bars.push(bar);
        });

        this._labels.add_child(new St.Label({
            text: shortDate(points[0].date),
            style_class: 'deepmon-chart-date',
            x_expand: true,
            x_align: Clutter.ActorAlign.START,
        }));
        this._labels.add_child(new St.Label({
            text: shortDate(points[points.length - 1].date),
            style_class: 'deepmon-chart-date',
            x_expand: true,
            x_align: Clutter.ActorAlign.END,
        }));
    }
}

function shortDate(date) {
    const [, month, day] = date.split('-');
    return `${day}.${month}`;
}
