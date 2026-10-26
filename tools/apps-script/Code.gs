/**
 * Меню «Каталог» для Google Таблицы каталога номеров СоцГума.
 *
 * Что умеет:
 *   Создать структуру      – листы, заголовки, выпадающие списки, форматы (по желанию с демо-данными)
 *   Проверить таблицу      – ищет ошибки до публикации, красит ячейки с ошибками
 *   Собрать список людей   – добавляет на лист «Люди» всех, кто упомянут в номерах
 *   Обновить сайт сейчас   – запускает сборку сайта на GitHub
 *   Открыть сайт
 *   Ввести GitHub-токен    – один раз, для кнопки «Обновить сайт»
 *
 * Установка: в таблице Расширения → Apps Script → вставить этот код вместо имеющегося → Сохранить →
 * обновить страницу таблицы. Появится меню «Каталог».
 */

var SITE_URL = 'https://maratizna.github.io/socgum-catalog/';
var REPO = 'maratizna/socgum-catalog';
var WORKFLOW_FILE = 'build.yml';
var BRANCH = 'main';
var RED = '#f8c9c9';

var ORANGE = '#ff8b36';

var SHEETS = {
  concerts: 'Концерты',
  dirs: 'Направления',
  nums: 'Номера',
  cues: 'Таймкоды',
  people: 'Люди'
};

var HOW_TO = [
  'Как заполнять таблицу',
  '',
  'Эта таблица — единственное место, где редактируется каталог. Сайт собирается из неё автоматически.',
  '',
  '1. Лист «Концерты»: по строке на концерт. «Видео» — ссылка на запись концерта целиком в VK.',
  '2. Лист «Направления»: список направлений (хореография, вокал и так далее).',
  '3. Лист «Номера»: по строке на номер. «Концерт» и «Направление» выбираются из списка.',
  '   «Исполнители» и «Постановщики» — имена через запятую. Пишите имя везде одинаково.',
  '4. Лист «Таймкоды»: метки внутри номера. Время — по записи концерта целиком, как на плеере.',
  '5. Лист «Люди» необязательный: описание и ссылка для человека. Меню Каталог → Собрать список людей заполнит имена сам.',
  '',
  'Время вводите так: ч:мм:сс, например 0:20:52. Эти столбцы хранят простой текст, формат не меняйте.',
  'ID номера — латинские буквы, цифры и дефис, он станет частью адреса страницы. После публикации ID лучше не менять.',
  '',
  'Перед публикацией выберите Каталог → Проверить таблицу. Ячейки с ошибками покрасятся красным.',
  'Если в таблице ошибка, сайт не обновится, а прежняя версия останется на месте.'
];

var DEF = [
  { name: SHEETS.concerts, head: ['Название', 'Дата', 'Видео', 'Описание'], widths: [260, 110, 380, 380], text: [2, 3] },
  { name: SHEETS.dirs, head: ['Название', 'Описание'], widths: [260, 420], text: [] },
  {
    name: SHEETS.nums,
    head: ['ID', 'Концерт', 'Направление', '№ в концерте', 'Название', 'Коллектив', 'Исполнители',
      'Постановщики', 'Описание', 'Обложка', 'Начало', 'Конец', 'Старый адрес'],
    widths: [120, 220, 170, 90, 240, 200, 320, 260, 360, 140, 90, 90, 280],
    text: [4, 11, 12]
  },
  { name: SHEETS.cues, head: ['ID номера', 'Время', 'Подпись'], widths: [140, 100, 420], text: [2] },
  { name: SHEETS.people, head: ['Имя', 'О себе', 'Ссылка'], widths: [260, 420, 320], text: [] }
];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Каталог')
    .addItem('Проверить таблицу', 'checkSheet')
    .addItem('Собрать список людей', 'collectPeople')
    .addSeparator()
    .addItem('Обновить сайт сейчас', 'publishSite')
    .addItem('Открыть сайт', 'openSite')
    .addSeparator()
    .addItem('Создать структуру (пустую)', 'setupEmpty')
    .addItem('Создать структуру с демо-данными', 'setupDemo')
    .addItem('Ввести GitHub-токен', 'saveToken')
    .addToUi();
}

/* ------------------------------------------------------------------ структура */

