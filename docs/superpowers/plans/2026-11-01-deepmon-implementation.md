# deepmon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Расширение GNOME Shell 50, показывающее баланс и расходы DeepSeek API в панели, с popup-деталями, уведомлением о дневном пороге, безопасным хранением ключа и установкой deb-пакетом.

**Architecture:** Один процесс `gnome-shell` с расширением на ESM. Чистый домен (`money`, `balance/Balance`, `spending/History`, `alerting/DailyLimit`, `panel/format`) не импортирует GI; порты (`BalanceSource`, `SpendingStore`, `KeyReader`) объявлены рядом с доменом, адаптеры (`SoupBalanceSource`, `JsonSpendingStore`, `*KeyReader`, `ShellNotifier`) знают Soup/файлы/Secret; `extension.js` — единственный composition root и владелец таймера.

**Tech Stack:** GNOME Shell 50.1, gjs 1.88 (ESM), libsoup 3.6, Secret Service (gir1.2-secret-1), St/Clutter/PopupMenu, Adw (prefs), debhelper 13, gsettings.

**Spec:** `docs/superpowers/specs/2026-11-01-deepmon-design.md`

## Global Constraints

- `metadata.json`: `uuid = "deepmon@fstronin"`, `shell-version = ["50"]`, `settings-schema = "org.gnome.shell.extensions.deepmon"`.
- Деньги — целые центы; строки API парсятся `Math.round(parseFloat(v) * 100)`; нечисловое → `null`.
- Домен (`money/`, `balance/Balance.js`, `spending/History.js`, `alerting/DailyLimit.js`, `panel/format.js`) не импортирует `gi://*` и `resource:///org/gnome/shell/*`.
- Результат адаптеров — значение: `{ok: true, ...}` | `{ok: false, code, detail}`; исключения наружу не пробрасываются.
- Коды ошибок: `no-key`, `insecure-permissions`, `keyring-locked`, `auth`, `rate-limit`, `network`, `server`, `parse`, `currency-unavailable`, `storage`, `cancelled`.
- Все строки интерфейса — в `src/deepmon@fstronin/strings.js`; `gettext` не используется.
- Данные: `${XDG_STATE_HOME:-$HOME/.local/state}/deepmon/history.json`; ключ: keyring (`application=deepmon`, `account=deepseek-api`) или файл `0600`.
- Сетевые и Secret-вызовы — только асинхронные; файлы `history.json` — один синхронный вызов ≤512 КиБ.
- Тесты домена — `gjs -m tests/run.js`, без шелла; сетевые — против локального mock-сервера; UI — headless-шелл.
- Коммит после каждой задачи, префиксы `feat:`/`test:`/`build:`.

## Deviations from spec (осознанные, поведение эквивалентно)

- Спека называет `GLib.DateTime` для локальной даты; план использует `Date` с локальными компонентами — те же значения и никакого GI в домене.
- В дерево добавляется `strings.js` (спека §16 требует «все строки в одном модуле», дерево §4.4 файл не перечисляло).
- Порт-модули (`BalanceSource.js`, `SpendingStore.js`, `KeyReader.js` — только композиция) содержат JSDoc-контракт и не имеют исполняемого кода: это источник истины для адаптеров.

## Review Focus

Пять входов/условий, которые спека подразумевает, но не описывает явно; тест на каждый живёт в задаче, владеющей кодом.

1. Файл ключа с правами `0644` — ожидание: расширение **не читает** его и просит `chmod 600` (Task 10).
2. Пополнение баланса между опросами — ожидание: попадает в `topup`, суточная трата не становится отрицательной (Task 3).
3. Пара снапшотов через полночь — ожидание: относится к дню более позднего снапшота и не задваивается (Task 3).
4. Смена валюты при накопленной истории — ожидание: старый файл уходит в архив, новый учёт стартует с текущего снапшота, числа не смешиваются (Tasks 6, 7).
5. Сетевой сбой после успешного опроса — ожидание: панель и popup сохраняют последние числа со статусом «нет связи» (Task 14).

## Shared Contracts

Создаются по ходу задач; имена и типы фиксированы здесь, чтобы задачи не расходились.

```js
// money/Money.js
parseAmount(text) -> number|null            // "110.00" -> 11000
format(cents, currency) -> '¥118.40'
formatAmount(cents) -> '118.40'
symbol(currency) -> '¥' | '$' | '€' | 'SGD '

// balance/Balance.js
parseBalanceResponse(text) -> {ok:true, snapshot:{isAvailable, balances:[{currency,total,granted,toppedUp}]}}
                             | {ok:false, code:'parse', detail}
selectBalance(balances, preferred) -> {ok:true, selected:{currency,total,granted,toppedUp}}
                                    | {ok:false, code:'currency-unavailable', available:[string]}

// spending/History.js
empty() -> State
appendSample(state, sample, {intervalMinutes}) -> {ok:true, state} | {ok:false, code}
rebuild(state, {now, intervalMinutes, sampleRetentionDays, dayRetentionDays}) -> State
prune(state, {now, sampleRetentionDays, dayRetentionDays}) -> State
summarize(state, now, {chartDays, isAvailable}) -> Summary
adoptCurrency(state, currency) -> {state, notice, archivedCurrency}
serialize(state) -> string
deserialize(text) -> {ok:true, state} | {ok:false, code:'corrupt', detail}

// Summary (спека §7)
{currency, isAvailable, balances, today:{spend,approx,coveredFrom,hasData},
 week:{spend,daysWithData}, month:{spend,daysWithData},
 chart:[{date,spend,approx,hasData}], updatedAt}

// порты
source.request({key, cancellable}) -> Promise<{ok:true, snapshot}|{ok:false, code, detail}>
store.load()   -> {ok:true, state, warning?} | {ok:false, code:'storage', detail}
store.save(state) -> {ok:true} | {ok:false, code:'storage', detail}
store.archive(currency) -> {ok:true, path} | {ok:false, code:'storage', detail}
keyReader.readKey() -> Promise<{ok:true, key, source:'keyring'|'file'} | {ok:false, code, detail}>
fingerprint(key) -> '3f9a2c1b'             // sha256, первые 8 hex

// alerting/DailyLimit.js
evaluate({summary, limitCents, enabled, alerts, date}) -> {fire, spend, limit}
alertText({spend, limit, currency}) -> {title, body}

// panel/format.js
buildViewModel({summary, notice, error, panelMode, limitCents}) -> view
panelLabel(view) -> {text, styleClass}
barHeights(points, {maxHeight=44, minVisible=3, emptyHeight=2}) -> number[]

// spending/RefreshSpending.js
new RefreshSpending({source, store, keyReader, config, now})
run() -> {summary|null, notice|null, state|null, error|null, skipped?}
```

---

### Task 1: Каркас репозитория, тестовый раннер, деньги

**Files:**
- Create: `.gitignore`, `Makefile`, `tests/run.js`, `tests/money.test.js`, `src/deepmon@fstronin/money/Money.js`, `src/deepmon@fstronin/strings.js`

**Interfaces:**
- Consumes: ничего.
- Produces: `Money` (см. Shared Contracts); `strings.js` с объектом `S` (`S.panel`, `S.popup`, `S.alert`, `S.errors`); контракт тестов — каждый `*.test.js` экспортирует `export const tests = [{name, fn}]`, где `fn(t)` получает `t.eq(actual, expected, label)`, `t.ok(cond, label)`, `t.deepEq(actual, expected, label)`.

- [ ] **Step 1: Написать падающий тест денег**

`tests/money.test.js`:
```js
import {parseAmount, format, formatAmount, symbol} from '../src/deepmon@fstronin/money/Money.js';

export const tests = [
    {name: 'parseAmount: два знака', fn: t => t.eq(parseAmount('110.00'), 11000)},
    {name: 'parseAmount: один знак', fn: t => t.eq(parseAmount('0.1'), 10)},
    {name: 'parseAmount: мусор', fn: t => { t.eq(parseAmount('abc'), null); t.eq(parseAmount(''), null); }},
    {name: 'format: символ и два знака', fn: t => t.eq(format(11840, 'CNY'), '¥118.40')},
    {name: 'format: код без символа', fn: t => t.eq(format(1230, 'SGD'), 'SGD 12.30')},
    {name: 'formatAmount: отрицательные центы', fn: t => t.eq(formatAmount(-62), '-0.62')},
    {name: 'symbol', fn: t => { t.eq(symbol('USD'), '$'); t.eq(symbol('EUR'), '€'); }},
];
```

- [ ] **Step 2: Запустить и убедиться, что падает**

Run: `gjs -m tests/run.js`
Expected: ошибка импорта `money/Money.js` (модуль не существует).

- [ ] **Step 3: Реализовать раннер, деньги и строки**

`tests/run.js`: каталог тестов — `new URL('.', import.meta.url)` → `GLib.filename_from_uri(...)`, перечислить `*.test.js` через `Gio.File.enumerate_children`, импортировать динамически (`await import(fileUri)`), прогнать все `tests`, печатать `ok <file> :: <name>` / `FAIL ... expected/actual`, `process.exit(1)` при любом провале.

`money/Money.js`: `CURRENCY_SYMBOLS = {CNY:'¥', USD:'$', EUR:'€'}`, `parseAmount` через `Number.isFinite`-проверку после `parseFloat`, `format`/`formatAmount` через `Math.trunc` + `String(Math.abs(cents) % 100).padStart(2,'0')`, `symbol` возвращает `'<CODE> '` для неизвестных валют.

