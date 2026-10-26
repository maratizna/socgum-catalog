/**
 * Меню «Каталог» для Google Таблицы каталога номеров СоцГума.
 *
 * Что умеет:
 *   Создать структуру      – листы, заголовки, выпадающие списки, форматы (по желанию с демо-данными)
 *   Проверить таблицу      – ищет ошибки до публикации, красит ячейки с ошибками
 *   Собрать список людей   – добавляет на лист «Люди» всех, кто упомянут в номерах
 *   Проставить ID          – постоянные адреса для концертов, направлений, людей и номеров
 *   Переименовать выделенное – меняет название или имя везде, ID и ссылки остаются прежними
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
  '4. Лист «Люди» необязательный: описание и ссылка для человека. Меню Каталог → Собрать список людей заполнит имена сам.',
  '',
  'Столбец «ID» на листах «Концерты», «Направления» и «Люди» — постоянный адрес на сайте. Он заполняется сам и после публикации не меняется.',
  'Чтобы переименовать концерт, направление или человека, выделите ячейку с названием или именем и выберите Каталог → Переименовать выделенное.',
  'Меню поправит все упоминания в листе «Номера», а адрес и привязка аккаунта сохранятся.',
  '',
  'Начало и конец номера вводите так: ч:мм:сс, например 0:20:52, по записи концерта целиком, как на плеере. Эти столбцы хранят простой текст, формат не меняйте.',
  'ID номера — латинские буквы, цифры и дефис, он станет частью адреса страницы. После публикации ID лучше не менять.',
  '',
  'Перед публикацией выберите Каталог → Проверить таблицу. Ячейки с ошибками покрасятся красным.',
  'Если в таблице ошибка, сайт не обновится, а прежняя версия останется на месте.'
];

var DEF = [
  { name: SHEETS.concerts, head: ['Название', 'Дата', 'Видео', 'Описание', 'ID'], widths: [260, 110, 380, 380, 170], text: [1, 2, 4] },
  { name: SHEETS.dirs, head: ['Название', 'Описание', 'ID'], widths: [260, 420, 170], text: [2] },
  {
    name: SHEETS.nums,
    head: ['ID', 'Концерт', 'Направление', '№ в концерте', 'Название', 'Коллектив', 'Исполнители',
      'Постановщики', 'Описание', 'Обложка', 'Начало', 'Конец', 'Старый адрес'],
    widths: [120, 220, 170, 90, 240, 200, 320, 260, 360, 140, 90, 90, 280],
    text: [0, 3, 10, 11]
  },
  { name: SHEETS.people, head: ['Имя', 'О себе', 'Ссылка', 'ID'], widths: [260, 420, 320, 170], text: [3] }
];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Каталог')
    .addItem('Проверить таблицу', 'checkSheet')
    .addItem('Собрать список людей', 'collectPeople')
    .addItem('Проставить ID', 'fillIds')
    .addItem('Переименовать выделенное…', 'renameSelected')
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
  nums.getRange('B2:B').setDataValidation(rule(SHEETS.concerts, 'A2:A', 'Сначала добавьте концерт на листе «Концерты».'));
  nums.getRange('C2:C').setDataValidation(rule(SHEETS.dirs, 'A2:A', 'Сначала добавьте направление на листе «Направления».'));
}

function fillDemo_(ss) {
  var A = 'Демо-концерт, весна', B = 'Демо-концерт, осень';
  function put(name, rows) {
    var sh = ss.getSheetByName(name);
    if (sh.getLastRow() > 1) return;
    sh.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
  }
  put(SHEETS.concerts, [
    [A, '2026-05-14', '', 'Выдуманный концерт для проверки сайта.', 'demo-vesna'],
    [B, '2026-10-03', '', 'Второй выдуманный концерт: показывает, как работают фильтры.', 'demo-osen']
  ]);
  put(SHEETS.dirs, [['Хореография', '', 'khoreografiya'], ['Вокал', '', 'vokal'], ['Театр', '', 'teatr'], ['Оригинальный жанр', '', 'originalnyy-zhanr']]);
  put(SHEETS.nums, [
    ['demo-01', A, 'Хореография', '1', 'Первый свет', 'Коллектив «Образец»', 'Анна Тестова, Пётр Образцов, Мария Примерова', 'Ольга Макетова', 'Открывающий номер. Текст выдуманный.', 'demo-01.jpg', '0:02:10', '0:06:40', ''],
    ['demo-02', A, 'Вокал', '2', 'Тихий берег', 'Студия «Пример»', 'Иван Шаблонов', 'Иван Шаблонов', 'Вокальный номер для проверки сортировки.', '', '0:07:30', '0:11:05', ''],
    ['demo-03', A, 'Театр', '3', 'Письмо из города N', 'Театр «Макет»', 'Мария Примерова, Сергей Заглушкин, Анна Тестова', 'Ольга Макетова', 'Театральная миниатюра.', '', '0:12:00', '0:19:20', ''],
    ['demo-04', A, 'Оригинальный жанр', '4', 'Световая партия', 'Коллектив «Образец»', 'Пётр Образцов, Анна Тестова', 'Пётр Образцов', 'Номер с оригинальной сценографией.', '', '0:21:00', '0:26:30', ''],
    ['demo-05', A, 'Хореография', '5', 'Северный ветер', 'Группа «Шаблон»', 'Елена Черновикова, Дарья Эскизова, Павел Набросков', 'Елена Черновикова', '', '', '0:28:00', '0:33:15', ''],
    ['demo-06', A, 'Вокал', '6', 'Финальный припев', 'Студия «Пример»', 'Иван Шаблонов, Дарья Эскизова', 'Ольга Макетова', 'Закрывающий номер весеннего концерта.', '', '0:35:10', '0:40:00', ''],
    ['demo-07', B, 'Театр', '1', 'Осенний сквозняк', 'Театр «Макет»', 'Сергей Заглушкин, Мария Примерова', 'Сергей Заглушкин', '', '', '0:01:20', '0:08:45', ''],
    ['demo-08', B, 'Хореография', '2', 'Листопад', 'Группа «Шаблон»', 'Елена Черновикова, Павел Набросков, Дарья Эскизова', 'Елена Черновикова', 'Осенний номер.', '', '0:10:00', '0:15:30', ''],
    ['demo-09', B, 'Оригинальный жанр', '3', 'Эхо зала', 'Коллектив «Образец»', 'Анна Тестова, Пётр Образцов', 'Ольга Макетова', '', '', '0:17:00', '0:22:10', '']
  ]);
  put(SHEETS.people, [
    ['Анна Тестова', 'Выдуманная участница для демонстрации страницы человека.', '', 'anna-testova'],
    ['Ольга Макетова', 'Выдуманный постановщик.', '', 'olga-maketova'],
    ['Пётр Образцов', '', '', 'petr-obraztsov'],
    ['Мария Примерова', '', '', 'mariya-primerova'],
    ['Иван Шаблонов', '', '', 'ivan-shablonov'],
    ['Сергей Заглушкин', '', '', 'sergey-zaglushkin'],
    ['Елена Черновикова', '', '', 'elena-chernovikova'],
    ['Дарья Эскизова', '', '', 'darya-eskizova'],
    ['Павел Набросков', '', '', 'pavel-nabroskov']
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

  function checkIds(t, sheetName, nameHead) {
    var ci = col(t, 'ID', sheetName), cn = col(t, nameHead, sheetName);
    if (ci < 0 || cn < 0) return;
    var seen = {}, empty = 0, firstEmpty = 0;
    t.rows.forEach(function (r, i) {
      var id = String(r[ci]).trim(), row = i + 2;
      if (!id) {
        if (String(r[cn]).trim()) { empty++; if (!firstEmpty) firstEmpty = row; }
        return;
      }
      if (!/^[A-Za-z0-9_-]+$/.test(id)) add(sheetName, row, ci + 1, 'ID «' + id + '»: только латинские буквы, цифры, дефис и подчёркивание.');
      else if (seen[id.toLowerCase()]) add(sheetName, row, ci + 1, 'ID «' + id + '» уже есть в строке ' + seen[id.toLowerCase()] + '.');
      else seen[id.toLowerCase()] = row;
    });
    if (empty) add(sheetName, firstEmpty, 0, 'У ' + empty + ' строк нет ID: адрес возьмётся из названия и сменится при переименовании. Выберите Каталог → Проставить ID.', 'warn');
  }
  checkIds(T.concerts, SHEETS.concerts, 'Название');
  checkIds(T.dirs, SHEETS.dirs, 'Название');
  checkIds(T.people, SHEETS.people, 'Имя');

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

  var tn = T.nums, ids = {};
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
    [cP, cQ].forEach(function (c) {
      if (c >= 0) splitPeople_(r[c]).forEach(function (n) { names[norm_(n)] = names[norm_(n)] || n; });
    });
  });

  var cpn = T.people.head['Имя'], haveRow = {};
  if (cpn !== undefined) T.people.rows.forEach(function (r) { haveRow[norm_(r[cpn])] = true; });
  var loose = Object.keys(names).filter(function (k) { return !haveRow[k]; });
  if (cpn !== undefined && loose.length) {
    add(SHEETS.people, 0, 0, 'У ' + loose.length + ' человек нет строки на листе «Люди» (например, «' + names[loose[0]] + '»). Выберите Каталог → Собрать список людей.', 'warn');
  }

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
  fillIdsSheet_(SHEETS.people, 'Имя');
  SpreadsheetApp.getActive().toast('Добавлено людей: ' + add.length + ', ID проставлены. Впишите описание и ссылку, если нужно.', 'Каталог', 8);
}

/* ------------------------------------------------------------------ постоянные адреса (ID) */

