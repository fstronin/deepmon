#!/usr/bin/env python3
"""Render README previews from the real history file.

The GNOME Shell screenshot interface is restricted on Wayland, so the images are
rendered with the same strings, numbers and geometry as the popup/panel instead of
being captured from the screen. Data comes from ~/.local/state/deepmon/history.json.
"""
import json
import datetime as dt
import pathlib
import subprocess

from PIL import Image, ImageDraw, ImageFont

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOCS = ROOT / 'docs'
WHALE = ROOT / 'src' / 'deepmon@fstronin' / 'icons' / 'deepseek-whale.png'
HISTORY = pathlib.Path.home() / '.local' / 'state' / 'deepmon' / 'history.json'

BG = (48, 48, 48)
BAR = (32, 32, 32)
FG = (255, 255, 255)
MUTED = (178, 178, 178)
ACCENT = (77, 107, 254)
EMPTY = (110, 110, 110)

FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
BOLD = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'


def font(size, bold=False):
    return ImageFont.truetype(BOLD if bold else FONT, size)


def load_state():
    state = json.loads(HISTORY.read_text())
    imported = state.get('imported') or {}
    samples = state.get('samples') or []
    currency = state.get('primaryCurrency') or 'USD'
    today = dt.date.today()
    iso = today.isoformat()

    chart = []
    for back in range(13, -1, -1):
        date = (today - dt.timedelta(days=back)).isoformat()
        chart.append((date, imported.get(date, 0) / 100))

    def window(size):
        total = 0
        for back in range(size):
            date = (today - dt.timedelta(days=back)).isoformat()
            total += imported.get(date, 0)
        return total / 100

    balance = samples[-1]['total'] / 100 if samples else 0.0
    return {
        'currency': currency,
        'balance': balance,
        'chart': chart,
        'today': window(1),
        'week': window(7),
        'month': window(30),
        'days_with_data': sum(1 for d, _ in chart if d in imported),
    }


def threshold():
    try:
        out = subprocess.run(['gsettings', 'get', 'org.gnome.shell.extensions.deepmon', 'daily-limit'],
                             capture_output=True, text=True, timeout=5, check=True).stdout.strip()
        return float(out)
    except Exception:
        return 7.0


def money(value, currency, symbol=True):
    sign = '$' if currency == 'USD' else ('¥' if currency == 'CNY' else f'{currency} ')
    text = f'{abs(value):.2f}'
    return f'{sign}{text}' if symbol else text


def round_rect(draw, box, radius, fill):
    draw.rounded_rectangle(box, radius=radius, fill=fill)


def render_panel(state, path):
    label = money(state['balance'], 'USD')
    spend = money(state['today'], 'USD', symbol=False)
    image = Image.new('RGB', (420, 30), BAR)
    draw = ImageDraw.Draw(image)
    whale = Image.open(WHALE).convert('RGBA').resize((18, 18))
    image.paste(whale, (150, 6), whale)
    draw.text((174, 7), f'{label} ↓{spend}', font=font(13, True), fill=FG)
    image.save(path)


def render_popup(state, path):
    width, height = 360, 452
    image = Image.new('RGB', (width, height), BAR)
    draw = ImageDraw.Draw(image)
    round_rect(draw, (0, 0, width - 1, height - 1), 14, BG)

    pad = 20
    whale = Image.open(WHALE).convert('RGBA').resize((24, 24))
    image.paste(whale, (pad, pad), whale)
    draw.text((pad + 34, pad + 4), 'DeepSeek API', font=font(12), fill=MUTED)

    y = pad + 30
    draw.text((pad, y), money(state['balance'], 'USD'), font=font(27, True), fill=FG)
    ratio = f"{money(state['today'], 'USD')} / {threshold():.2f}"
    ratio_font = font(21, True)
    draw.text((width - pad - draw.textlength(ratio, font=ratio_font), y + 6), ratio,
              font=ratio_font, fill=(245, 194, 17) if state['today'] > threshold() else FG)

    y += 52
    draw.line((pad, y, width - pad, y), fill=(90, 90, 90), width=1)
    y += 18

    captions = ['Today', '7 days', '30 days']
    values = [money(state['today'], 'USD', False), money(state['week'], 'USD', False),
              money(state['month'], 'USD', False)]
    for index, (caption, value) in enumerate(zip(captions, values)):
        center = pad + (width - 2 * pad) * (index + 0.5) / 3
        draw.text((center - draw.textlength(caption, font=font(12)) / 2, y), caption,
                  font=font(12), fill=MUTED)
        value_font = font(18, True)
        draw.text((center - draw.textlength(value, font=value_font) / 2, y + 20), value,
                  font=value_font, fill=FG)

    y += 62
    if state['days_with_data'] < 30:
        note = f"data: {state['days_with_data']} days of 30"
        draw.text((width / 2 - draw.textlength(note, font=font(11)) / 2, y), note,
                  font=font(11), fill=MUTED)
        y += 20

    chart_top, chart_bottom = y + 8, y + 60
    values_only = [value for _, value in state['chart']]
    peak = max(values_only) or 1
    step = (width - 2 * pad) / len(state['chart'])
    bar_width = step - 5
    for index, (_, value) in enumerate(state['chart']):
        left = pad + index * step
        if value <= 0:
            draw.rounded_rectangle((left, chart_bottom - 2, left + bar_width, chart_bottom), 1, EMPTY)
            continue
        bar_height = max(4, round(value / peak * (chart_bottom - chart_top)))
        draw.rounded_rectangle((left, chart_bottom - bar_height, left + bar_width, chart_bottom),
                               2, ACCENT)

    y = chart_bottom + 8
    first, last = state['chart'][0][0], state['chart'][-1][0]
    draw.text((pad, y), dt.date.fromisoformat(first).strftime('%d.%m'), font=font(11), fill=MUTED)
    draw.text((width - pad - draw.textlength(dt.date.fromisoformat(last).strftime('%d.%m'), font=font(11)), y),
              dt.date.fromisoformat(last).strftime('%d.%m'), font=font(11), fill=MUTED)

    y += 22
    draw.line((pad, y, width - pad, y), fill=(90, 90, 90), width=1)
    y += 14
    for item in ['Refresh now', 'platform.deepseek.com', 'Settings']:
        draw.text((pad, y), item, font=font(14), fill=FG)
        y += 30

    image.save(path)


def main():
    DOCS.mkdir(exist_ok=True)
    state = load_state()
    render_panel(state, DOCS / 'panel.png')
    render_popup(state, DOCS / 'popup.png')
    print(f"panel.png, popup.png: balance {state['balance']:.2f}, today {state['today']:.2f}")


if __name__ == '__main__':
    main()