`strings.js`: только литералы из спеки §12 (`S.panel = {arrow:'↓', overLimit:'⚠', blocked:'DeepSeek ⚠'}`, `S.popup = {title:'DeepSeek API', refresh:'Обновить сейчас', limit:'Порог: {limit}/день', open:'platform.deepseek.com', settings:'Настройки', updated:'обновлено {time}', offline:'нет связи с {time}', ...}`, `S.alert = {title:'DeepSeek: расходы', body:'Сегодня {spend} — выше порога {limit}'}`, `S.errors` — по коду из спеки §13). Никаких вызовов функций на уровне модуля.

`.gitignore`: `*.deb`, `*.buildinfo`, `*.changes`, `debian/.debhelper/`, `debian/debhelper-build-stamp`, `debian/files`, `debian/*.substvars`, `debian/*.debhelper`, `tests/tmp/`.

`Makefile`: цели `test` (`gjs -m tests/run.js`), `clean`.

- [ ] **Step 4: Запустить и убедиться, что проходит**

Run: `gjs -m tests/run.js`
Expected: `7/7 ok`, exit 0.

- [ ] **Step 5: Коммит**

```bash
git add .gitignore Makefile tests/run.js tests/money.test.js "src/deepmon@fstronin/money/Money.js" "src/deepmon@fstronin/strings.js"
git commit -m "feat: каркас репозитория, тестовый раннер и денежная арифметика в центах"
```

---

### Task 2: Парсинг ответа баланса и выбор валюты

**Files:**
- Create: `src/deepmon@fstronin/balance/Balance.js`, `tests/balance.test.js`, `tests/fixtures/balance-cny.json`, `tests/fixtures/balance-multi.json`

**Interfaces:**
- Consumes: `parseAmount` из `money/Money.js`.
- Produces: `parseBalanceResponse(text)`, `selectBalance(balances, preferred)` — см. Shared Contracts.

- [ ] **Step 1: Написать падающий тест**

`tests/balance.test.js` (фикстуры читаются через `Gio.File.load_contents` по пути от `import.meta.url`):
```js
import {parseBalanceResponse, selectBalance} from '../src/deepmon@fstronin/balance/Balance.js';

export const tests = [
    {name: 'parse: CNY из фикстуры', fn: t => {
        const r = parseBalanceResponse(readFixture('balance-cny.json'));
        t.ok(r.ok, 'ok'); t.eq(r.snapshot.balances[0].total, 11840);
        t.eq(r.snapshot.balances[0].granted, 1000); t.eq(r.snapshot.isAvailable, true);
    }},
    {name: 'parse: is_available=false — валидный снапшот', fn: t => {
        const r = parseBalanceResponse('{"is_available":false,"balance_infos":[{"currency":"CNY","total_balance":"0.00","granted_balance":"0.00","topped_up_balance":"0.00"}]}');
        t.ok(r.ok, 'ok'); t.eq(r.snapshot.isAvailable, false);
    }},
    {name: 'parse: пустой balance_infos', fn: t => {
        const r = parseBalanceResponse('{"is_available":true,"balance_infos":[]}');
        t.ok(!r.ok, 'не ok'); t.eq(r.code, 'parse');
    }},
    {name: 'parse: нечисловой total_balance', fn: t => {
        const r = parseBalanceResponse('{"is_available":true,"balance_infos":[{"currency":"CNY","total_balance":"n/a"}]}');
        t.eq(r.code, 'parse');
    }},
    {name: 'selectBalance: авто берёт первую', fn: t => {
        const r = selectBalance([{currency:'CNY',total:1},{currency:'USD',total:2}], '');
        t.eq(r.selected.currency, 'CNY');
    }},
    {name: 'selectBalance: заданная закреплена', fn: t => {
        const r = selectBalance([{currency:'CNY',total:1},{currency:'USD',total:2}], 'USD');
        t.eq(r.selected.total, 2);
    }},
    {name: 'selectBalance: отсутствующая', fn: t => {
        const r = selectBalance([{currency:'CNY',total:1}], 'USD');
        t.ok(!r.ok, 'не ok'); t.eq(r.code, 'currency-unavailable'); t.deepEq(r.available, ['CNY']);
    }},
];
```

- [ ] **Step 2: Запустить, убедиться в провале**

Run: `gjs -m tests/run.js`
Expected: FAIL по импорту `balance/Balance.js`.

- [ ] **Step 3: Реализовать парсер**

`parseBalanceResponse`: `JSON.parse` в try/catch → `parse`; проверка `Array.isArray(balance_infos) && length > 0`; для каждой записи `currency` обязан быть непустой строкой, `total_balance` — `parseAmount(...) !== null` (иначе `parse`); `granted_balance`/`topped_up_balance` — через `parseAmount` с дефолтом `0`. `isAvailable = Boolean(is_available)`.
`selectBalance`: `preferred` пустой → `balances[0]`; иначе поиск по точному совпадению кода; не найдено → `{ok:false, code:'currency-unavailable', available: balances.map(b => b.currency)}`.

- [ ] **Step 4: Тесты зелёные**

Run: `gjs -m tests/run.js`
Expected: `14/14 ok`.

- [ ] **Step 5: Коммит**

```bash
git add tests/balance.test.js tests/fixtures "src/deepmon@fstronin/balance/Balance.js"
git commit -m "feat: разбор ответа /user/balance и выбор валюты учёта"
```

---

### Task 3: История — снапшот, пара, день, `approx`

**Files:**
- Create: `src/deepmon@fstronin/spending/History.js`, `tests/history.test.js`

**Interfaces:**
- Consumes: `selectBalance` не нужен; `History.empty()`.
- Produces: `empty()`, `appendSample(state, sample, {intervalMinutes})`, внутренняя `localDate(unixSeconds)` (не экспортируется). Состояние — объект из спеки §6.1.

- [ ] **Step 1: Написать падающий тест**

`tests/history.test.js` — все времена задаются явно, `tz` не инжектится (локальная зона машины):
```js
import * as H from '../src/deepmon@fstronin/spending/History.js';

const at = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h, mi).getTime() / 1000;

export const tests = [
    {name: 'empty: пустое состояние', fn: t => {
        const s = H.empty();
        t.deepEq(s.samples, []); t.eq(s.primaryCurrency, null); t.eq(s.lastSuccessAt, null);
    }},
    {name: 'первый снапшот задаёт валюту и день', fn: t => {
        const {state} = H.appendSample(H.empty(), {t: at(2026,11,1,10,0), currency:'CNY', total:11840, granted:1000, toppedUp:10840}, {intervalMinutes:15});
        t.eq(state.primaryCurrency, 'CNY');
        t.eq(state.days['2026-11-01'].close, 11840);
        t.eq(state.days['2026-11-01'].spend, 0);
        t.eq(state.days['2026-11-01'].samples, 1);
    }},
    {name: 'уменьшение -> spend', fn: t => {
        let {state} = H.appendSample(H.empty(), sample(at(2026,11,1,10,0), 11840), {intervalMinutes:15});
        ({state} = H.appendSample(state, sample(at(2026,11,1,10,15), 11778), {intervalMinutes:15}));
        t.eq(state.days['2026-11-01'].spend, 62); t.eq(state.days['2026-11-01'].topup, 0);
    }},
    {name: 'увеличение -> topup, spend не отрицателен', fn: t => {
        let {state} = H.appendSample(H.empty(), sample(at(2026,11,1,10,0), 100), {intervalMinutes:15});
        ({state} = H.appendSample(state, sample(at(2026,11,1,10,15), 50100), {intervalMinutes:15}));
        t.eq(state.days['2026-11-01'].topup, 50000); t.eq(state.days['2026-11-01'].spend, 0);
    }},
    {name: 'пара через полночь падает в день cur', fn: t => {
        let {state} = H.appendSample(H.empty(), sample(at(2026,10,31,23,50), 1000), {intervalMinutes:15});
        ({state} = H.appendSample(state, sample(at(2026,11,1,0,5), 940), {intervalMinutes:15}));
        t.eq(state.days['2026-11-01'].spend, 60);
        t.eq(state.days['2026-10-31'].spend, 0);
    }},
    {name: 'разрыв больше 2 интервалов -> approx', fn: t => {
        let {state} = H.appendSample(H.empty(), sample(at(2026,11,1,10,0), 1000), {intervalMinutes:15});
        ({state} = H.appendSample(state, sample(at(2026,11,1,12,0), 900), {intervalMinutes:15}));
        t.eq(state.days['2026-11-01'].approx, true);
    }},
    {name: 'первый снапшот дня позже порога -> approx', fn: t => {
        const {state} = H.appendSample(H.empty(), sample(at(2026,11,1,9,0), 1000), {intervalMinutes:15});
        t.eq(state.days['2026-11-01'].approx, true);
        t.eq(state.days['2026-11-01'].coveredFrom, at(2026,11,1,9,0));
    }},
    {name: 'coveredFrom на втором снапшоте не меняется', fn: t => {
        let {state} = H.appendSample(H.empty(), sample(at(2026,11,1,0,1), 1000), {intervalMinutes:15});
        ({state} = H.appendSample(state, sample(at(2026,11,1,0,16), 990), {intervalMinutes:15}));
        t.eq(state.days['2026-11-01'].coveredFrom, at(2026,11,1,0,1));
    }},
];

function sample(t, total) { return {t, currency:'CNY', total, granted:0, toppedUp:total}; }
```

- [ ] **Step 2: Запустить, убедиться в провале**

Run: `gjs -m tests/run.js`
Expected: FAIL по импорту `spending/History.js`.

- [ ] **Step 3: Реализовать**

