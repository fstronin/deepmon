/**
 * Порт хранилища истории. Реализация — JsonSpendingStore.
 *
 * @typedef {object} SpendingStore
 * @property {() => {ok: true, state: object, warning?: string} | {ok: false, code: 'storage', detail: string}} load
 *   Читает состояние; отсутствие файла — не ошибка (пустая история).
 * @property {(state: object) => {ok: true} | {ok: false, code: 'storage', detail: string}} save
 *   Атомарно записывает состояние.
 * @property {(currency: string) => {ok: true, path: string} | {ok: false, code: 'storage', detail: string}} archive
 *   Переименовывает текущий файл в архив для прежней валюты.
 */

export {};
