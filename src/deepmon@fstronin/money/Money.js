// Денежная арифметика: внутри — целые центы, на выходе — строки.
export const CURRENCY_SYMBOLS = {CNY: '¥', USD: '$', EUR: '€'};

const AMOUNT_RE = /^-?\d+(\.\d+)?$/;

export function parseAmount(text) {
    if (typeof text !== 'string')
        return null;
    const trimmed = text.trim();
    if (!AMOUNT_RE.test(trimmed))
        return null;
    return Math.round(Number(trimmed) * 100);
}

export function formatAmount(cents) {
    const sign = cents < 0 ? '-' : '';
    const absolute = Math.abs(cents);
    const whole = Math.trunc(absolute / 100);
    const fraction = String(absolute % 100).padStart(2, '0');
    return `${sign}${whole}.${fraction}`;
}

export function symbol(currency) {
    return CURRENCY_SYMBOLS[currency] ?? `${currency} `;
}

export function format(cents, currency) {
    return `${symbol(currency)}${formatAmount(cents)}`;
}
