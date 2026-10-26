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
    .addSubMenu(SpreadsheetApp.getUi().createMenu('Формы для заполнения')
      .addItem('Создать формы', 'createForms')
      .addItem('Обновить списки в формах', 'refreshFormChoices')
      .addItem('Применить решения по заявкам', 'applyDecisions'))
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
    var sh0 = e.range.getSheet();
    if (sh0.getName() === QUEUE) {
      if (e.range.getColumn() === 5 && e.range.getRow() >= 2) applyQueueRow_(sh0, e.range.getRow());
      return;
    }
  } catch (err0) { /* не мешаем редактированию */ }
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

/* ------------------------------------------------------------------ формы для заполнения с телефона */
/*
 * Три формы Google пишут в эту таблицу:
 *   1. «Новый концерт»      – название, дата, ссылка на запись.
 *   2. «Номера списком»     – концерт и список «время название», по строке на номер.
 *   3. «Дополнить номер»    – коллектив, исполнители, постановщики, описание, время.
 * Кто входит в число редакторов таблицы, тот администратор: его ответ попадает в таблицу сразу.
 * Ответ любого другого человека ложится на лист «Заявки» и ждёт решения: в столбце «Решение» выбрать «Принять» или «Отклонить».
 */

var QUEUE = 'Заявки';
var FORMS_SHEET = 'Формы';
var QUEUE_HEAD = ['Когда', 'От кого', 'Что', 'Содержание', 'Решение', 'Статус', 'Данные'];
var WAIT = 'Ждёт решения';

var FT = {
  A: { name: 'Название концерта', date: 'Дата концерта', video: 'Ссылка на запись концерта в VK', about: 'Описание' },
  B: { concert: 'Концерт', direction: 'Направление (для всех номеров списка)', list: 'Список номеров: время начала и название',
       end: 'Когда закончился последний номер (необязательно, ч:мм:сс)' },
  C: { number: 'Номер', direction: 'Направление', collective: 'Коллектив', performers: 'Исполнители (полный список через запятую)',
       directors: 'Постановщики (полный список через запятую)', about: 'Описание', start: 'Начало (ч:мм:сс)', end: 'Конец (ч:мм:сс)' }
};
var KIND_NAME = { A: 'Новый концерт', B: 'Номера списком', C: 'Дополнение номера' };

function props_() { return PropertiesService.getDocumentProperties(); }

function createForms() {
  var ui = SpreadsheetApp.getUi(), p = props_();
  if (p.getProperty('FORM_A')) {
    refreshFormChoices();
    fillFormsSheet_();
    ui.alert('Формы уже созданы. Ссылки на листе «Формы». Списки в формах обновлены.');
    return;
  }
  var ss = SpreadsheetApp.getActive();
  function base(title, desc) {
    var f = FormApp.create(title);
    f.setDescription(desc);
    f.setAllowResponseEdits(false);
    f.setLimitOneResponsePerUser(false);
    f.setProgressBar(false);
    try { f.setEmailCollectionType(FormApp.EmailCollectionType.VERIFIED); } catch (e1) { f.setCollectEmail(true); }
    f.setConfirmationMessage('Готово. Если вы администратор, запись уже в таблице. Иначе её проверит администратор.');
    return f;
  }

  var a = base('Каталог СоцГума: новый концерт', 'Добавьте концерт, потом внесите его номера в форме «Номера списком».');
  a.addTextItem().setTitle(FT.A.name).setHelpText('Например: Гала-концерт СоцГум, осень 2024').setRequired(true);
  a.addDateItem().setTitle(FT.A.date).setRequired(false);
  a.addTextItem().setTitle(FT.A.video).setHelpText('Ссылка на запись концерта целиком в VK').setRequired(true)
    .setValidation(FormApp.createTextValidation().setHelpText('Нужна ссылка на видео VK, например https://vk.ru/video-123_456')
      .requireTextContainsPattern('(video-?\\d+_\\d+|oid=-?\\d+)').build());
  a.addParagraphTextItem().setTitle(FT.A.about).setRequired(false);

  var b = base('Каталог СоцГума: номера концерта списком', 'Вставьте список номеров с временем начала. Время конца каждого номера считается по началу следующего.');
  b.addListItem().setTitle(FT.B.concert).setChoiceValues(['(пока пусто)']).setRequired(true);
  b.addListItem().setTitle(FT.B.direction).setChoiceValues(['(пока пусто)']).setRequired(false);
  b.addParagraphTextItem().setTitle(FT.B.list)
    .setHelpText('По строке на номер, время как на плеере: 0:02:10 Первый свет. Можно вставить таймкоды из описания видео.').setRequired(true);
  b.addTextItem().setTitle(FT.B.end).setHelpText('Например 0:41:30. Если пусто, у последнего номера не будет конца.').setRequired(false);

  var c = base('Каталог СоцГума: дополнить номер', 'Заполните только то, что хотите добавить или исправить. Пустые поля ничего не меняют.');
  c.addListItem().setTitle(FT.C.number).setChoiceValues(['(пока пусто)']).setRequired(true);
  c.addListItem().setTitle(FT.C.direction).setChoiceValues(['(пока пусто)']).setRequired(false);
  c.addTextItem().setTitle(FT.C.collective).setRequired(false);
  c.addParagraphTextItem().setTitle(FT.C.performers).setHelpText('Имена через запятую, везде одинаково. Список заменит прежний.').setRequired(false);
  c.addParagraphTextItem().setTitle(FT.C.directors).setHelpText('Имена через запятую. Список заменит прежний.').setRequired(false);
  c.addParagraphTextItem().setTitle(FT.C.about).setRequired(false);
  c.addTextItem().setTitle(FT.C.start).setHelpText('Например 0:02:10').setRequired(false);
  c.addTextItem().setTitle(FT.C.end).setHelpText('Например 0:06:40').setRequired(false);

  [['A', a], ['B', b], ['C', c]].forEach(function (x) {
    p.setProperty('FORM_' + x[0], x[1].getId());
    ScriptApp.newTrigger('onFormSubmitCatalog').forForm(x[1]).onFormSubmit().create();
  });
  ScriptApp.newTrigger('refreshFormChoices').timeBased().everyHours(1).create();

  queueSheet_();
  refreshFormChoices();
  fillFormsSheet_();
  ss.toast('Формы созданы. Ссылки на листе «Формы».', 'Каталог', 8);
}