`empty()` → `{version:1, primaryCurrency:null, samples:[], days:{}, alerts:{}, lastSuccessAt:null}` (deep-clone на каждом вызове).
`appendSample`: копия состояния (`structuredClone`); если `primaryCurrency === null` → присвоить `sample.currency`; если отличается → `{ok:false, code:'currency-unavailable'}`; push `{t,total,granted,toppedUp}`; `lastSuccessAt = sample.t`; если `samples.length > 1` — вычислить `delta` по последней паре и обновить `days[localDate(cur.t)]` по правилу спеки §6.2; иначе создать день с `spend:0, topup:0, close:total, samples:1, approx: localTimeOfDay(cur.t) > intervalMinutes*60 + 300, coveredFrom: cur.t`.
Порог `approx` по разрыву: `cur.t - prev.t > 2 * intervalMinutes * 60`.
`localDate(unix)` → `YYYY-MM-DD` из локальных компонент `new Date(unix * 1000)`.

- [ ] **Step 4: Тесты зелёные**

Run: `gjs -m tests/run.js`
Expected: `22/22 ok`.

- [ ] **Step 5: Коммит**

```bash
git add tests/history.test.js "src/deepmon@fstronin/spending/History.js"
git commit -m "feat: учёт трат по парам снапшотов с атрибуцией дня и пометкой approx"
```

---

### Task 4: История — пересборка агрегатов и retention

**Files:**
- Modify: `src/deepmon@fstronin/spending/History.js`
- Test: `tests/history.test.js`

**Interfaces:**
- Consumes: `empty`, `appendSample`.
- Produces: `rebuild(state, {now, intervalMinutes, sampleRetentionDays=7, dayRetentionDays=400})`, `prune(state, {now, sampleRetentionDays=7, dayRetentionDays=400})`.

- [ ] **Step 1: Дописать падающие тесты**

```js
{name: 'rebuild пересобирает день из снапшотов', fn: t => {
    let {state} = H.appendSample(H.empty(), sample(at(2026,11,1,10,0), 1000), {intervalMinutes:15});
    ({state} = H.appendSample(state, sample(at(2026,11,1,10,15), 950), {intervalMinutes:15}));
    const broken = structuredClone(state);
    broken.days['2026-11-01'].spend = 999;
    const fixed = H.rebuild(broken, {now: at(2026,11,1,10,20), intervalMinutes: 15});
    t.eq(fixed.days['2026-11-01'].spend, 50);
    t.eq(fixed.days['2026-11-01'].approx, false);
}},
{name: 'rebuild идемпотентен', fn: t => {
    let {state} = H.appendSample(H.empty(), sample(at(2026,11,1,10,0), 1000), {intervalMinutes:15});
    ({state} = H.appendSample(state, sample(at(2026,11,1,10,15), 950), {intervalMinutes:15}));
    const a = H.rebuild(state, {now: at(2026,11,1,10,20), intervalMinutes: 15});
    const b = H.rebuild(a, {now: at(2026,11,1,10,20), intervalMinutes: 15});
    t.deepEq(b, a);
}},
{name: 'prune: снапшоты 7 дней, дни 400', fn: t => {
    let {state} = H.appendSample(H.empty(), sample(at(2026,9,1,10,0), 1000), {intervalMinutes:15});
    ({state} = H.appendSample(state, sample(at(2026,11,1,10,0), 900), {intervalMinutes:15}));
    const pruned = H.prune(state, {now: at(2026,11,1,10,1), sampleRetentionDays: 7, dayRetentionDays: 400});
    t.eq(pruned.samples.length, 1);
    t.ok(pruned.days['2026-09-01'] !== undefined, 'старый день сохранён');
}},
{name: 'prune удаляет дни старше 400', fn: t => {
    let {state} = H.appendSample(H.empty(), sample(at(2025,1,1,10,0), 1000), {intervalMinutes:15});
    ({state} = H.appendSample(state, sample(at(2026,11,1,10,0), 900), {intervalMinutes:15}));
    const pruned = H.prune(state, {now: at(2026,11,1,10,1), sampleRetentionDays: 7, dayRetentionDays: 400});
    t.eq(pruned.days['2025-01-01'], undefined);
}},
```

- [ ] **Step 2: Запустить, убедиться в провале**

Run: `gjs -m tests/run.js`
Expected: FAIL `H.rebuild is not a function`.

- [ ] **Step 3: Реализовать**

`rebuild`: копия состояния; обнулить `spend`/`topup`/`samples`/`approx`/`coveredFrom` у дней, попадающих в окно последних `sampleRetentionDays`; пройти пары по всем `samples` и заново применить правило §6.2; затем `prune`. Дни вне окна не трогать.
`prune`: убрать снапшоты с `t < now - sampleRetentionDays*86400`, дни с датой `< localDate(now - dayRetentionDays*86400)`.

- [ ] **Step 4: Тесты зелёные**

Run: `gjs -m tests/run.js`
Expected: `26/26 ok`.

- [ ] **Step 5: Коммит**

```bash
git add tests/history.test.js "src/deepmon@fstronin/spending/History.js"
git commit -m "feat: идемпотентная пересборка дневных агрегатов и retention истории"
```

---

### Task 5: История — сводка для интерфейса

**Files:**
- Modify: `src/deepmon@fstronin/spending/History.js`
- Test: `tests/history.test.js`

**Interfaces:**
- Consumes: `empty`, `appendSample`, `localDate`.
- Produces: `summarize(state, now, {chartDays})` → `Summary` из Shared Contracts.

- [ ] **Step 1: Дописать падающие тесты**

```js
{name: 'summarize: пустая история', fn: t => {
    const s = H.summarize(H.empty(), at(2026,11,1,12,0), {chartDays: 14});
    t.eq(s.today.hasData, false); t.eq(s.today.spend, 0);
    t.eq(s.chart.length, 14); t.eq(s.chart[13].date, '2026-11-01');
    t.eq(s.chart.every(p => p.hasData === false), true);
    t.eq(s.currency, null); t.eq(s.updatedAt, null);
}},
{name: 'summarize: сегодня, 7 и 30 дней', fn: t => {
    let {state} = H.appendSample(H.empty(), sample(at(2026,11,1,10,0), 1000), {intervalMinutes:15});
    ({state} = H.appendSample(state, sample(at(2026,11,1,10,15), 940), {intervalMinutes:15}));
    const s = H.summarize(state, at(2026,11,1,12,0), {chartDays: 14, isAvailable: true});
    t.eq(s.today.spend, 60); t.eq(s.week.spend, 60); t.eq(s.month.spend, 60);
    t.eq(s.isAvailable, true);
    t.eq(s.week.daysWithData, 1); t.eq(s.today.hasData, true);
    t.eq(s.chart[13].spend, 60); t.eq(s.chart[13].approx, false);
}},
{name: 'summarize: approx доходит до графика и today', fn: t => {
    let {state} = H.appendSample(H.empty(), sample(at(2026,11,1,9,0), 1000), {intervalMinutes:15});
    ({state} = H.appendSample(state, sample(at(2026,11,1,9,30), 970), {intervalMinutes:15}));
    const s = H.summarize(state, at(2026,11,1,12,0), {chartDays: 14});
    t.eq(s.today.approx, true); t.eq(s.chart[13].approx, true);
}},
```

- [ ] **Step 2: Запустить, убедиться в провале**

Run: `gjs -m tests/run.js`
Expected: FAIL `H.summarize is not a function`.

- [ ] **Step 3: Реализовать**

`summarize`: `todayDate = localDate(now)`; окна — 1/7/30 дней назад по календарю (вычитать дни через `Date` с локальными компонентами, не секунды); `balances` — из последнего снапшота (иначе `[]`); `isAvailable = Boolean(isAvailable)` из аргумента (история его не хранит); `chart` — `chartDays` дат, последняя `todayDate`, `hasData = days[date] !== undefined`.

- [ ] **Step 4: Тесты зелёные**

Run: `gjs -m tests/run.js`
Expected: `29/29 ok`.

- [ ] **Step 5: Коммит**

```bash
git add tests/history.test.js "src/deepmon@fstronin/spending/History.js"
git commit -m "feat: сводка today/week/month и график дней из истории"
```

---

### Task 6: История — смена валюты и сериализация

**Files:**
- Modify: `src/deepmon@fstronin/spending/History.js`
- Test: `tests/history.test.js`

**Interfaces:**
- Consumes: `empty`, `localDate`.
- Produces: `adoptCurrency(state, currency)`, `serialize(state)`, `deserialize(text)`.

- [ ] **Step 1: Дописать падающие тесты**

```js
{name: 'adoptCurrency: пустая история принимает валюту', fn: t => {
    const r = H.adoptCurrency(H.empty(), 'USD');
    t.eq(r.state.primaryCurrency, 'USD'); t.eq(r.archivedCurrency, null); t.eq(r.notice, null);
}},
{name: 'adoptCurrency: совпадение ничего не меняет', fn: t => {
    const {state} = H.appendSample(H.empty(), sample(at(2026,11,1,10,0), 1000), {intervalMinutes:15});
    const r = H.adoptCurrency(state, 'CNY');
    t.deepEq(r.state, state); t.eq(r.archivedCurrency, null);
}},
{name: 'adoptCurrency: смена архивирует прежнюю', fn: t => {
    const {state} = H.appendSample(H.empty(), sample(at(2026,11,1,10,0), 1000), {intervalMinutes:15});
    const r = H.adoptCurrency(state, 'USD');
    t.eq(r.archivedCurrency, 'CNY'); t.eq(r.state.primaryCurrency, 'USD');
    t.eq(r.state.samples.length, 0); t.eq(r.state.days['2026-11-01'], undefined);
    t.ok(r.notice.includes('CNY'), 'notice содержит прежнюю валюту');
}},
{name: 'сериализация туда-обратно', fn: t => {
    const {state} = H.appendSample(H.empty(), sample(at(2026,11,1,10,0), 1000), {intervalMinutes:15});
    const back = H.deserialize(H.serialize(state));
    t.ok(back.ok, 'ok'); t.deepEq(back.state, state);
}},
{name: 'deserialize: битый JSON и чужая версия', fn: t => {
    t.eq(H.deserialize('{oops').code, 'corrupt');
    t.eq(H.deserialize('{"version":99,"samples":[]}').code, 'corrupt');
}},
```

