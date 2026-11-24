Firebase JS SDK (веб) — локальная копия для этого сайта
========================================================

Зачем: SDK грузится с нашего домена, чтобы страница не зависала, если
cdn-домен Google (www.gstatic.com) в России недоступен или медленный.
В assets/social.js сначала пробуем эти файлы, при ошибке — официальный
адрес https://www.gstatic.com/firebasejs/11.0.2/.

Версия: 11.0.2
Источник: https://www.gstatic.com/firebasejs/11.0.2/ (глобальный CDN Firebase)
Файлы: firebase-app.js, firebase-auth.js, firebase-firestore.js
        (firebase-auth.js и firebase-firestore.js — с заменой импорта
        firebase-app.js на локальный ./firebase-app.js, больше ничего не менялось)

Лицензия: Apache License 2.0 — https://github.com/firebase/firebase-js-sdk/blob/master/LICENSE
Firebase JS SDK — открытый проект, локальная раздача этих файлов разрешена
условиями лицензии; уведомление об авторских правах сохраняем здесь.

Обновление: скачать файлы той же версии с gstatic, заменить путь импорта
в auth/firestore на ./firebase-app.js и проверить, что в assets/social.js
SDK_FALLBACK указывает на ту же версию.