function formsMap_() {
  var p = props_(), out = {};
  ['A', 'B', 'C'].forEach(function (k) { var id = p.getProperty('FORM_' + k); if (id) out[k] = id; });
  return out;
}

function fillFormsSheet_() {
  var ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName(FORMS_SHEET) || ss.insertSheet(FORMS_SHEET);
  var m = formsMap_();
  sh.clear();
  var rows = [['Форма', 'Для чего', 'Ссылка для сотрудников']];
  var info = {
    A: ['Новый концерт', 'Название, дата и ссылка на запись концерта в VK.'],
    B: ['Номера списком', 'Выбрать концерт и вставить список «время название», по строке на номер.'],
    C: ['Дополнить номер', 'Выбрать номер и добавить коллектив, исполнителей, постановщиков, описание, время.']
  };
  ['A', 'B', 'C'].forEach(function (k) {
    if (!m[k]) return;
    var f = FormApp.openById(m[k]);
    rows.push([info[k][0], info[k][1], f.getPublishedUrl()]);
  });
  rows.forEach(function (r, i) {
    sh.getRange(i + 1, 1, 1, 2).setValues([[r[0], r[1]]]);
    sh.getRange(i + 1, 3).setValue(r[2]);
  });
  var guide = [
    '', 'Как пользоваться (с телефона тоже)',
    '1. Откройте ссылку на форму и войдите в аккаунт Google. Форма запомнит вашу почту.',
    '2. «Новый концерт»: вставьте название и ссылку на запись VK. Дата необязательна.',
    '3. «Номера списком»: выберите концерт, вставьте список. Каждая строка: время начала и название, например «0:02:10 Первый свет».',
    '4. «Дополнить номер»: выберите номер, впишите коллектив, исполнителей, постановщиков, описание. Заполняйте только нужное, пустое ничего не стирает. Форму можно открывать много раз.',
    '5. Если вы редактор этой таблицы, запись появится в ней сразу. Иначе она ляжет на лист «Заявки», и администратор выберет в столбце «Решение» значение «Принять» или «Отклонить».',
    '6. Списки концертов и номеров в формах обновляются раз в час и после каждого ответа. Сразу: Каталог → Формы для заполнения → Обновить списки в формах.',
    '7. Чтобы запись попала на сайт, администратор выбирает Каталог → Обновить сайт сейчас (или ждёт ночной сборки).'
  ];
  sh.getRange(rows.length + 1, 1, guide.length, 1).setValues(guide.map(function (g) { return [g]; }));
  sh.getRange(rows.length + 2, 1).setFontWeight('bold');
  sh.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground(ORANGE);
  sh.setColumnWidth(1, 200); sh.setColumnWidth(2, 520); sh.setColumnWidth(3, 460);
  sh.getRange(1, 1, rows.length + guide.length, 3).setVerticalAlignment('top');
}