- [ ] **Step 2: Запустить, убедиться в провале**

Run: `gjs -m tests/run.js`
Expected: FAIL `H.adoptCurrency is not a function`.

- [ ] **Step 3: Реализовать**

`adoptCurrency` — чистая функция без файлов: сравнение `state.primaryCurrency`, при смене вернуть `{state: {...empty(), primaryCurrency: currency}, archivedCurrency: old, notice: S.notice.currencyChanged.replace('{currency}', old)}`, при пустой истории — `{state: {...state, primaryCurrency: currency}, notice: null, archivedCurrency: null}`.
`serialize` — `JSON.stringify(state, null, 2)`; `deserialize` — try/catch + проверка `version === 1` и типов массивов/объектов → `{ok:false, code:'corrupt', detail}`.
Добавить в `strings.js`: `S.notice.currencyChanged = 'валюта изменена: история по {currency} отложена в архив'`.

- [ ] **Step 4: Тесты зелёные**

Run: `gjs -m tests/run.js`
Expected: `34/34 ok`.

- [ ] **Step 5: Коммит**

```bash
git add tests/history.test.js "src/deepmon@fstronin/spending/History.js" "src/deepmon@fstronin/strings.js"
git commit -m "feat: смена валюты учёта и сериализация истории"
```

---

### Task 7: Хранилище истории на диске

**Files:**
- Create: `src/deepmon@fstronin/spending/SpendingStore.js`, `src/deepmon@fstronin/spending/JsonSpendingStore.js`, `tests/store.test.js`

**Interfaces:**
- Consumes: `History.empty`, `History.deserialize`, `History.serialize`.
- Produces: порт (JSDoc) и `new JsonSpendingStore({path})` с методами `load()`, `save(state)`, `archive(currency)`.

- [ ] **Step 1: Написать падающий тест**

`tests/store.test.js` использует `tests/tmp/<random>/history.json`, создаёт и удаляет каталог через `Gio.File`:
```js
import {JsonSpendingStore} from '../src/deepmon@fstronin/spending/JsonSpendingStore.js';
import * as H from '../src/deepmon@fstronin/spending/History.js';

export const tests = [
    {name: 'load: файла нет -> пустая история', fn: t => {
        const s = new JsonSpendingStore({path: freshPath()});
        const r = s.load();
        t.ok(r.ok, 'ok'); t.deepEq(r.state, H.empty());
    }},
    {name: 'save/load: round-trip без *.tmp', fn: t => {
        const path = freshPath();
        const s = new JsonSpendingStore({path});
        const state = H.empty(); state.primaryCurrency = 'CNY';
        t.ok(s.save(state).ok, 'save');
        t.deepEq(s.load().state, state);
        t.eq(listDir(path).filter(n => n.endsWith('.tmp')).length, 0);
    }},
    {name: 'save: каталог создаётся', fn: t => {
        const path = freshPath();
        new JsonSpendingStore({path}).save(H.empty());
        t.ok(Gio.File.new_for_path(path).query_exists(null), 'файл есть');
    }},
    {name: 'load: битый файл -> backup и пустая история', fn: t => {
        const path = freshPath('{oops');
        const r = new JsonSpendingStore({path}).load();
        t.ok(r.ok, 'ok'); t.deepEq(r.state, H.empty()); t.ok(r.warning, 'warning есть');
        t.eq(listDir(path).filter(n => n.includes('.corrupt-')).length, 1);
    }},
    {name: 'save: родитель — файл -> storage', fn: t => {
        const parent = freshPath('not a dir');
        const s = new JsonSpendingStore({path: parent + '/history.json'});
        t.eq(s.save(H.empty()).code, 'storage');
    }},
    {name: 'archive: переименовывает файл', fn: t => {
        const path = freshPath();
        const s = new JsonSpendingStore({path});
        s.save(H.empty());
        const r = s.archive('CNY');
        t.ok(r.ok, 'ok');
        t.eq(listDir(path).filter(n => /^history\.json\.archive-CNY-\d+$/.test(n)).length, 1);
        t.ok(!Gio.File.new_for_path(path).query_exists(null), 'исходный файл исчез');
    }},
];
```

- [ ] **Step 2: Запустить, убедиться в провале**

Run: `gjs -m tests/run.js`
Expected: FAIL по импорту `JsonSpendingStore.js`.

- [ ] **Step 3: Реализовать**

`JsonSpendingStore`: `path`, `load()` — `dirname` → `make_directory_with_parents` (игнорировать `EXISTS`), `load_contents`; нет файла → `{ok:true, state: empty()}`; `deserialize` вернул `corrupt` → rename в `<path>.corrupt-<unix>`, `{ok:true, state: empty(), warning: detail}`; исключение чтения → `{ok:false, code:'storage'}`.
`save()` — `replace_contents(serialize(state), null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null)`; исключение → `{ok:false, code:'storage', detail}`.
`archive(currency)` — `Gio.File.move` в `<path>.archive-<currency>-<Math.floor(Date.now()/1000)>`, `PRESERVE`? нет: `Gio.FileCopyFlags.NONE`.
Порт-файл `SpendingStore.js`: JSDoc-typedef трёх методов, без исполняемых символов.

- [ ] **Step 4: Тесты зелёные**

Run: `gjs -m tests/run.js`
Expected: `40/40 ok`.

- [ ] **Step 5: Коммит**

```bash
git add tests/store.test.js "src/deepmon@fstronin/spending/SpendingStore.js" "src/deepmon@fstronin/spending/JsonSpendingStore.js"
git commit -m "feat: атомарное файловое хранилище истории с архивом и бэкапом повреждений"
```

---

### Task 8: Политика уведомления и его текст

**Files:**
- Create: `src/deepmon@fstronin/alerting/DailyLimit.js`, `tests/dailyLimit.test.js`

**Interfaces:**
- Consumes: `Money.format`, `strings.js`.
- Produces: `evaluate({summary, limitCents, enabled, alerts, date})` → `{fire, spend, limit}`, `alertText({spend, limit, currency})` → `{title, body}`.

- [ ] **Step 1: Написать падающий тест**

```js
import {evaluate, alertText} from '../src/deepmon@fstronin/alerting/DailyLimit.js';

const sum = spend => ({today: {spend}, currency: 'CNY'});

export const tests = [
    {name: 'выключено -> никогда', fn: t => t.eq(evaluate({summary: sum(500), limitCents: 100, enabled: false, alerts: {}, date: '2026-11-01'}).fire, false)},
    {name: 'порог 0 -> никогда', fn: t => t.eq(evaluate({summary: sum(500), limitCents: 0, enabled: true, alerts: {}, date: '2026-11-01'}).fire, false)},
    {name: 'ниже порога -> нет', fn: t => t.eq(evaluate({summary: sum(50), limitCents: 100, enabled: true, alerts: {}, date: '2026-11-01'}).fire, false)},
    {name: 'выше порога -> да', fn: t => t.eq(evaluate({summary: sum(143), limitCents: 100, enabled: true, alerts: {}, date: '2026-11-01'}).fire, true)},
    {name: 'повтор в тот же день -> нет', fn: t => t.eq(evaluate({summary: sum(200), limitCents: 100, enabled: true, alerts: {'2026-11-01': {limit: 100, spend: 143}}, date: '2026-11-01'}).fire, false)},
    {name: 'порог снизили -> да', fn: t => t.eq(evaluate({summary: sum(200), limitCents: 150, enabled: true, alerts: {'2026-11-01': {limit: 100, spend: 143}}, date: '2026-11-01'}).fire, true)},
    {name: 'порог повысили -> нет', fn: t => t.eq(evaluate({summary: sum(200), limitCents: 300, enabled: true, alerts: {'2026-11-01': {limit: 100, spend: 143}}, date: '2026-11-01'}).fire, false)},
    {name: 'новый день -> да', fn: t => t.eq(evaluate({summary: sum(200), limitCents: 100, enabled: true, alerts: {'2026-10-31': {limit: 100, spend: 143}}, date: '2026-11-01'}).fire, true)},
    {name: 'alertText', fn: t => {
        const a = alertText({spend: 143, limit: 100, currency: 'CNY'});
        t.eq(a.title, 'DeepSeek: расходы');
        t.eq(a.body, 'Сегодня ¥1.43 — выше порога ¥1.00');
    }},
];
```

- [ ] **Step 2: Запустить, убедиться в провале**

Run: `gjs -m tests/run.js`
Expected: FAIL по импорту `DailyLimit.js`.

- [ ] **Step 3: Реализовать**

`evaluate` — ровно формула спеки §9; `spend` в результате = `summary.today.spend`, `limit` = `limitCents`. `alertText` подставляет в `S.alert.body` через `.replace('{spend}', format(spend, currency)).replace('{limit}', format(limit, currency))`.

- [ ] **Step 4: Тесты зелёные**

Run: `gjs -m tests/run.js`
Expected: `49/49 ok`.

- [ ] **Step 5: Коммит**

```bash
git add tests/dailyLimit.test.js "src/deepmon@fstronin/alerting/DailyLimit.js"
git commit -m "feat: политика дневного порога и текст уведомления"
```

---

### Task 9: HTTP-адаптер баланса и mock-сервер