function setupEmpty() { setup_(false); }
function setupDemo() { setup_(true); }

function setup_(withDemo) {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.getActive();
  var ok = ui.alert('Создать структуру',
    'Недостающие листы и заголовки будут добавлены. Уже заполненные данные не удаляются' +
    (withDemo ? ', демо-данные добавятся только на пустые листы.' : '.') + ' Продолжить?', ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;

  var howto = ss.getSheetByName('Как заполнять');
  if (!howto) {
    var first = ss.getSheets()[0];
    if (ss.getSheets().length === 1 && first.getLastRow() <= 1 && first.getLastColumn() <= 1 && !first.getRange('A1').getValue()) {
      first.setName('Как заполнять');
      howto = first;
    } else {
      howto = ss.insertSheet('Как заполнять', 0);
    }
  }
  if (!howto.getRange('A1').getValue()) {
    howto.getRange(1, 1, HOW_TO.length, 1).setValues(HOW_TO.map(function (l) { return [l]; }));
    howto.setColumnWidth(1, 900);
    howto.getRange('A1').setFontWeight('bold').setFontSize(14);
  }

  DEF.forEach(function (d) {
    var sh = ss.getSheetByName(d.name) || ss.insertSheet(d.name);
    formatSheet_(sh, d);
  });
  applyValidation_(ss);

  if (withDemo) fillDemo_(ss);
  ss.toast('Структура готова. Теперь можно заполнять листы.', 'Каталог', 6);
}

function formatSheet_(sh, d) {
  var n = d.head.length;
  if (sh.getMaxColumns() < n) sh.insertColumnsAfter(sh.getMaxColumns(), n - sh.getMaxColumns());
  d.text.forEach(function (c) {
    sh.getRange(2, c + 1, Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat('@');
  });
  var existing = sh.getRange(1, 1, 1, n).getValues()[0];
  if (existing.join('') === '') sh.getRange(1, 1, 1, n).setValues([d.head]);
  sh.getRange(1, 1, 1, n).setBackground(ORANGE).setFontWeight('bold').setFontColor('#1a0f05').setVerticalAlignment('middle');
  sh.setRowHeight(1, 32);
  sh.setFrozenRows(1);
  d.widths.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  if (d.name === SHEETS.nums) {
    sh.getRange(2, 9, Math.max(1, sh.getMaxRows() - 1), 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  }
}

function applyValidation_(ss) {
  function rule(rangeA1Sheet, rangeA1, help) {
    return SpreadsheetApp.newDataValidation()
      .requireValueInRange(ss.getSheetByName(rangeA1Sheet).getRange(rangeA1), true)
      .setAllowInvalid(false).setHelpText(help).build();
  }
  var nums = ss.getSheetByName(SHEETS.nums);
  var cues = ss.getSheetByName(SHEETS.cues);
  nums.getRange('B2:B').setDataValidation(rule(SHEETS.concerts, 'A2:A', 'Сначала добавьте концерт на листе «Концерты».'));
  nums.getRange('C2:C').setDataValidation(rule(SHEETS.dirs, 'A2:A', 'Сначала добавьте направление на листе «Направления».'));
  cues.getRange('A2:A').setDataValidation(rule(SHEETS.nums, 'A2:A', 'Такого ID нет на листе «Номера».'));
}

function fillDemo_(ss) {
  var A = 'Демо-концерт, весна', B = 'Демо-концерт, осень';
  function put(name, rows) {
    var sh = ss.getSheetByName(name);
    if (sh.getLastRow() > 1) return;
    sh.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }
  put(SHEETS.concerts, [
    [A, '2026-05-14', '', 'Выдуманный концерт для проверки сайта.'],
    [B, '2026-10-03', '', 'Второй выдуманный концерт: показывает, как работают фильтры.']
  ]);
  put(SHEETS.dirs, [['Хореография', ''], ['Вокал', ''], ['Театр', ''], ['Оригинальный жанр', '']]);
  put(SHEETS.nums, [
    ['demo-01', A, 'Хореография', '1', 'Первый свет', 'Коллектив «Образец»', 'Анна Тестова, Пётр Образцов, Мария Примерова', 'Ольга Макетова', 'Открывающий номер. Текст выдуманный.', 'demo-01.jpg', '0:02:10', '0:06:40', ''],
    ['demo-02', A, 'Вокал', '2', 'Тихий берег', 'Студия «Пример»', 'Иван Шаблонов', 'Иван Шаблонов', 'Вокальный номер для проверки сортировки.', '', '0:07:30', '0:11:05', ''],
    ['demo-03', A, 'Театр', '3', 'Письмо из города N', 'Театр «Макет»', 'Мария Примерова, Сергей Заглушкин, Анна Тестова', 'Ольга Макетова', 'Театральная миниатюра.', '', '0:12:00', '0:19:20', ''],
    ['demo-04', A, 'Оригинальный жанр', '4', 'Световая партия', 'Коллектив «Образец»', 'Пётр Образцов, Анна Тестова', 'Пётр Образцов', 'Номер с метками времени внутри.', '', '0:21:00', '0:26:30', ''],
    ['demo-05', A, 'Хореография', '5', 'Северный ветер', 'Группа «Шаблон»', 'Елена Черновикова, Дарья Эскизова, Павел Набросков', 'Елена Черновикова', '', '', '0:28:00', '0:33:15', ''],
    ['demo-06', A, 'Вокал', '6', 'Финальный припев', 'Студия «Пример»', 'Иван Шаблонов, Дарья Эскизова', 'Ольга Макетова', 'Закрывающий номер весеннего концерта.', '', '0:35:10', '0:40:00', ''],
    ['demo-07', B, 'Театр', '1', 'Осенний сквозняк', 'Театр «Макет»', 'Сергей Заглушкин, Мария Примерова', 'Сергей Заглушкин', '', '', '0:01:20', '0:08:45', ''],
    ['demo-08', B, 'Хореография', '2', 'Листопад', 'Группа «Шаблон»', 'Елена Черновикова, Павел Набросков, Дарья Эскизова', 'Елена Черновикова', 'Осенний номер.', '', '0:10:00', '0:15:30', ''],
    ['demo-09', B, 'Оригинальный жанр', '3', 'Эхо зала', 'Коллектив «Образец»', 'Анна Тестова, Пётр Образцов', 'Ольга Макетова', '', '', '0:17:00', '0:22:10', '']
  ]);
  put(SHEETS.cues, [
    ['demo-04', '0:21:00', 'Вход на сцену'], ['demo-04', '0:22:45', 'Смена света'],
    ['demo-04', '0:24:10', 'Кульминация'], ['demo-04', '0:25:50', 'Финальная поза'],
    ['demo-01', '0:02:10', 'Выход группы'], ['demo-01', '0:04:05', 'Перестроение'],
    ['demo-03', '0:12:00', 'Начало сцены'], ['demo-03', '0:15:40', 'Поворот сюжета'], ['demo-03', '0:18:30', 'Развязка']
  ]);
  put(SHEETS.people, [
    ['Анна Тестова', 'Выдуманная участница для демонстрации страницы человека.', ''],
    ['Ольга Макетова', 'Выдуманный постановщик.', '']
  ]);
}

/* ------------------------------------------------------------------ чтение и проверка */

function readTable_(name) {
  var sh = SpreadsheetApp.getActive().getSheetByName(name);
  if (!sh) return null;
  var last = sh.getLastRow(), cols = sh.getLastColumn();
  if (last < 1 || cols < 1) return { sh: sh, head: {}, rows: [] };
  var vals = sh.getRange(1, 1, last, cols).getDisplayValues();
  var head = {};
  vals[0].forEach(function (h, i) { head[String(h).trim()] = i; });
  return { sh: sh, head: head, rows: vals.slice(1) };
}

function norm_(s) {
  return String(s || '').trim().replace(/\s+/g, ' ').toLowerCase().replace(/ё/g, 'е');
}

function parseSec_(s) {
  s = String(s || '').trim();
  if (!s) return null;
  var m = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/);
  if (!m) return null;
  if (m[3] === undefined) return (+m[1]) * 60 + (+m[2]);
  return (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
}

function hms_(t) {
  var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return (h ? h + ':' + ('0' + m).slice(-2) : m) + ':' + ('0' + s).slice(-2);
}

function splitPeople_(s) {
  return String(s || '').split(/[,;\n]/).map(function (x) { return x.trim(); }).filter(Boolean);
}

function esc_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function clearMarks_(sh) {
  var rows = sh.getLastRow(), cols = sh.getLastColumn();
  if (rows < 2 || cols < 1) return;
  var r = sh.getRange(2, 1, rows - 1, cols);
  var bg = r.getBackgrounds(), changed = false;
  for (var i = 0; i < bg.length; i++) for (var j = 0; j < bg[i].length; j++) {
    if (bg[i][j] === RED) { bg[i][j] = null; changed = true; }
  }
  if (changed) r.setBackgrounds(bg.map(function (row) { return row.map(function (c) { return c || null; }); }));
}

function lev1_(a, b) {
  // true, если строки отличаются не больше чем одним символом
  if (a === b) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  var i = 0, j = 0, diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diff > 1) return false;
    if (a.length > b.length) i++; else if (a.length < b.length) j++; else { i++; j++; }
  }
  return diff + (a.length - i) + (b.length - j) <= 1;
}

function runChecks_() {
  var ss = SpreadsheetApp.getActive();
  var problems = [];
  function add(sheet, row, col, msg, level) { problems.push({ sheet: sheet, row: row, col: col, msg: msg, level: level || 'error' }); }

  var T = {};
  Object.keys(SHEETS).forEach(function (k) { T[k] = readTable_(SHEETS[k]); });
  Object.keys(T).forEach(function (k) {
    if (!T[k]) add(SHEETS[k], 0, 0, 'Нет листа «' + SHEETS[k] + '». Выберите Каталог → Создать структуру.');
  });
  if (problems.length) return problems;
  Object.keys(T).forEach(function (k) { clearMarks_(T[k].sh); });

  function col(t, name, sheetName) {
    if (!(name in t.head)) { add(sheetName, 1, 0, 'Нет столбца «' + name + '» в первой строке.'); return -1; }
    return t.head[name];
  }

  var concerts = {}, dirs = {};
  var tc = T.concerts, cN = col(tc, 'Название', SHEETS.concerts);
  if (cN >= 0) tc.rows.forEach(function (r, i) {
    var v = norm_(r[cN]); if (!v) return;
    if (concerts[v]) add(SHEETS.concerts, i + 2, cN + 1, 'Концерт «' + r[cN] + '» указан дважды.');
    concerts[v] = true;
  });
  var td = T.dirs, dN = col(td, 'Название', SHEETS.dirs);
  if (dN >= 0) td.rows.forEach(function (r, i) {
    var v = norm_(r[dN]); if (!v) return;
    if (dirs[v]) add(SHEETS.dirs, i + 2, dN + 1, 'Направление «' + r[dN] + '» указано дважды.');
    dirs[v] = true;
  });

  var tn = T.nums, ids = {}, span = {};
  var cID = col(tn, 'ID', SHEETS.nums), cC = col(tn, 'Концерт', SHEETS.nums), cD = col(tn, 'Направление', SHEETS.nums),
    cT = col(tn, 'Название', SHEETS.nums), cS = col(tn, 'Начало', SHEETS.nums), cE = col(tn, 'Конец', SHEETS.nums),
    cP = col(tn, 'Исполнители', SHEETS.nums), cQ = col(tn, 'Постановщики', SHEETS.nums);
  var names = {};
  if (cID >= 0 && cC >= 0 && cT >= 0) tn.rows.forEach(function (r, i) {
    var row = i + 2;
    if (!r.join('').trim()) return;
    var id = String(r[cID]).trim();
    if (!id) add(SHEETS.nums, row, cID + 1, 'Не заполнен ID.');
    else if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(id)) add(SHEETS.nums, row, cID + 1, 'ID «' + id + '»: только латинские буквы, цифры и дефис.');
    else if (ids[id.toLowerCase()]) add(SHEETS.nums, row, cID + 1, 'ID «' + id + '» уже есть в строке ' + ids[id.toLowerCase()] + '.');
    else ids[id.toLowerCase()] = row;
    if (!String(r[cT]).trim()) add(SHEETS.nums, row, cT + 1, 'Не заполнено название номера.');
    if (!String(r[cC]).trim()) add(SHEETS.nums, row, cC + 1, 'Не выбран концерт.');
    else if (!concerts[norm_(r[cC])]) add(SHEETS.nums, row, cC + 1, 'Концерта «' + r[cC] + '» нет на листе «Концерты».');
    if (cD >= 0 && String(r[cD]).trim() && !dirs[norm_(r[cD])]) add(SHEETS.nums, row, cD + 1, 'Направления «' + r[cD] + '» нет на листе «Направления».');
    var s = cS >= 0 ? parseSec_(r[cS]) : null, e = cE >= 0 ? parseSec_(r[cE]) : null;
    if (cS >= 0 && String(r[cS]).trim() && s === null) add(SHEETS.nums, row, cS + 1, 'Начало «' + r[cS] + '» не распознано. Формат ч:мм:сс.');
    if (cE >= 0 && String(r[cE]).trim() && e === null) add(SHEETS.nums, row, cE + 1, 'Конец «' + r[cE] + '» не распознан. Формат ч:мм:сс.');
    if (s !== null && e !== null && e <= s) add(SHEETS.nums, row, cE + 1, 'Конец номера раньше или равен началу.');
    if (id && s !== null && e !== null) span[id.toLowerCase()] = { s: s, e: e, title: r[cT] };
    [cP, cQ].forEach(function (c) {
      if (c >= 0) splitPeople_(r[c]).forEach(function (n) { names[norm_(n)] = names[norm_(n)] || n; });
    });
  });

  var tq = T.cues, qI = col(tq, 'ID номера', SHEETS.cues), qT = col(tq, 'Время', SHEETS.cues);
  if (qI >= 0 && qT >= 0) tq.rows.forEach(function (r, i) {
    var row = i + 2;
    if (!r.join('').trim()) return;
    var id = String(r[qI]).trim().toLowerCase();
    if (!id) { add(SHEETS.cues, row, qI + 1, 'Не указан ID номера.'); return; }
    if (!ids[id]) { add(SHEETS.cues, row, qI + 1, 'Номера с ID «' + r[qI] + '» нет на листе «Номера».'); return; }
    var t = parseSec_(r[qT]);
    if (t === null) { add(SHEETS.cues, row, qT + 1, 'Время «' + r[qT] + '» не распознано. Формат ч:мм:сс.'); return; }
    var sp = span[id];
    if (sp && (t < sp.s || t > sp.e)) {
      add(SHEETS.cues, row, qT + 1, 'Время ' + hms_(t) + ' вне номера «' + sp.title + '» (' + hms_(sp.s) + '–' + hms_(sp.e) + '). Время указывается по записи всего концерта.');
    }
  });

  var keys = Object.keys(names);
  for (var a = 0; a < keys.length; a++) for (var b = a + 1; b < keys.length; b++) {
    if (keys[a].length >= 6 && lev1_(keys[a], keys[b])) {
      add(SHEETS.nums, 0, 0, 'Похожие имена: «' + names[keys[a]] + '» и «' + names[keys[b]] + '». Если это один человек, напишите одинаково.', 'warn');
    }
  }

  problems.forEach(function (p) {
    if (p.level === 'error' && p.row > 0 && p.col > 0) {
      var sh = ss.getSheetByName(p.sheet);
      if (sh) sh.getRange(p.row, p.col).setBackground(RED);
    }
  });
  return problems;
}