function queueSheet_() {
  var ss = SpreadsheetApp.getActive(), sh = ss.getSheetByName(QUEUE);
  if (sh) return sh;
  sh = ss.insertSheet(QUEUE);
  sh.getRange(1, 1, 1, QUEUE_HEAD.length).setValues([QUEUE_HEAD]).setFontWeight('bold').setBackground(ORANGE);
  sh.setFrozenRows(1);
  [150, 220, 150, 520, 110, 200, 60].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.getRange(2, 4, 998, 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
  sh.getRange(2, 5, 998, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Принять', 'Отклонить'], true).setAllowInvalid(false).build());
  sh.hideColumns(7);
  return sh;
}

// Списки концертов, направлений и номеров в формах.
function refreshFormChoices() {
  var m = formsMap_();
  if (!m.A) return;
  var tc = readTable_(SHEETS.concerts), td = readTable_(SHEETS.dirs), tn = readTable_(SHEETS.nums);
  function col(t, name) { return t && t.head[name] !== undefined ? t.rows.map(function (r) { return String(r[t.head[name]]).trim(); }).filter(Boolean) : []; }
  var concerts = col(tc, 'Название'), dirs = col(td, 'Название');
  var nums = [];
  if (tn && tn.head['ID'] !== undefined) tn.rows.forEach(function (r) {
    var id = String(r[tn.head['ID']]).trim(), t = String(r[tn.head['Название']]).trim();
    if (id && t) nums.push(id + ' — ' + t + ' (' + String(r[tn.head['Концерт']]).trim() + ')');
  });
  function set(form, title, list) {
    form.getItems(FormApp.ItemType.LIST).forEach(function (it) {
      if (it.getTitle() === title) it.asListItem().setChoiceValues(list.length ? list : ['(пока пусто)']);
    });
  }
  if (m.B) { var fb = FormApp.openById(m.B); set(fb, FT.B.concert, concerts); set(fb, FT.B.direction, dirs); }
  if (m.C) { var fc = FormApp.openById(m.C); set(fc, FT.C.number, nums); set(fc, FT.C.direction, dirs); }
}

function isAdmin_(email) {
  email = String(email || '').trim().toLowerCase();
  if (!email) return false;
  var ss = SpreadsheetApp.getActive(), list = [];
  try { ss.getEditors().forEach(function (u) { list.push(u.getEmail().toLowerCase()); }); } catch (e) { }
  try { var o = ss.getOwner(); if (o) list.push(o.getEmail().toLowerCase()); } catch (e2) { }
  try { list.push(Session.getEffectiveUser().getEmail().toLowerCase()); } catch (e3) { }
  return list.indexOf(email) !== -1;
}

function onFormSubmitCatalog(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var form = e.source, id = form.getId(), kind = null, m = formsMap_();
    Object.keys(m).forEach(function (k) { if (m[k] === id) kind = k; });
    if (!kind) return;
    var resp = e.response, email = resp.getRespondentEmail() || '', data = {};
    var titles = FT[kind], byTitle = {};
    Object.keys(titles).forEach(function (k) { byTitle[titles[k]] = k; });
    resp.getItemResponses().forEach(function (ir) {
      var key = byTitle[ir.getItem().getTitle()];
      if (key) data[key] = String(ir.getResponse() || '').trim();
    });
    var q = queueSheet_(), row = q.getLastRow() + 1;
    q.getRange(row, 1, 1, 7).setValues([[new Date(), email || 'неизвестно', KIND_NAME[kind], summary_(kind, data), '', WAIT, JSON.stringify({ kind: kind, data: data })]]);
    q.getRange(row, 1).setNumberFormat('dd.MM.yyyy HH:mm');
    if (isAdmin_(email)) applyQueueRow_(q, row, true);
    try { refreshFormChoices(); } catch (e4) { }
  } finally { lock.releaseLock(); }
}

function summary_(kind, d) {
  if (kind === 'A') return d.name + ' | ' + (d.date || 'без даты') + ' | ' + d.video + (d.about ? ' | ' + d.about : '');
  if (kind === 'B') return 'Концерт: ' + d.concert + (d.direction ? ' | ' + d.direction : '') + '\n' + d.list + (d.end ? '\nКонец последнего: ' + d.end : '');
  var parts = ['Номер: ' + d.number];
  [['direction', 'Направление'], ['collective', 'Коллектив'], ['performers', 'Исполнители'], ['directors', 'Постановщики'],
   ['about', 'Описание'], ['start', 'Начало'], ['end', 'Конец']].forEach(function (x) { if (d[x[0]]) parts.push(x[1] + ': ' + d[x[0]]); });
  return parts.join('\n');
}

// Принять или отклонить заявку по значению в столбце «Решение». direct = запись админа, принимается без решения.
function applyQueueRow_(q, row, direct) {
  var vals = q.getRange(row, 1, 1, 7).getValues()[0];
  var status = String(vals[5]);
  var decision = String(vals[4]).trim();
  if (status !== WAIT) return;
  if (!direct && decision !== 'Принять' && decision !== 'Отклонить') return;
  if (!direct && decision === 'Отклонить') { q.getRange(row, 6).setValue('Отклонено'); return; }
  var res;
  try {
    var job = JSON.parse(vals[6]);
    res = job.kind === 'A' ? applyConcert_(job.data) : job.kind === 'B' ? applyNumbers_(job.data) : applyPatch_(job.data);
  } catch (err) { res = { ok: false, msg: String(err && err.message || err) }; }
  q.getRange(row, 6).setValue(res.ok ? (direct ? 'Добавлено сразу: ' : 'Принято: ') + res.msg : 'Ошибка: ' + res.msg);
  if (!res.ok) q.getRange(row, 6).setBackground(RED);
  if (direct && !res.ok) q.getRange(row, 5).setValue('');
}

function applyDecisions() {
  var q = SpreadsheetApp.getActive().getSheetByName(QUEUE);
  if (!q) { SpreadsheetApp.getUi().alert('Листа «Заявки» ещё нет. Выберите Каталог → Формы для заполнения → Создать формы.'); return; }
  for (var r = 2; r <= q.getLastRow(); r++) applyQueueRow_(q, r, false);
  SpreadsheetApp.getActive().toast('Решения применены.', 'Каталог', 5);
}

function lastDataRow_(sh, colIdx) {
  var vals = sh.getRange(1, colIdx + 1, Math.max(sh.getLastRow(), 1), 1).getValues();
  for (var i = vals.length - 1; i >= 0; i--) if (String(vals[i][0]).trim()) return i + 1;
  return 1;
}

function addRows_(t, rowsByHead) {
  // rowsByHead: массив объектов {заголовок: значение}; пишем под последней строкой с названием
  var nameCol = t.head['Название'];
  var start = lastDataRow_(t.sh, nameCol) + 1;
  var width = t.sh.getLastColumn();
  var out = rowsByHead.map(function (o) {
    var row = new Array(width).fill('');
    Object.keys(o).forEach(function (h) { if (t.head[h] !== undefined) row[t.head[h]] = o[h]; });
    return row;
  });
  var rng = t.sh.getRange(start, 1, out.length, width);
  ['Начало', 'Конец', 'Дата', '№ в концерте', 'ID'].forEach(function (h) {
    if (t.head[h] !== undefined) t.sh.getRange(start, t.head[h] + 1, out.length, 1).setNumberFormat('@');
  });
  rng.setValues(out);
}

function hmsFull_(t) {
  var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  return h + ':' + ('0' + m).slice(-2) + ':' + ('0' + s).slice(-2);
}

function applyConcert_(d) {
  var name = String(d.name || '').trim();
  if (!name) return { ok: false, msg: 'нет названия концерта' };
  if (!/(video-?\d+_\d+|oid=-?\d+)/.test(String(d.video || ''))) return { ok: false, msg: 'ссылка не похожа на видео VK' };
  var t = readTable_(SHEETS.concerts);
  if (!t) return { ok: false, msg: 'нет листа «Концерты»' };
  var dup = t.rows.some(function (r) { return norm_(r[t.head['Название']]) === norm_(name); });
  if (dup) return { ok: false, msg: 'концерт «' + name + '» уже есть' };
  addRows_(t, [{ 'Название': name, 'Дата': d.date || '', 'Видео': d.video, 'Описание': d.about || '' }]);
  fillIds_();
  return { ok: true, msg: 'концерт «' + name + '»' };
}

function applyNumbers_(d) {
  var tc = readTable_(SHEETS.concerts), tn = readTable_(SHEETS.nums);
  if (!tc || !tn) return { ok: false, msg: 'нет листа «Концерты» или «Номера»' };
  var concert = null;
  tc.rows.forEach(function (r) { if (norm_(r[tc.head['Название']]) === norm_(d.concert)) concert = String(r[tc.head['Название']]).trim(); });
  if (!concert) return { ok: false, msg: 'концерта «' + d.concert + '» нет в таблице' };
  var items = [], bad = [];
  String(d.list || '').split(/\r?\n/).forEach(function (line) {
    if (!line.trim()) return;
    var m = line.match(/^\s*(?:[-–—•*]\s*|\d+[.)]\s+)?((?:\d{1,2}:)?\d{1,2}:\d{2})\s*[-–—:.)]*\s*(.+?)\s*$/);
    var sec = m ? parseSec_(m[1]) : null;
    if (!m || sec === null) bad.push(line.trim()); else items.push({ start: sec, title: m[2] });
  });
  if (bad.length) return { ok: false, msg: 'не понял строки: ' + bad.slice(0, 3).join(' / ') + (bad.length > 3 ? '…' : '') };
  if (!items.length) return { ok: false, msg: 'в списке нет номеров' };
  items.sort(function (a, b) { return a.start - b.start; });
  var lastEnd = d.end ? parseSec_(d.end) : null;
  if (d.end && lastEnd === null) return { ok: false, msg: 'время окончания нужно в виде ч:мм:сс' };
  var have = {};
  tn.rows.forEach(function (r) { if (norm_(r[tn.head['Концерт']]) === norm_(concert)) have[parseSec_(r[tn.head['Начало']])] = true; });
  var rows = [], skipped = 0;
  items.forEach(function (it, i) {
    if (have[it.start]) { skipped++; return; }
    var end = i + 1 < items.length ? items[i + 1].start : lastEnd;
    rows.push({ 'Концерт': concert, 'Направление': d.direction && d.direction !== '(пока пусто)' ? d.direction : '', 'Название': it.title,
      'Начало': hmsFull_(it.start), 'Конец': end !== null && end > it.start ? hmsFull_(end) : '' });
  });
  if (rows.length) { addRows_(tn, rows); fillIds_(); }
  return { ok: true, msg: 'номеров: ' + rows.length + (skipped ? ', пропущено уже существующих: ' + skipped : '') };
}