**Files:**
- Create: `src/deepmon@fstronin/balance/BalanceSource.js`, `src/deepmon@fstronin/balance/SoupBalanceSource.js`, `tests/mock_server.py`, `tests/net.test.js`, `Makefile` (цель `test-net`)

**Interfaces:**
- Consumes: `parseBalanceResponse`.
- Produces: `new SoupBalanceSource({baseUrl, timeoutSeconds=30})`, метод `request({key, cancellable})` → Promise результата; mock-сервер с путями `<scenario>/user/balance`.

- [ ] **Step 1: Написать mock-сервер и падающий тест**

`tests/mock_server.py`: `http.server` на переданном порту; для пути `/<scenario>/user/balance` отвечает: `ok` → 200 + `tests/fixtures/balance-cny.json`; `multi` → `balance-multi.json`; `unauthorized` → 401; `ratelimit` → 429; `server-error` → 500; `broken` → 200 + `{oops`; `slow` → `sleep(2)` + 200. Логирует строку `listening <port>` в stdout и делает `flush`.

`tests/net.test.js`: стартует сервер через `Gio.Subprocess.new(['python3', 'tests/mock_server.py', String(port)], STDOUT_SILENCE|STDERR_SILENCE)` в `beforeAll` раннера (порт 18087), ждёт готовности запросом к `/ok/user/balance` до 5 с.
```js
import {SoupBalanceSource} from '../src/deepmon@fstronin/balance/SoupBalanceSource.js';

const src = s => new SoupBalanceSource({baseUrl: `http://127.0.0.1:18087/${s}`, timeoutSeconds: 1});

export const tests = [
    {name: 'net: 200 -> снапшот', fn: async t => {
        const r = await src('ok').request({key: 'sk-test'});
        t.ok(r.ok, 'ok'); t.eq(r.snapshot.balances[0].total, 11840);
    }},
    {name: 'net: 401 -> auth', fn: async t => t.eq((await src('unauthorized').request({key:'sk-test'})).code, 'auth')},
    {name: 'net: 429 -> rate-limit', fn: async t => t.eq((await src('ratelimit').request({key:'sk-test'})).code, 'rate-limit')},
    {name: 'net: 500 -> server', fn: async t => t.eq((await src('server-error').request({key:'sk-test'})).code, 'server')},
    {name: 'net: битый JSON -> parse', fn: async t => t.eq((await src('broken').request({key:'sk-test'})).code, 'parse')},
    {name: 'net: таймаут -> network', fn: async t => t.eq((await src('slow').request({key:'sk-test'})).code, 'network')},
    {name: 'net: отмена -> cancelled', fn: async t => {
        const c = new Gio.Cancellable();
        const p = src('slow').request({key: 'sk-test', cancellable: c});
        c.cancel();
        t.eq((await p).code, 'cancelled');
    }},
];
```
Раннер должен поддерживать `async fn` (`await t.fn(t)`), монтировать `Gio`/`GLib` только в тесте.

- [ ] **Step 2: Запустить, убедиться в провале**

Run: `make test-net`
Expected: FAIL по импорту `SoupBalanceSource.js` (сервер поднимается, тестов нет).

- [ ] **Step 3: Реализовать адаптер**

`SoupBalanceSource`: `new Soup.Session({timeout: timeoutSeconds})`; URL `baseUrl + '/user/balance'`; `Soup.Message.new('GET', url)`; заголовки `Authorization: Bearer <key>`, `Accept: application/json`; `send_and_read_async(msg, GLib.PRIORITY_DEFAULT, cancellable, cb)`; в колбэке: `get_status()` → 401/403 `auth`, 429 `rate-limit`, ≥500 `server`, иначе `parseBalanceResponse(new TextDecoder().decode(bytes.get_data()))`; исключение с `Gio.IOErrorEnum.CANCELLED` → `cancelled`, прочее → `network`. Порт-файл `BalanceSource.js` — JSDoc.

`Makefile`: `test-net: ; gjs -m tests/net.test.js`.

- [ ] **Step 4: Тесты зелёные**

Run: `make test-net`
Expected: `7/7 ok`; `make test` по-прежнему `49/49 ok`.

- [ ] **Step 5: Коммит**

```bash
git add tests/mock_server.py tests/net.test.js Makefile "src/deepmon@fstronin/balance/BalanceSource.js" "src/deepmon@fstronin/balance/SoupBalanceSource.js"
git commit -m "feat: асинхронный HTTP-адаптер баланса и mock-сервер для проверки всех ветвей ошибок"
```

---

### Task 10: Чтение ключа и CLI `deepmon-key`

**Files:**
- Create: `src/deepmon@fstronin/storage/KeyringKeyReader.js`, `src/deepmon@fstronin/storage/FileKeyReader.js`, `src/deepmon@fstronin/storage/KeyReader.js`, `bin/deepmon-key`, `man/deepmon-key.1`, `tests/key.test.js`

**Interfaces:**
- Consumes: `strings.js`.
- Produces: `new FileKeyReader({path})`, `new KeyringKeyReader()`, `new KeyReader({keyring, file})` с `readKey()`; `fingerprint(key)`; CLI с кодами возврата 0/2/3.

- [ ] **Step 1: Написать падающий тест**

```js
import {FileKeyReader} from '../src/deepmon@fstronin/storage/FileKeyReader.js';
import {KeyReader, fingerprint} from '../src/deepmon@fstronin/storage/KeyReader.js';

const KEY = 'sk-abcdefghijklmnop1234';

export const tests = [
    {name: 'файл 0600 читается', fn: async t => {
        const p = writeKeyFile(KEY, 0o600);
        const r = await new FileKeyReader({path: p}).readKey();
        t.ok(r.ok, 'ok'); t.eq(r.key, KEY); t.eq(r.source, 'file');
    }},
    {name: 'файл 0644 -> insecure-permissions', fn: async t => {
        const p = writeKeyFile(KEY, 0o644);
        const r = await new FileKeyReader({path: p}).readKey();
        t.eq(r.code, 'insecure-permissions');
    }},
    {name: 'нет файла и пустой файл -> no-key', fn: async t => {
        t.eq((await new FileKeyReader({path: '/nonexistent/key'}).readKey()).code, 'no-key');
        t.eq((await new FileKeyReader({path: writeKeyFile('   \n', 0o600)}).readKey()).code, 'no-key');
    }},
    {name: 'нормализация: пробелы, кавычки, Bearer', fn: async t => {
        const p = writeKeyFile('  "Bearer ' + KEY + '"\n\n', 0o600);
        t.eq((await new FileKeyReader({path: p}).readKey()).key, KEY);
    }},
    {name: 'композиция: keyring важнее файла', fn: async t => {
        const keyring = {readKey: async () => ({ok: true, key: 'sk-keyring0000000000', source: 'keyring'})};
        const file = new FileKeyReader({path: writeKeyFile(KEY, 0o600)});
        const r = await new KeyReader({keyring, file}).readKey();
        t.eq(r.source, 'keyring');
    }},
    {name: 'композиция: keyring пуст -> файл', fn: async t => {
        const keyring = {readKey: async () => ({ok: false, code: 'no-key'})};
        const file = new FileKeyReader({path: writeKeyFile(KEY, 0o600)});
        t.eq((await new KeyReader({keyring, file}).readKey()).source, 'file');
    }},
    {name: 'fingerprint: 8 hex и стабильность', fn: t => {
        const a = fingerprint(KEY);
        t.eq(/^[0-9a-f]{8}$/.test(a), true); t.eq(fingerprint(KEY), a); t.ok(a !== fingerprint(KEY + 'x'), 'разные ключи');
    }},
];
```

- [ ] **Step 2: Запустить, убедиться в провале**

Run: `gjs -m tests/run.js`
Expected: FAIL по импорту `FileKeyReader.js`.

- [ ] **Step 3: Реализовать адаптеры и CLI**

`FileKeyReader.readKey()`: `query_info('unix::mode')`, `mode & 0o077 !== 0` → `insecure-permissions`; `load_contents` → нормализация (trim, снять `Bearer `, снять кавычки, первая непустая строка); пусто → `no-key`; отсутствие файла → `no-key`; прочие ошибки чтения → `no-key`.
`KeyringKeyReader.readKey()`: `Secret.Schema.new('org.freedesktop.Secret.Generic', NONE, {application: STRING, account: STRING})`, `Secret.password_lookup(schema, {application:'deepmon', account:'deepseek-api'}, null, cb)` — асинхронно, без `_sync`; `null`/ошибка → `no-key`.
`KeyReader`: keyring → файл → `{ok:false, code}` (код из последнего адаптера, приоритет `insecure-permissions` над `no-key`).
`fingerprint(key)`: `GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, key, -1).slice(0, 8)`.
`bin/deepmon-key` (gjs, shebang `#!/usr/bin/gjs -m`): `set` (TTY → `stty -echo` промпт, иначе `--stdin`, иначе exit 2), валидация `^sk-[A-Za-z0-9_-]{16,}$` → exit 2, `Secret.password_store_sync(..., Secret.COLLECTION_DEFAULT, 'DeepSeek API key', password, null)` → печать `сохранён <tail4> · sha256 <fp>`, ошибка хранилища → exit 3; `status`, `fingerprint`, `delete`, `--help`. Ключ никогда не печатается и не попадает в argv.
manpage — три-четыре `.TP`-описания команд и кодов возврата.

- [ ] **Step 4: Тесты зелёные, CLI ведёт себя по контракту**

Run: `gjs -m tests/run.js`
Expected: `56/56 ok`.
Run: `printf 'garbage' | ./bin/deepmon-key set --stdin; echo $?`
Expected: сообщение о формате, `2`.
Run: `./bin/deepmon-key set < /dev/null; echo $?`
Expected: `2` (нет TTY и нет `--stdin`).