function checkSheet() {
  var problems = runChecks_();
  var errors = problems.filter(function (p) { return p.level === 'error'; });
  var warns = problems.filter(function (p) { return p.level === 'warn'; });
  if (!problems.length) {
    SpreadsheetApp.getActive().toast('Ошибок нет. Можно обновлять сайт.', 'Каталог', 6);
    return { errors: 0, warns: 0 };
  }
  var html = '<div style="font:14px/1.45 sans-serif">';
  html += '<p><b>Ошибок: ' + errors.length + ', замечаний: ' + warns.length + '.</b> Ячейки с ошибками покрашены красным.</p><ul>';
  problems.slice(0, 80).forEach(function (p) {
    var where = p.row ? 'лист «' + p.sheet + '», строка ' + p.row : 'лист «' + p.sheet + '»';
    html += '<li>' + (p.level === 'warn' ? '⚠ ' : '') + esc_(where) + ': ' + esc_(p.msg) + '</li>';
  });
  html += '</ul>' + (problems.length > 80 ? '<p>Показаны первые 80.</p>' : '') + '</div>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(620).setHeight(440), 'Проверка таблицы');
  return { errors: errors.length, warns: warns.length };
}

/* ------------------------------------------------------------------ люди */

function collectPeople() {
  var tn = readTable_(SHEETS.nums), tp = readTable_(SHEETS.people);
  if (!tn || !tp) { SpreadsheetApp.getUi().alert('Нет листа «Номера» или «Люди». Выберите Каталог → Создать структуру.'); return; }
  var cols = ['Исполнители', 'Постановщики'].map(function (n) { return tn.head[n]; }).filter(function (c) { return c !== undefined; });
  var have = {};
  var nameCol = tp.head['Имя'];
  if (nameCol === undefined) { SpreadsheetApp.getUi().alert('На листе «Люди» нет столбца «Имя».'); return; }
  tp.rows.forEach(function (r) { var v = norm_(r[nameCol]); if (v) have[v] = true; });
  var add = [];
  tn.rows.forEach(function (r) {
    cols.forEach(function (c) {
      splitPeople_(r[c]).forEach(function (n) {
        var k = norm_(n);
        if (!have[k]) { have[k] = true; add.push(n); }
      });
    });
  });
  if (!add.length) { SpreadsheetApp.getActive().toast('Все люди уже есть на листе «Люди».', 'Каталог', 5); return; }
  add.sort(function (a, b) { return a.localeCompare(b, 'ru'); });
  var start = tp.sh.getLastRow() + 1;
  var width = tp.sh.getLastColumn();
  var out = add.map(function (n) { var row = new Array(width).fill(''); row[nameCol] = n; return row; });
  tp.sh.getRange(start, 1, out.length, width).setValues(out);
  SpreadsheetApp.getActive().toast('Добавлено людей: ' + add.length + '. Впишите описание и ссылку, если нужно.', 'Каталог', 8);
}

