/**
 * Порт источника баланса. Реализация — SoupBalanceSource.
 *
 * @typedef {object} BalanceSource
 * @property {(args: {key: string, cancellable?: object|null}) => Promise<
 *   {ok: true, snapshot: {isAvailable: boolean, balances: Array<object>}} |
 *   {ok: false, code: string, detail?: string}>} request
 *   Запрашивает баланс. Никогда не бросает: любая ошибка — значение с кодом.
 */

export {};