- [ ] **Step 5: Коммит**

```bash
git add tests/key.test.js "src/deepmon@fstronin/storage" bin/deepmon-key man/deepmon-key.1
git commit -m "feat: безопасное чтение ключа (keyring + файл 0600) и CLI deepmon-key"
```

---

### Task 11: Настройки и схема gsettings

**Files:**
- Create: `src/deepmon@fstronin/config/Config.js`, `src/deepmon@fstronin/schemas/org.gnome.shell.extensions.deepmon.gschema.xml`, `src/deepmon@fstronin/metadata.json`, `tests/config.test.js`, `Makefile` (цель `schemas`)

**Interfaces:**
- Consumes: `Money.parseAmount`.
- Produces: `new Config(settings)` с геттерами `refreshMinutes`, `dailyLimitCents`, `alertsEnabled`, `panelMode`, `chartDays`, `apiBaseUrl`, `currency`, `keyFilePath` и `connect(cb)`/`destroy()`; `metadata.json`.

- [ ] **Step 1: Написать падающий тест**

`tests/config.test.js` компилирует схему во временный каталог и строит `Gio.Settings` из него:
```js
import {Config} from '../src/deepmon@fstronin/config/Config.js';

export const tests = [
    {name: 'значения по умолчанию', fn: t => {
        const c = new Config(schemaSettings());
        t.eq(c.refreshMinutes, 15); t.eq(c.dailyLimitCents, 100); t.eq(c.alertsEnabled, true);
        t.eq(c.panelMode, 'both'); t.eq(c.chartDays, 14);
        t.eq(c.apiBaseUrl, 'https://api.deepseek.com'); t.eq(c.currency, '');
        t.eq(c.keyFilePath, defaultKeyPath());
    }},
    {name: 'dailyLimitCents округляет', fn: t => {
        const s = schemaSettings(); s.set_double('daily-limit', 0.015);
        t.eq(new Config(s).dailyLimitCents, 2);
    }},
    {name: 'panel-mode принимает только enum', fn: t => {
        const s = schemaSettings();
        t.eq(s.set_string('panel-mode', 'nonsense'), false);
        t.eq(new Config(s).panelMode, 'both');
    }},
    {name: 'connect/destroy не текут', fn: t => {
        const c = new Config(schemaSettings());
        let calls = 0; const id = c.connect(() => calls++);
        t.ok(typeof id === 'number', 'id'); c.destroy();
    }},
];
```

- [ ] **Step 2: Запустить, убедиться в провале**

Run: `gjs -m tests/run.js`
Expected: FAIL по импорту `Config.js` (схема ещё не существует).

- [ ] **Step 3: Реализовать**

`gschema.xml` — ровно ключи из спеки §11 (`refresh-minutes` `u` 1..120 = 15, `daily-limit` `d` 0..10000 = 1.0, `daily-limit-enabled` `b` true, `currency` `s` '' , `panel-mode` `s` enum `['both','balance','spend']` = 'both', `chart-days` `u` 7..90 = 14, `api-base-url` `s` 'https://api.deepseek.com', `key-file` `s` '').
`Config`: путь к ключу по умолчанию — `${XDG_CONFIG_HOME:-$HOME/.config}/deepmon/key`; `connect(cb)` подписывается на `changed` и на `changed::<key>` только для читаемых ключей, возвращает id для `disconnect` через `destroy()`.
`metadata.json` — см. Global Constraints (`version: 1`).
`make schemas` — `glib-compile-schemas src/deepmon@fstronin/schemas`.

- [ ] **Step 4: Тесты зелёные**

Run: `make schemas && gjs -m tests/run.js`
Expected: `60/60 ok`.

- [ ] **Step 5: Коммит**

```bash
git add "src/deepmon@fstronin/config/Config.js" "src/deepmon@fstronin/schemas" "src/deepmon@fstronin/metadata.json" tests/config.test.js Makefile
git commit -m "feat: схема gsettings и типизированный доступ к настройкам"
```

---

### Task 12: View-модель панели и геометрия графика

**Files:**
- Create: `src/deepmon@fstronin/panel/format.js`, `tests/format.test.js`

**Interfaces:**
- Consumes: `Money.*`, `strings.js`.
- Produces: `buildViewModel({summary, notice, error, panelMode})`, `panelLabel(view)`, `barHeights(points, opts)`.

- [ ] **Step 1: Написать падающий тест**

```js
import {buildViewModel, panelLabel, barHeights} from '../src/deepmon@fstronin/panel/format.js';

const summary = over => ({
    currency: 'CNY', isAvailable: true, updatedAt: 1767225000,
    balances: [{currency:'CNY', total:11840, granted:0, toppedUp:11840}],
    today: {spend: over, approx: false, coveredFrom: null, hasData: true},
    week: {spend: 410, daysWithData: 5}, month: {spend: 1785, daysWithData: 12},
    chart: Array.from({length: 14}, (_, i) => ({date: `2026-10-${19+i}`, spend: i === 13 ? over : 0, approx: false, hasData: true})),
});

export const tests = [
    {name: 'label: баланс и трата', fn: t => t.eq(panelLabel(buildViewModel({summary: summary(62), panelMode: 'both'})).text, '¥118.40 ↓0.62')},
    {name: 'label: трата 0 -> только баланс', fn: t => t.eq(panelLabel(buildViewModel({summary: summary(0), panelMode: 'both'})).text, '¥118.40')},
    {name: 'label: превышение -> глиф и класс', fn: t => {
        const l = panelLabel(buildViewModel({summary: summary(143), panelMode: 'both', limitCents: 100}));
        t.eq(l.text, '¥118.40 ↓1.43 ⚠'); t.eq(l.styleClass, 'deepmon-over-limit');
    }},
    {name: 'label: режим spend', fn: t => t.eq(panelLabel(buildViewModel({summary: summary(62), panelMode: 'spend'})).text, '↓0.62')},
    {name: 'label: режим balance', fn: t => t.eq(panelLabel(buildViewModel({summary: summary(62), panelMode: 'balance'})).text, '¥118.40')},
    {name: 'label: ошибка без данных -> заглушка', fn: t => {
        const l = panelLabel(buildViewModel({summary: null, error: {code: 'no-key'}, panelMode: 'both'}));
        t.eq(l.text, 'DeepSeek ⚠'); t.eq(l.styleClass, 'deepmon-stale');
    }},
    {name: 'label: ошибка с данными -> цифры и stale', fn: t => {
        const l = panelLabel(buildViewModel({summary: summary(62), error: {code: 'network'}, panelMode: 'both'}));
        t.eq(l.text, '¥118.40 ↓0.62'); t.eq(l.styleClass, 'deepmon-stale');
    }},
    {name: 'statusText: баланс исчерпан', fn: t => {
        const v = buildViewModel({summary: {...summary(0), isAvailable: false}, panelMode: 'both'});
        t.ok(v.statusText.includes('исчерпан'), v.statusText);
    }},
    {name: 'barHeights: пропорция, минимум и пустой день', fn: t => {
        const pts = [{spend: 100, hasData: true}, {spend: 50, hasData: true}, {spend: 1, hasData: true}, {spend: 0, hasData: false}];
        t.deepEq(barHeights(pts), [44, 22, 3, 2]);
    }},
    {name: 'barHeights: все нули не делит на ноль', fn: t => t.deepEq(barHeights([{spend:0,hasData:true}]), [2])},
];
```

- [ ] **Step 2: Запустить, убедиться в провале**

Run: `gjs -m tests/run.js`
Expected: FAIL по импорту `panel/format.js`.

- [ ] **Step 3: Реализовать**

`buildViewModel` — собрать `{currencyText, balanceText, spendText, overLimit, stale, blocking, dataAvailable, periods:{today, week, month}, chart, errorText, noticeText, mode}`; `overLimit` вычисляется по `limitCents` из аргумента (передаётся в `buildViewModel`); `stale = Boolean(error) && dataAvailable`; `blocking = Boolean(error) && !dataAvailable`.
`panelLabel` — по таблице спеки §12.1: `both` → `format(total) + (spend ? ' ↓' + formatAmount(spend) : '') + (overLimit ? ' ⚠' : '')`; `spend` → `↓` + сумма (или `'0.00'`); `balance` → только сумма; при `blocking` — `S.panel.blocked`; класс `deepmon-over-limit` при `overLimit`, иначе `deepmon-stale` при `stale || blocking`, иначе `null`.
`barHeights` — `max = Math.max(...spend)`; `spend === 0 || !hasData` → `emptyHeight`; иначе `Math.max(minVisible, Math.round(spend / max * maxHeight))`.

- [ ] **Step 4: Тесты зелёные**

Run: `gjs -m tests/run.js`
Expected: `70/70 ok`.

- [ ] **Step 5: Коммит**

```bash
git add "src/deepmon@fstronin/panel/format.js" tests/format.test.js
git commit -m "feat: view-модель панели и высоты столбцов графика"
```

---

### Task 13: Индикатор, popup, график и headless-проверка UI

**Files:**
- Create: `src/deepmon@fstronin/panel/Indicator.js`, `src/deepmon@fstronin/panel/DayChart.js`, `src/deepmon@fstronin/stylesheet.css`, `src/deepmon@fstronin/extension.js` (минимальная сборка), `tests/headless.sh`, `tests/probe/probe@test/metadata.json`, `tests/probe/probe@test/extension.js`, `Makefile` (цель `verify-ui`)