var TRANSLIT = { а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya' };

function slugify_(s) {
  s = norm_(s);
  var out = '';
  for (var i = 0; i < s.length; i++) out += TRANSLIT.hasOwnProperty(s[i]) ? TRANSLIT[s[i]] : s[i];
  out = out.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return out || 'x';
}

// Заполняет пустые ID на листе. Уже заполненные не трогает никогда: на них держатся ссылки.
function fillIdsSheet_(name, nameHead) {
  var t = readTable_(name);
  if (!t) return 0;
  var ci = t.head['ID'], cn = t.head[nameHead];
  if (ci === undefined || cn === undefined || !t.rows.length) return 0;
  var used = Object.create(null), changed = 0, out = [];
  t.rows.forEach(function (r) { var v = String(r[ci]).trim().toLowerCase(); if (v) used[v] = true; });
  t.rows.forEach(function (r) {
    var id = String(r[ci]).trim(), nm = String(r[cn]).trim();
    if (!id && nm) {
      var base = slugify_(nm), s = base, k = 2;
      while (used[s]) { s = base + '-' + k; k++; }
      used[s] = true; id = s; changed++;
    }
    out.push([id]);
  });
  if (changed) t.sh.getRange(2, ci + 1, out.length, 1).setNumberFormat('@').setValues(out);
  return changed;
}

function fillIds_() {
  return fillIdsSheet_(SHEETS.concerts, 'Название') + fillIdsSheet_(SHEETS.dirs, 'Название') +
    fillIdsSheet_(SHEETS.people, 'Имя') + fillIdsSheet_(SHEETS.nums, 'Название');
}

function fillIds() {
  var n = fillIds_();
  SpreadsheetApp.getActive().toast(n ? 'Проставлено ID: ' + n + '. Теперь адреса не зависят от названий.' : 'У всех строк уже есть ID.', 'Каталог', 6);
}

// Простой триггер: ID появляется сам, как только вписано название или имя.
function onEdit(e) {
  try {
    var sh = e.range.getSheet(), heads = {};
    heads[SHEETS.concerts] = 'Название'; heads[SHEETS.dirs] = 'Название'; heads[SHEETS.nums] = 'Название'; heads[SHEETS.people] = 'Имя';
    if (!heads.hasOwnProperty(sh.getName()) || e.range.getRow() < 2) return;
    fillIdsSheet_(sh.getName(), heads[sh.getName()]);
  } catch (err) { /* не мешаем редактированию */ }
}

/* ------------------------------------------------------------------ переименование */

function renameSelected() {
  var ui = SpreadsheetApp.getUi(), ss = SpreadsheetApp.getActive();
  var sh = ss.getActiveSheet(), cell = ss.getActiveRange();
  var kinds = {};
  kinds[SHEETS.concerts] = { head: 'Название', refs: [[SHEETS.nums, 'Концерт', false]] };
  kinds[SHEETS.dirs] = { head: 'Название', refs: [[SHEETS.nums, 'Направление', false]] };
  kinds[SHEETS.people] = { head: 'Имя', refs: [[SHEETS.nums, 'Исполнители', true], [SHEETS.nums, 'Постановщики', true]] };
  var kind = kinds[sh.getName()];
  if (!kind || !cell || cell.getRow() < 2 || cell.getNumRows() !== 1 || cell.getNumColumns() !== 1 ||
      String(sh.getRange(1, cell.getColumn()).getValue()).trim() !== kind.head) {
    ui.alert('Выделите одну ячейку с названием или именем (столбец «Название» на листах «Концерты» и «Направления» или «Имя» на листе «Люди»), затем снова выберите Каталог → Переименовать выделенное.');
    return;
  }
  var old = String(cell.getDisplayValue()).trim();
  if (!old) { ui.alert('Ячейка пуста.'); return; }
  fillIdsSheet_(sh.getName(), kind.head); // ID появляется до переименования, чтобы адрес остался прежним
  var res = ui.prompt('Переименовать', 'Новое написание для «' + old + '». Адрес на сайте не изменится.', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var neu = res.getResponseText().trim().replace(/\s+/g, ' ');
  if (!neu || neu === old) return;
  var t = readTable_(sh.getName()), cn = t.head[kind.head];
  var clash = t.rows.some(function (r, i) { return i + 2 !== cell.getRow() && norm_(r[cn]) === norm_(neu); });
  if (clash) { ui.alert('«' + neu + '» уже есть в этом списке. Объединять двух человек или два названия нужно вручную: вам решать, чьи ID и ссылки сохранить.'); return; }

  cell.setValue(neu);
  var changedCells = 0;
  kind.refs.forEach(function (ref) {
    var rt = readTable_(ref[0]), rc = rt && rt.head[ref[1]];
    if (!rt || rc === undefined || !rt.rows.length) return;
    var vals = rt.rows.map(function (r) { return [r[rc]]; }), touched = false;
    vals.forEach(function (v, i) {
      var cur = String(v[0]);
      if (ref[2]) {
        var parts = splitPeople_(cur), hit = false;
        parts = parts.map(function (n) { if (norm_(n) === norm_(old)) { hit = true; return neu; } return n; });
        if (hit) { vals[i][0] = parts.join(', '); touched = true; changedCells++; }
      } else if (norm_(cur) === norm_(old)) {
        vals[i][0] = neu; touched = true; changedCells++;
      }
    });
    if (touched) rt.sh.getRange(2, rc + 1, vals.length, 1).setValues(vals);
  });
  ss.toast('«' + old + '» → «' + neu + '». Исправлено упоминаний в «Номерах»: ' + changedCells + '. Нажмите «Обновить сайт», чтобы изменения появились на сайте.', 'Каталог', 10);
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
  fillIds_();
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
