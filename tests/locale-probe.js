// Печатает две локализованные строки; язык берётся из окружения (LANGUAGE).
import {S, days} from '../src/deepmon@fstronin/strings.js';

print(S.popup.settings);
print(`${3} ${days(3)}`);
