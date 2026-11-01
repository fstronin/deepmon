// Слияние результата опроса с уже показанным состоянием: ошибка не должна стирать
// последние успешные данные (спека §13), а notice живёт до следующего успеха.
export function mergeRefresh(previous, result) {
    const summary = result.summary ?? previous.summary ?? null;
    const notice = result.summary
        ? (result.notice ?? result.warning ?? null)
        : (result.warning ?? previous.notice ?? null);
    return {summary, notice, error: result.error ?? null};
}