**Interfaces:**
- Consumes: `panelLabel`, `buildViewModel`, `barHeights`, `strings.js`.
- Produces: `new Indicator({onRefresh, onOpenPrefs, onOpenPlatform})`, `indicator.setState(view)`, `indicator.destroy()`; `new DayChart()` с `setData(view.chart)` и `actor`; `extension.js` с `default class extends Extension { enable(), disable() }`, который создаёт индикатор со статической view-моделью.

- [ ] **Step 1: Написать probe-расширение и скрипт проверки (падающая проверка)**

`tests/probe/probe@test/extension.js` (создаётся скриптом в изолированном `XDG_DATA_HOME`): в `enable()` — `Main.extensionManager.enableExtension('deepmon@fstronin')`, дождаться `Main.panel.statusArea['deepmon@fstronin']`, собрать отчёт и записать в `$REPORT`:
```js
{indicatorFound, labelText, labelClass, menuItems, barCount, barHeights,
 uiGroupChildrenBefore, uiGroupChildrenAfterDisable}
```
`menuItems` — `statusArea[uuid].menu._getMenuItems().map(i => i.label?.text ?? i.text?._text ?? '')`. Далее `disableExtension`, отчёт пишется после каждого шага.
`tests/headless.sh`: временный корень, `rsync` расширения, `glib-compile-schemas`, `GSETTINGS_BACKEND=keyfile` с `enabled-extensions=['probe@test']`, `dbus-run-session -- gnome-shell --wayland --headless`, ожидание файла отчёта ≤60 с, печать JSON, exit 1 если `indicatorFound !== true`, `labelText` не `¥118.40 ↓0.62`, `menuItems.length !== 4`, `barCount !== 14`, `uiGroupChildrenAfterDisable !== uiGroupChildrenBefore` (утечка).

- [ ] **Step 2: Запустить, убедиться в провале**

Run: `make verify-ui`
Expected: отчёт без индикатора (`indicatorFound: false`), exit 1.

- [ ] **Step 3: Реализовать индикатор, график и стили**

`Indicator`: `PanelMenu.Button(0.0, 'DeepSeek Usage', false)`; `St.Label` с `y_align: CENTER`, `clip_to_allocation: true`, класс `deepmon-panel-label`; popup — `PopupMenu.PopupBaseMenuItem({reactive:false, can_focus:false})` с вертикальным `St.BoxLayout` (заголовок `S.popup.title`, крупный баланс, строка статуса, периоды, `DayChart`, подписи дат, при необходимости строки ошибки/notice), затем `PopupMenu.PopupSeparatorMenuItem`, пункты «Обновить сейчас» (disabled по внутреннему флагу `_refreshing`, который `Indicator` ставит на время `onRefresh()`), «Порог: {limit}/день» (→ `onOpenPrefs`), `S.popup.open` (→ `onOpenPlatform`), `S.popup.settings` (→ `onOpenPrefs`); меню перестраивается в `setState` только если оно открыто (`menu.isOpen`), иначе при `open-state-changed` → `onRefresh()`.
`setState(view)` — `panelLabel(view)` → `this._label.text` и `style_class_name`; `_applyChart(view)`.
`DayChart`: `St.BoxLayout({vertical:false, style_class:'deepmon-chart'})` высотой 48, по `St.Widget` на точку с `y_align: END`, `x_expand: true`, `set_style('height: Npx')` из `barHeights`, классы `deepmon-bar` / `deepmon-bar-empty` / `deepmon-bar-approx`; подписи `dd.mm` первой и последней точки в `St.BoxLayout` под графиком.
`stylesheet.css`: классы `deepmon-panel-label`, `deepmon-over-limit` (`color: var(--warning-…)`; используем `color: #f5c211` через `@define-color`? нет — только существующие цвета темы: `st-text`/`system-warning-*`), `deepmon-stale` (`opacity: 0.55`), `deepmon-chart`, `deepmon-bar` (`background-color: -st-accent-color`), `deepmon-bar-empty` (`opacity: 0.35`), `deepmon-bar-approx` (`opacity: 0.6`), `deepmon-balance`, `deepmon-caption`, `deepmon-error`.
`extension.js` (временный): создаёт `Indicator` и `Main.panel.addToStatusArea('deepmon@fstronin', indicator)`, наполняет статической view-моделью с `¥118.40 ↓0.62`, `chart` из 14 точек; `disable()` уничтожает индикатор. Настройки/сеть подключаются в Task 15.

- [ ] **Step 4: Проверка зелёная**

Run: `make verify-ui`
Expected: JSON с `indicatorFound: true`, `labelText: "¥118.40 ↓0.62"`, `menuItems.length: 4`, `barCount: 14`, `uiGroupChildrenAfterDisable === Before`; exit 0; в логах шелла нет `Gjs-CRITICAL`.

- [ ] **Step 5: Коммит**

```bash
git add "src/deepmon@fstronin/panel" "src/deepmon@fstronin/stylesheet.css" "src/deepmon@fstronin/extension.js" tests/headless.sh tests/probe Makefile
git commit -m "feat: индикатор в панели, popup с графиком и headless-проверка UI"
```

---

### Task 14: Use case опроса

**Files:**
- Create: `src/deepmon@fstronin/spending/RefreshSpending.js`, `tests/refresh.test.js`

**Interfaces:**
- Consumes: `selectBalance`, `History`, `KeyReader`/`fingerprint`, порты `source`/`store`.
- Produces: `new RefreshSpending({source, store, keyReader, config, now})`, `run()` → `{summary|null, notice|null, state|null, error|null}`; `run()` защищён от параллельного вызова (`{summary:null, skipped:'in-flight'}`).

- [ ] **Step 1: Написать падающий тест**

```js
import {RefreshSpending} from '../src/deepmon@fstronin/spending/RefreshSpending.js';
import * as H from '../src/deepmon@fstronin/spending/History.js';

const t0 = new Date(2026, 10, 1, 12, 0).getTime() / 1000;
const snap = (total, currency = 'CNY') => ({isAvailable: true, balances: [{currency, total, granted: 0, toppedUp: total}]});

export const tests = [
    {name: 'успех: снапшот в историю, файл сохранён, сводка есть', fn: async t => {
        const store = fakeStore(H.empty());
        const r = await make({source: okSource(snap(11840)), store}).run();
        t.ok(r.error === null, 'без ошибки'); t.eq(r.summary.today.hasData, true);
        t.eq(store.saved.length, 1); t.eq(store.saved[0].samples.length, 1);
    }},
    {name: 'сеть упала: история и сохранение не тронуты', fn: async t => {
        const store = fakeStore(H.empty());
        const r = await make({source: failSource('network'), store}).run();
        t.eq(r.error.code, 'network'); t.eq(store.saved.length, 0); t.eq(r.state, null);
    }},
    {name: 'auth: повтор с тем же ключом пропускается', fn: async t => {
        let calls = 0;
        const source = {request: async () => { calls++; return {ok: false, code: 'auth'}; }};
        const uc = make({source, store: fakeStore(H.empty())});
        await uc.run(); const second = await uc.run();
        t.eq(calls, 1); t.eq(second.skipped, 'auth-unchanged');
    }},
    {name: 'ключ сменился: после auth запрос повторяется', fn: async t => {
        let calls = 0; let key = 'sk-aaaaaaaaaaaaaaaaaa';
        const source = {request: async () => { calls++; return {ok: false, code: 'auth'}; }};
        const keyReader = {readKey: async () => ({ok: true, key, source: 'file'})};
        const uc = make({source, keyReader, store: fakeStore(H.empty())});
        await uc.run(); key = 'sk-bbbbbbbbbbbbbbbbbb'; await uc.run();
        t.eq(calls, 2);
    }},
    {name: 'нет ключа: запроса нет', fn: async t => {
        let calls = 0;
        const source = {request: async () => { calls++; return {ok: true, snapshot: snap(1)}; }};
        const keyReader = {readKey: async () => ({ok: false, code: 'no-key'})};
        const r = await make({source, keyReader, store: fakeStore(H.empty())}).run();
        t.eq(calls, 0); t.eq(r.error.code, 'no-key');
    }},
    {name: 'валюта недоступна -> ошибка без изменения истории', fn: async t => {
        const store = fakeStore(H.empty());
        const r = await make({source: okSource(snap(100)), store, currency: 'USD'}).run();
        t.eq(r.error.code, 'currency-unavailable'); t.eq(store.saved.length, 0);
    }},
    {name: 'смена валюты архивирует и начинает заново', fn: async t => {
        let {state} = H.appendSample(H.empty(), {t: t0 - 3600, currency: 'CNY', total: 1000, granted: 0, toppedUp: 1000}, {intervalMinutes: 15});
        const store = fakeStore(state);
        const r = await make({source: okSource(snap(200, 'USD')), store, currency: 'USD'}).run();
        t.deepEq(store.archived, ['CNY']); t.eq(r.state.primaryCurrency, 'USD');
        t.eq(r.state.samples.length, 1); t.ok(r.notice, 'notice есть');
    }},
];
```

Хелперы в том же файле: `fakeStore(state)` → `{load: () => ({ok:true, state}), save: s => (saved.push(s), {ok:true}), archive: c => (archived.push(c), {ok:true}), saved: [], archived: []}`; `okSource(snapshot)`/`failSource(code)` → `{request: async () => ({ok:true, snapshot})}` / `{ok:false, code}`; `make({source, store, keyReader, currency})` собирает `new RefreshSpending({source, store, keyReader: keyReader ?? okKeyReader(), config: {currency: currency ?? '', chartDays: 14}, now: () => t0})`, где `okKeyReader()` возвращает `{ok:true, key:'sk-aaaaaaaaaaaaaaaaaa', source:'file'}`.

- [ ] **Step 2: Запустить, убедиться в провале**

