// Все строки интерфейса в одном месте. Значения-шаблоны подставляются через
// replace('{name}', value) в вызывающем коде; на уровне модуля вызовов нет.
export const S = {
    panel: {
        arrow: '↓',
        overLimit: '⚠',
        blocked: 'DeepSeek ⚠',
    },
    popup: {
        title: 'DeepSeek API',
        updated: 'обновлено {time}',
        offline: 'нет связи с {time}',
        refresh: 'Обновить сейчас',
        limit: 'Порог: {limit}/день',
        open: 'platform.deepseek.com',
        settings: 'Настройки',
        today: 'Сегодня',
        week: '7 дней',
        month: '30 дней',
        unavailable: 'баланс исчерпан или недоступен',
        granted: 'грант {amount}',
        toppedUp: 'пополнено {amount}',
        daysSuffix: ' · {days} дн.',
        periodDays: 'данных: {days} из 30',
        approxPrefix: '≈',
    },
    alert: {
        title: 'DeepSeek: расходы',
        body: 'Сегодня {spend} — выше порога {limit}',
    },
    notice: {
        currencyChanged: 'валюта изменена: история по {currency} отложена в архив',
    },
    errors: {
        'no-key': 'ключ не задан: deepmon-key set',
        'insecure-permissions': 'права файла ключа шире 0600: chmod 600 {path}',
        'keyring-locked': 'связка ключей заблокирована: откройте «Пароли и ключи»',
        'auth': 'ключ отклонён ({status})',
        'rate-limit': 'лимит запросов, повтор позже',
        'network': 'нет связи с {time}',
        'server': 'ошибка сервера ({status})',
        'parse': 'неожиданный ответ API',
        'currency-unavailable': 'валюта {currency} не входит в ответ (есть: {available})',
        'storage': 'не удалось сохранить историю: {path}',
        'cancelled': 'запрос отменён',
    },
};
