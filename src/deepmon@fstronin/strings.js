// Все видимые строки в одном месте. msgid — английский текст; переводы лежат
// в po/ и компилируются в locale/<lang>/LC_MESSAGES/deepmon.mo (make po).
// Доступ: S.popup.title (прокси переводит строку в момент обращения).
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import gettext from 'gettext';

export const DOMAIN = 'deepmon';

export const KEYS = {
    panel: {
        arrow: '↓',
        overLimit: '⚠',
        blocked: 'DeepSeek ⚠',
    },
    popup: {
        title: 'DeepSeek API',
        refresh: 'Refresh now',
        open: 'platform.deepseek.com',
        settings: 'Settings',
        today: 'Today',
        week: '7 days',
        month: '30 days',
        unavailable: 'balance exhausted or unavailable',
        periodDays: 'data: {days} of 30',
        limitRatio: '{spent} / {limit}',
        approxPrefix: '≈',
    },
    alert: {
        title: 'DeepSeek: spending',
        body: 'Today {spend} — above the limit {limit}',
    },
    platform: {
        title: 'DeepSeek: platform token',
        expired: 'platform token expired — renew with: deepmon-key set --platform',
        failed: 'platform history: {code}',
    },
    notice: {
        currencyChanged: 'currency changed: history for {currency} moved to the archive',
    },
    errors: {
        'no-key': 'no API key: deepmon-key set',
        'insecure-permissions': 'key file permissions are wider than 0600: chmod 600 {path}',
        'keyring-locked': 'keyring is locked: open Passwords and Keys',
        'auth': 'key rejected ({status})',
        'rate-limit': 'rate limited, try again later',
        'network': 'no connection since {time}',
        'server': 'server error ({status})',
        'parse': 'unexpected API response',
        'currency-unavailable': 'the account has no {currency} balance (available: {available})',
        'storage': 'cannot save history: {path}',
        'cancelled': 'request cancelled',
    },
    prefs: {
        groupNotifications: 'Notifications',
        groupRefresh: 'Refresh',
        groupPanel: 'Panel',
        groupCurrency: 'Currency',
        groupKey: 'API key',
        notifyToggle: 'Notify when the daily limit is exceeded',
        threshold: 'Daily limit',
        interval: 'Polling interval, min',
        show: 'Show',
        modeBoth: 'Balance and spending',
        modeBalance: 'Balance only',
        modeSpend: 'Spending only',
        chartDays: 'Days on the chart',
        currencyCode: 'Currency code (empty — auto)',
        keyRow: 'Key',
        checking: 'checking…',
        keyMissing: 'not set in the keyring or the file',
        keyStatus: '{source}: {tail} · sha256 {hash}',
        keyTail: 'sk-…{tail}',
        platformRow: 'Platform token',
        platformMissing: 'not set — history comes from local polls only',
        platformStatus: '{source}: sha256 {hash}',
        save: 'Save…',
        delete: 'Delete',
        cancel: 'Cancel',
        saveButton: 'Save',
        dialogKeyTitle: 'DeepSeek API key',
        dialogKeyEntry: 'sk-…',
        dialogKeyHint: 'Paste the DeepSeek API key; it is stored in the GNOME keyring.',
        dialogPlatformTitle: 'Platform web session token',
        dialogPlatformEntry: 'userToken',
        dialogPlatformHint: 'The private endpoint returns daily costs for past days. The token grants full access to the account.',
        invalidKey: 'Invalid format: expected sk-… with at least 16 characters.',
        invalidToken: 'Invalid token: expected a string with at least 16 characters.',
        saveFailed: 'Cannot save: {detail}',
        deleteFailed: 'Cannot delete: {detail}',
    },
    cli: {
        usage: `deepmon-key — DeepSeek API key and platform token

  set [--platform] [--stdin]   store the secret in the keyring
                               (TTY: hidden input; --stdin: from a pipe)
  status                       sources and fingerprints of both secrets
  fingerprint [--platform]     print the fingerprint only
  delete [--platform]          remove the secret from the keyring
  --help                       this help

Without --platform the command works with the API key (needed for the balance).
With --platform it works with the web session token: it allows importing daily
costs from platform.deepseek.com (a private endpoint, not the API key).

Exit codes: 0 — success, 2 — bad arguments or format, 3 — keyring error.`,
        promptKey: 'Paste the DeepSeek API key (input hidden): ',
        promptPlatform: 'Paste the platform session token (input hidden): ',
        saved: 'saved {secret} · sha256 {hash}',
        statusApiKey: 'cli|API key',
        statusPlatform: 'platform',
        none: 'none ({code})',
        missingInput: 'no secret provided: use --stdin when input is redirected',
        invalidKey: 'invalid key format: expected sk-… with at least 16 characters',
        invalidToken: 'invalid platform token: expected a string with at least 16 characters',
        storeFailed: 'cannot store in the keyring: {detail}',
        storeFailedShort: 'cannot store in the keyring',
        deleted: '{name} removed from the keyring; {path} is untouched',
        unknownCommand: 'unknown command: {command}',
        noExtensionDir: 'deepmon extension directory not found',
        echoFailed: 'cannot disable terminal echo; use --stdin',
        nameKey: 'key',
        namePlatform: 'platform token',
        tailKey: 'sk-…{tail}',
        tailPlatform: '…{tail}',
        deletedPath: '~/.config/deepmon/{file}',
    },
};

let domainBound = false;

function localeDir() {
    const path = Gio.File.new_for_uri(import.meta.url).get_path();
    return GLib.build_filenamev([GLib.path_get_dirname(path), 'locale']);
}

function ensureDomain() {
    if (domainBound)
        return;
    gettext.bindtextdomain(DOMAIN, localeDir());
    gettext.textdomain(DOMAIN);
    domainBound = true;
}

export function t(msgid) {
    ensureDomain();
    const [context, id] = msgid.includes('|') ? msgid.split('|') : [null, msgid];
    return context
        ? gettext.dpgettext(DOMAIN, context, id)
        : gettext.dgettext(DOMAIN, msgid);
}

// Склонение через gettext: msgid "day" / msgid_plural "days".
export function days(count) {
    ensureDomain();
    return gettext.dngettext(DOMAIN, 'day', 'days', count);
}

const proxyCache = new Map();

function leafFor(key) {
    return key.split('.').reduce(
        (node, part) => (node && typeof node === 'object' ? node[part] : undefined),
        KEYS);
}

function nodeFor(prefix) {
    if (proxyCache.has(prefix))
        return proxyCache.get(prefix);

    const proxy = new Proxy({}, {
        get(target, prop) {
            if (typeof prop !== 'string')
                return undefined;
            const key = prefix === '' ? prop : `${prefix}.${prop}`;
            const leaf = leafFor(key);
            if (typeof leaf === 'string')
                return t(leaf);
            return nodeFor(key);
        },
        has(target, prop) {
            if (typeof prop !== 'string')
                return false;
            return leafFor(prefix === '' ? prop : `${prefix}.${prop}`) !== undefined;
        },
    });
    proxyCache.set(prefix, proxy);
    return proxy;
}

export const S = nodeFor('');