Run: `gjs -m tests/run.js`
Expected: FAIL по импорту `RefreshSpending.js`.

- [ ] **Step 3: Реализовать**

`run()`: флаг `_inFlight` (на входе и в `finally`); `keyReader.readKey()` → ошибка без сети; `fingerprint(key)` + сравнение с `_authFingerprint` (при совпадении и прошлом коде `auth` → `{skipped:'auth-unchanged'}`); `store.load()` → `load` вернул `storage` → `{error}`; `source.request({key, cancellable})`; при ошибке — `{error}` и (для `auth`) запомнить отпечаток; `selectBalance(snapshot.balances, config.currency)`; `History.adoptCurrency` → при `archivedCurrency` вызвать `store.archive`; `appendSample` с `{t: now(), ...selected, isAvailable: snapshot.isAvailable}`; `rebuild` + `store.save`; `summarize(state, now(), {chartDays: config.chartDays, isAvailable: snapshot.isAvailable})`; вернуть `{summary, notice, state, error:null}`.
`skipped` — `'in-flight'` (параллельный вызов) или `'auth-unchanged'` (ключ тот же после 401/403).
Ошибки `store.save` → `{error: {code:'storage'}, summary}` (данные показываем).

- [ ] **Step 4: Тесты зелёные**

Run: `gjs -m tests/run.js`
Expected: `77/77 ok`.

- [ ] **Step 5: Коммит**

```bash
git add tests/refresh.test.js "src/deepmon@fstronin/spending/RefreshSpending.js"
git commit -m "feat: use case опроса баланса с защитой от повторов и сменой валюты"
```

---

### Task 15: Сборка расширения и prefs

**Files:**
- Modify: `src/deepmon@fstronin/extension.js` (полная сборка), `tests/headless.sh`, `tests/probe/probe@test/extension.js`
- Create: `src/deepmon@fstronin/prefs.js`, `src/deepmon@fstronin/alerting/Notifier.js`, `src/deepmon@fstronin/alerting/ShellNotifier.js`

**Interfaces:**
- Consumes: всё предыдущее.
- Produces: рабочее расширение (таймер, настройки, алерты, меню); prefs-окно; `ShellNotifier.notify({title, body})`.

- [ ] **Step 1: Расширить headless-проверку до end-to-end**

`tests/headless.sh`: поднять `tests/mock_server.py`, записать во временный `XDG_CONFIG_HOME` файл ключа `0600` с `sk-test…`, выставить схему `api-base-url = http://127.0.0.1:18087/ok`, `key-file = <путь>`, `refresh-minutes = 1`; probe после enable ждёт `labelText` содержащим `¥118.40` до 10 с, затем проверяет: `labelText === '¥118.40'` (трата 0 на первом снапшоте), `tests/tmp/state/deepmon/history.json` существует и содержит `"primaryCurrency": "CNY"`, `menuItems.length === 4`. Скрипт падает, если условие не выполнено.

- [ ] **Step 2: Запустить, убедиться в провале**

Run: `make verify-ui`
Expected: отчёт со статической меткой (нет обращения к сети), exit 1 по отсутствию `history.json`.

- [ ] **Step 3: Реализовать сборку**

`extension.js`: `async enable()` — `this._settings = this.getSettings()`, `new Config(...)`, `new KeyReader({keyring: new KeyringKeyReader(), file: new FileKeyReader({path: config.keyFilePath})})`, `new JsonSpendingStore({path: stateHistoryPath()})`, `new SoupBalanceSource({baseUrl: config.apiBaseUrl})`, `new RefreshSpending(...)`, `new ShellNotifier()`, `Indicator`, `Main.panel.addToStatusArea`; немедленный `_refresh()` (не блокирует `enable`, ошибки внутри ловятся), `GLib.timeout_add_seconds(config.refreshMinutes * 60, ...)`, `config.connect(() => this._onSettings())`; `_refresh()` — `run()`, обновление индикатора, при `fire` — `state.alerts[date] = {limit, spend}` + `store.save(state)` + `notifier.notify(alertText(...))`; `_onSettings()` — перезапуск таймера при смене интервала, перерисовка без сети при прочих; `disable()` — снять таймер, `config.destroy()`, `this._cancellable?.cancel()`, `indicator.destroy()`, обнулить поля.
Меню: `onRefresh` → `_refresh(true)` (форс, если прошло >60 с), `onOpenPrefs` → `this.openPreferences()`, `onOpenPlatform` → `Gio.AppInfo.launch_default_for_uri('https://platform.deepseek.com', null)`.
`ShellNotifier.notify({title, body})` → `Main.notify(title, body)`; порт `Notifier.js` — JSDoc.
`prefs.js`: `Adw.PreferencesPage` с группами из спеки §12.4; ключ — `Adw.PasswordEntryDialog` (Adw 1.x) → `Secret.password_store_sync`, затем строка статуса показывает `sk-…abcd · sha256 …`; удаление — `Secret.password_clear_sync` по схеме/атрибутам; строки создаются в `fillPreferencesWindow` (никаких модульных `_()`).

- [ ] **Step 4: Проверка зелёная**

Run: `make verify-ui`
Expected: exit 0, `labelText: "¥118.40"`, `history.json` с `primaryCurrency: CNY`, `menuItems.length: 4`.
Run: `make test && make test-net`
Expected: `77/77 ok`, `7/7 ok`.

- [ ] **Step 5: Коммит**

```bash
git add "src/deepmon@fstronin/extension.js" "src/deepmon@fstronin/prefs.js" "src/deepmon@fstronin/alerting/Notifier.js" "src/deepmon@fstronin/alerting/ShellNotifier.js" tests/headless.sh tests/probe
git commit -m "feat: сборка расширения — таймер, настройки, уведомления и prefs-окно"
```

---

### Task 16: deb-пакет, README и dev-цели

**Files:**
- Create: `debian/control`, `debian/changelog`, `debian/copyright`, `debian/rules`, `debian/install`, `debian/source/format`, `debian/gnome-shell-extension-deepmon.gschema.override`, `README.md`
- Modify: `Makefile`

**Interfaces:**
- Consumes: дерево `src/`, `bin/`, `man/`.
- Produces: `gnome-shell-extension-deepmon_1.0.0-1_all.deb`; цели `dev-install`, `dev-remove`, `deb`, `verify-deb`.

- [ ] **Step 1: Написать упаковку и падающую проверку**

`debian/control` (Source `gnome-shell-extension-deepmon`, Build-Depends `debhelper-compat (= 13), libglib2.0-bin`, Package §14 спеки: Depends `gnome-shell (>= 50), gjs, gir1.2-secret-1`, Recommends `gnome-keyring`, Section `gnome`, Architecture `all`, Description 2–3 строки), `debian/rules` (`%: dh $@`), `debian/install`:
```
src/deepmon@fstronin usr/share/gnome-shell/extensions/
bin/deepmon-key usr/bin/
man/deepmon-key.1 usr/share/man/man1/
src/deepmon@fstronin/schemas/org.gnome.shell.extensions.deepmon.gschema.xml usr/share/glib-2.0/schemas/
```
`debian/gnome-shell-extension-deepmon.gschema.override` → `[org.gnome.Shell]` + `enabled-extensions=['deepmon@fstronin']`; `debian/source/format` `3.0 (native)`; `debian/changelog` одна запись `1.0.0-1`; `debian/copyright` MIT.
`Makefile`: `dev-install` (rsync `src/deepmon@fstronin/` → `~/.local/share/gnome-shell/extensions/deepmon@fstronin/`, затем `glib-compile-schemas` в цели), `dev-remove`, `deb` (`dpkg-buildpackage -us -uc -b`), `verify-deb` (распаковать `dpkg-deb -x` во временный корень и проверить наличие 4 групп файлов и `gschemas.compiled`).

- [ ] **Step 2: Запустить, убедиться в провале**

Run: `make deb`
Expected: ошибка сборки — `debian/` нет (до создания файлов) либо отсутствует `debhelper` (`sudo apt install debhelper` — предварительное условие, зафиксировать в README).

- [ ] **Step 3: Дописать README и цели**

README: что делает, установка (`sudo apt install ./…deb`, релогин), `deepmon-key set`, откуда берётся баланс и почему расход = дельта баланса, точность = интервал, пути данных, архив при смене валюты, порог и как проверить уведомление (`0.01`), dev-цикл (`make dev-install` / `dev-remove`), требование `debhelper` и `libglib2.0-bin` для сборки.

- [ ] **Step 4: Сборка и проверка содержимого**

Run: `make deb && make verify-deb`
Expected: пакет в `..`, `verify-deb` печатает 4 пути и `gschemas.compiled: ok`, exit 0.
Run: `dpkg-deb -c ../gnome-shell-extension-deepmon_1.0.0-1_all.deb | grep -E 'deepmon-key|gschema|extensions/deepmon'`
Expected: строки для всех четырёх групп.

- [ ] **Step 5: Коммит**

```bash
git add debian README.md Makefile
git commit -m "build: deb-пакет расширения, README и dev-цели установки"
```

---

## Post-plan manual verification (вне задач, требует живой сессии)

- `make dev-remove`, `sudo apt install ./gnome-shell-extension-deepmon_1.0.0-1_all.deb`, выход и вход.
- `deepmon-key set`, проверить `deepmon-key status`.
- Панель показывает реальный баланс; popup — периоды и график; «Обновить сейчас» обновляет.
- `gsettings set org.gnome.shell.extensions.deepmon daily-limit 0.01`, дождаться тика: одно уведомление, повторного нет; `daily-limit 5` — уведомление снова допустимо только при новой трате.
- Смена `currency` на другую доступную валюту: старый файл уходит в `history.json.archive-…`, popup показывает notice.