function applyPatch_(d) {
  var tn = readTable_(SHEETS.nums);
  if (!tn) return { ok: false, msg: 'нет листа «Номера»' };
  var id = String(d.number || '').split(' — ')[0].trim();
  var idCol = tn.head['ID'], rowIdx = -1;
  tn.rows.forEach(function (r, i) { if (String(r[idCol]).trim() === id) rowIdx = i; });
  if (rowIdx < 0) return { ok: false, msg: 'номер «' + id + '» не найден' };
  var map = { direction: 'Направление', collective: 'Коллектив', performers: 'Исполнители', directors: 'Постановщики', about: 'Описание', start: 'Начало', end: 'Конец' };
  var changed = [];
  var upd = {};
  Object.keys(map).forEach(function (k) {
    var v = String(d[k] || '').trim();
    if (!v || v === '(пока пусто)') return;
    if ((k === 'start' || k === 'end') && parseSec_(v) === null) { upd.err = 'время «' + v + '» нужно в виде ч:мм:сс'; return; }
    if (k === 'start' || k === 'end') v = hmsFull_(parseSec_(v));
    upd[map[k]] = v;
  });
  if (upd.err) return { ok: false, msg: upd.err };
  Object.keys(upd).forEach(function (h) {
    var c = tn.head[h]; if (c === undefined) return;
    var cell = tn.sh.getRange(rowIdx + 2, c + 1);
    if (h === 'Начало' || h === 'Конец') cell.setNumberFormat('@');
    cell.setValue(upd[h]); changed.push(h);
  });
  if (!changed.length) return { ok: false, msg: 'ничего не заполнено' };
  try { collectPeople(); } catch (e) { }
  return { ok: true, msg: id + ': ' + changed.join(', ').toLowerCase() };
}