/* ------------------------------------------------------------------ публикация */

function saveToken() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('GitHub-токен',
    'Вставьте токен (fine-grained, только репозиторий ' + REPO + ', права Actions: Read and write). Он хранится в вашем аккаунте Google и не виден в таблице.',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var t = res.getResponseText().trim();
  if (!t) return;
  PropertiesService.getUserProperties().setProperty('GH_TOKEN', t);
  ui.alert('Токен сохранён. Теперь работает Каталог → Обновить сайт сейчас.');
}

function publishSite() {
  var ui = SpreadsheetApp.getUi();
  var token = PropertiesService.getUserProperties().getProperty('GH_TOKEN');
  if (!token) { ui.alert('Сначала введите токен: Каталог → Ввести GitHub-токен.'); return; }
  var problems = runChecks_().filter(function (p) { return p.level === 'error'; });
  if (problems.length) {
    var go = ui.alert('В таблице есть ошибки (' + problems.length + ')',
      'Сайт при ошибках не обновится: робот остановится и оставит прежнюю версию. Сначала исправьте (выберите Каталог → Проверить таблицу). Всё равно запустить сборку?',
      ui.ButtonSet.YES_NO);
    if (go !== ui.Button.YES) return;
  }
  var resp = UrlFetchApp.fetch('https://api.github.com/repos/' + REPO + '/actions/workflows/' + WORKFLOW_FILE + '/dispatches', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    },
    payload: JSON.stringify({ ref: BRANCH }),
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  if (code === 204) {
    ui.alert('Сборка запущена. Сайт обновится через 1–2 минуты:\n' + SITE_URL);
  } else if (code === 401 || code === 403 || code === 404) {
    ui.alert('GitHub не принял токен (код ' + code + '). Проверьте, что у токена есть доступ к ' + REPO + ' и права Actions: Read and write. Введите токен заново.');
  } else {
    ui.alert('Не получилось запустить сборку. Ответ GitHub: ' + code + '\n' + resp.getContentText().slice(0, 300));
  }
}

function openSite() {
  var html = HtmlService.createHtmlOutput('<script>window.open(' + JSON.stringify(SITE_URL) + ', "_blank");google.script.host.close();</script>')
    .setWidth(80).setHeight(40);
  SpreadsheetApp.getUi().showModalDialog(html, 'Открываю сайт…');
}
