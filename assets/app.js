/* Каталог номеров СоцГума: фильтры и сортировка на главной, плеер VK с метками времени на странице номера.
   Без библиотек. Если скрипт не загрузился, каталог и страницы всё равно читаются. */
(function () {
  "use strict";

  function norm(s) {
    return String(s || "").trim().replace(/\s+/g, " ").toLowerCase().replace(/ё/g, "е");
  }
  /* для поиска: без регистра, «ё» = «е», «й» = «и» */
  function ruPlural(n, one, few, many) { var a = n % 10, b = n % 100; return a === 1 && b !== 11 ? one : (a >= 2 && a <= 4 && !(b >= 12 && b <= 14) ? few : many); }
  function nrm2(s) { return norm(s).replace(/й/g, "и"); }
  /* расстояние Дамерау — Левенштейна с остановкой, когда оно уже больше max */
  function lev(a, b, max) {
    var la = a.length, lb = b.length, i, j;
    if (Math.abs(la - lb) > max) return max + 1;
    var p2 = null, p = [], c = [];
    for (j = 0; j <= lb; j++) p[j] = j;
    for (i = 1; i <= la; i++) {
      c = [i]; var rowMin = i;
      for (j = 1; j <= lb; j++) {
        var v = Math.min(p[j] + 1, c[j - 1] + 1, p[j - 1] + (a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1));
        if (i > 1 && j > 1 && a.charAt(i - 1) === b.charAt(j - 2) && a.charAt(i - 2) === b.charAt(j - 1)) v = Math.min(v, p2[j - 2] + 1);
        c[j] = v; if (v < rowMin) rowMin = v;
      }
      if (rowMin > max) return max + 1;
      p2 = p; p = c;
    }
    return p[lb];
  }
  /* слово запроса похоже на слово из каталога с опечаткой (короткие слова ищутся только точно) */
  function nearWord(w, t) {
    var k = w.length >= 9 ? 2 : (w.length >= 5 ? 1 : 0);
    if (!k) return false;
    if (lev(w, t, k) <= k) return true;
    return t.length > w.length && lev(w, t.slice(0, w.length), k) <= k;
  }
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ------------------------------------------------------------ главная: фильтры */
  var grid = document.getElementById("grid");
  if (grid && document.getElementById("q")) initCatalog();
  // на телефоне список участников свёрнут, на компьютере раскрыт
  var fold = document.getElementById("performers");
  if (fold && window.matchMedia && window.matchMedia("(max-width:820px)").matches) fold.removeAttribute("open");

  function initCatalog() {
    var PAGE = 16;   // сколько номеров показываем сразу и сколько добавляет «Показать ещё»
    var cards = Array.prototype.slice.call(grid.children);
    var qInput = document.getElementById("q");
    var sortSel = document.getElementById("sort");
    var selType = document.getElementById("f-type");
    var selSeason = document.getElementById("f-season");
    var selConcert = document.getElementById("f-concert");
    var selDir = document.getElementById("f-direction");
    var count = document.getElementById("count");
    var empty = document.getElementById("empty");
    var more = document.getElementById("more");
    var panels = Array.prototype.slice.call(document.querySelectorAll(".concert-panel"));
    var total = cards.length;
    var params = new URLSearchParams(location.search);
    var state = { q: params.get("q") || "", t: params.get("t") || "", y: params.get("y") || "", c: params.get("c") || "", d: params.get("d") || "", s: params.get("s") || "new" };
    if (!/^(new|concert|title|collective)$/.test(state.s)) state.s = "new";
    var shown = PAGE;

    cards.forEach(function (c) {
      c._search = nrm2(c.dataset.search); c._dirs = (c.dataset.direction || "").split(" ");
      c._tokens = c._search.split(/[^a-zа-я0-9]+/).filter(function (t, i, a) { return t && a.indexOf(t) === i; });
    });

    /* Группа «Фильтры»: открыта или свёрнута — запоминается в браузере */
    var group = document.getElementById("filter-group");
    var KEY = "sg:filters-open";
    if (group) {
      var saved = null;
      try { saved = window.localStorage.getItem(KEY); } catch (e) { }
      if (saved === "1") group.open = true;
      group.addEventListener("toggle", function () { try { window.localStorage.setItem(KEY, group.open ? "1" : "0"); } catch (e) { } });
    }

    /* Концерты в списке: только выбранного типа и учебного года */
    var concertOpts = selConcert ? Array.prototype.slice.call(selConcert.options).slice(1) : [];
    function syncConcertList() {
      if (!selConcert) return;
      concertOpts.forEach(function (o) {
        var ok = (!state.y || o.dataset.season === state.y) && (!state.t || o.dataset.type === state.t);
        o.hidden = !ok; o.disabled = !ok;
      });
      var cur = concertOpts.filter(function (o) { return o.value === state.c; })[0];
      if (state.c && (!cur || cur.disabled)) state.c = "";
      selConcert.value = state.c;
    }

    /* Направления: только те, что есть в выбранных типе, годе и концерте */
    var dirOpts = selDir ? Array.prototype.slice.call(selDir.querySelectorAll("option")).slice(1) : [];
    function syncDirList() {
      if (!selDir) return;
      var have = {};
      cards.forEach(function (card) {
        if (state.t && card.dataset.type !== state.t) return;
        if (state.y && card.dataset.season !== state.y) return;
        if (state.c && card.dataset.concert !== state.c) return;
        card._dirs.forEach(function (d) { have[d] = true; });
      });
      dirOpts.forEach(function (o) { var ok = !!have[o.value]; o.hidden = !ok; o.disabled = !ok; });
      Array.prototype.forEach.call(selDir.querySelectorAll("optgroup"), function (g) {
        g.hidden = !Array.prototype.some.call(g.querySelectorAll("option"), function (o) { return !o.disabled; });
      });
      if (state.d && !have[state.d]) state.d = "";
      selDir.value = state.d;
    }

    function matches(card) {
      if (state.t && card.dataset.type !== state.t) return false;
      if (state.y && card.dataset.season !== state.y) return false;
      if (state.c && card.dataset.concert !== state.c) return false;
      if (state.d && card._dirs.indexOf(state.d) === -1) return false;
      if (state.q) {
        var words = nrm2(state.q).split(" ");
        for (var i = 0; i < words.length; i++) {
          var w = words[i];
          if (card._search.indexOf(w) !== -1) continue;
          if (!card._tokens.some(function (t) { return nearWord(w, t); })) return false;
        }
      }
      return true;
    }

    function sortKey(card) {
      if (state.s === "title") return norm(card.dataset.title);
      if (state.s === "collective") return norm(card.dataset.collective) || "я";
      return null;
    }

    function apply(pushUrl, keepShown) {
      if (!keepShown) shown = PAGE;
      syncConcertList();
      syncDirList();
      var ordered = cards.slice().sort(function (a, b) {
        if (state.s === "new") return (+b.dataset.row) - (+a.dataset.row);   // чем ниже строка в таблице, тем новее номер
        var ka = sortKey(a), kb = sortKey(b);
        if (ka === null) return (+a.dataset.order) - (+b.dataset.order);
        return ka < kb ? -1 : ka > kb ? 1 : (+a.dataset.order) - (+b.dataset.order);
      });
      var visible = 0, drawn = 0;
      ordered.forEach(function (card) {
        var ok = matches(card);
        if (ok) visible++;
        var show = ok && drawn < shown;
        if (show) drawn++;
        card.hidden = !show;
        grid.appendChild(card);
      });

      var nSel = (state.t ? 1 : 0) + (state.y ? 1 : 0) + (state.c ? 1 : 0) + (state.d ? 1 : 0);
      var filtered = state.q || nSel;
      var badge = document.getElementById("filter-n");
      if (badge) { badge.hidden = !nSel; badge.textContent = nSel ? String(nSel) : ""; }
      count.textContent = filtered ? "Найдено: " + visible + " из " + total : "Номеров: " + total;
      var left = visible - drawn;
      if (more) {
        more.hidden = left <= 0;
        more.textContent = "Показать ещё" + (left > 0 ? " (" + Math.min(PAGE, left) + " из " + left + ")" : "");
      }
      document.body.classList.toggle("is-filtered", !!filtered);
      var resetBtn = document.querySelector(".linkbtn[data-reset]");
      if (resetBtn) resetBtn.hidden = !filtered;
      empty.hidden = visible !== 0;
      grid.hidden = visible === 0;
      /* запрос совпал с концертом, у которого ещё нет номеров: подсказываем, что концерт есть */
      var ec = document.getElementById("empty-concerts");
      if (ec) {
        ec.hidden = true; while (ec.firstChild) ec.removeChild(ec.firstChild);
        if (visible === 0 && state.q && selConcert) {
          var ws = nrm2(state.q).split(" ").filter(Boolean);
          concertOpts.forEach(function (o) {
            var hay = nrm2((o.dataset.label || "") + " " + (o.dataset.topic || ""));
            if ((+o.dataset.n || 0) > 0 || !ws.length || !ws.every(function (w) { return hay.indexOf(w) !== -1; })) return;
            var b = document.createElement("button"); b.type = "button"; b.className = "linkbtn";
            b.textContent = "Концерт «" + (o.dataset.label || o.textContent.trim()) + "» есть в каталоге, но номеров в нём пока нет. Открыть концерт";
            b.addEventListener("click", function () { state.q = ""; qInput.value = ""; state.t = ""; state.y = ""; state.c = o.value; apply(true); });
            var p = document.createElement("p"); p.appendChild(b); ec.appendChild(p); ec.hidden = false;
          });
        }
      }

      /* Карточка выбранного концерта: обложка, тема, ссылка на запись */
      panels.forEach(function (p) {
        p.hidden = p.dataset.concert ? !(state.c && p.dataset.concert === state.c) : !(state.d && p.dataset.direction === state.d);
      });

      if (selType) selType.value = state.t;
      if (selSeason) selSeason.value = state.y;
      if (selDir) selDir.value = state.d;
      if (pushUrl) {
        var p = new URLSearchParams();
        if (state.q) p.set("q", state.q);
        if (state.t) p.set("t", state.t);
        if (state.y) p.set("y", state.y);
        if (state.c) p.set("c", state.c);
        if (state.d) p.set("d", state.d);
        if (state.s !== "new") p.set("s", state.s);
        var qs = p.toString();
        try { history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "")); } catch (e) { /* file:// */ }
      }
    }

    qInput.value = state.q;
    sortSel.value = state.s;
    var timer;
    qInput.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () { state.q = qInput.value; apply(true); }, 120);
    });
    sortSel.addEventListener("change", function () { state.s = sortSel.value; apply(true); });
    if (selType) selType.addEventListener("change", function () { state.t = selType.value; apply(true); });
    if (selSeason) selSeason.addEventListener("change", function () { state.y = selSeason.value; apply(true); });
    if (selConcert) selConcert.addEventListener("change", function () {
      state.c = selConcert.value;
      apply(true);
    });
    if (selDir) selDir.addEventListener("change", function () { state.d = selDir.value; apply(true); });
    if (more) more.addEventListener("click", function () { shown += PAGE; apply(false, true); });
    document.querySelectorAll("[data-reset]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.q = ""; state.t = ""; state.y = ""; state.c = ""; state.d = "";
        qInput.value = "";
        apply(true);
      });
    });

    /* ---- подсказки и недавние запросы: всё из страницы и из памяти устройства, сервис не используется */
    (function suggest() {
      var box = document.getElementById("sugg"), KEY = "sg:recent", MONTH = 30 * 86400e3, MAXR = 8, MAXS = 10;
      if (!box) return;
      var people = []; try { people = JSON.parse(document.getElementById("people-json").textContent) || []; } catch (e) { }
      var items = [], seen = {};
      function add(kind, label, extra) {
        var k = kind + "|" + nrm2(label) + "|" + nrm2((extra && extra.sub) || "");
        if (!label || seen[k]) return; seen[k] = 1;
        var hay = nrm2(label + " " + ((extra && extra.hay) || ""));
        var o = { kind: kind, label: label, key: hay, toks: hay.split(/[^a-zа-я0-9]+/).filter(Boolean) };
        for (var x in extra) o[x] = extra[x];
        items.push(o);
      }
      /* направления: на сцене и вне сцены */
      if (selDir) Array.prototype.forEach.call(selDir.querySelectorAll("option"), function (o) {
        if (o.value) add("Направление", o.textContent.trim(), { dir: o.value, sub: "все концерты" });
      });
      cards.forEach(function (c) {
        var a = c.querySelector(".card-link");
        /* работа направления вне сцены (SMM, сценарка, админка…) подписывается как направление, а не как номер */
        add(c.dataset.off ? "Направление" : "Номер", c.dataset.title, { href: a ? a.getAttribute("href") : "", sub: c.dataset.cname || "" });
      });
      people.forEach(function (p) { add("Человек", p.n, { href: "p/" + p.s + "/" }); });
      cards.forEach(function (c) { add("Коллектив", c.dataset.collective, {}); });
      if (selConcert) Array.prototype.forEach.call(selConcert.options, function (o) {
        if (!o.value) return;
        var n = +o.dataset.n || 0;
        add("Концерт", o.dataset.label || o.textContent.trim(), { concert: o.value, n: n, hay: o.dataset.topic || "",
          sub: (o.dataset.topic ? o.dataset.topic + ", " : "") + (n ? n + " " + ruPlural(n, "номер", "номера", "номеров") : "номеров пока нет") });
      });
      var KIND_RANK = { "Направление": 0, "Номер": 1, "Человек": 2, "Коллектив": 3, "Концерт": 4 };
      var KIND_CAP = { "Направление": 3, "Номер": 4, "Человек": 3, "Коллектив": 2, "Концерт": 4 };

      function recents() {
        var r = []; try { r = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch (e) { }
        var now = Date.now(); return r.filter(function (x) { return x && x.q && now - x.t < MONTH; });
      }
      function saveRecent(q) {
        q = String(q || "").trim().replace(/\s+/g, " ");
        if (q.length < 3) return;
        var r = recents().filter(function (x) { return nrm2(x.q) !== nrm2(q); });
        r.unshift({ q: q, t: Date.now() });
        try { localStorage.setItem(KEY, JSON.stringify(r.slice(0, MAXR))); } catch (e) { }
      }
      function clearRecents() { try { localStorage.removeItem(KEY); } catch (e) { } }

      function score(it, words) {
        var total = 0;
        for (var i = 0; i < words.length; i++) {
          var w = words[i], s;
          if (it.key.indexOf(w) === 0) s = 0;
          else if (it.toks.some(function (t) { return t.indexOf(w) === 0; })) s = 1;
          else if (it.key.indexOf(w) !== -1) s = 2;
          else if (it.toks.some(function (t) { return nearWord(w, t); })) s = 3;
          else return -1;
          total += s;
        }
        return total;
      }
      var list = [], active = -1, open = false;
      function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
      function close() { open = false; box.hidden = true; qInput.setAttribute("aria-expanded", "false"); qInput.removeAttribute("aria-activedescendant"); active = -1; }
      function setActive(i) {
        var nodes = box.querySelectorAll(".sg-item");
        if (!nodes.length) return;
        active = (i + nodes.length) % nodes.length;
        Array.prototype.forEach.call(nodes, function (n, k) { n.classList.toggle("is-on", k === active); n.setAttribute("aria-selected", k === active ? "true" : "false"); });
        qInput.setAttribute("aria-activedescendant", nodes[active].id);
        nodes[active].scrollIntoView({ block: "nearest" });
      }
      function pick(it) {
        saveRecent(it.label);
        close();
        if (it.href && it.kind !== "Коллектив") { location.href = it.href; return; }
        if (it.dir) { state.q = ""; qInput.value = ""; state.t = ""; state.y = ""; state.c = ""; state.d = it.dir; apply(true); return; }
        if (it.concert) { state.q = ""; qInput.value = ""; state.t = ""; state.y = ""; state.c = it.concert; if (selConcert) selConcert.value = it.concert; apply(true); return; }
        qInput.value = it.label; state.q = it.label; apply(true);
      }
      function render() {
        var v = qInput.value.trim(), words = nrm2(v).split(" ").filter(Boolean);
        clear();
        list = [];
        if (!words.length) {
          var r = recents();
          if (!r.length) { close(); return; }
          var head = el("div", "sg-head");
          head.append(el("span", "", "Недавние запросы"));
          var clr = el("button", "sg-clear", "Очистить"); clr.type = "button";
          clr.addEventListener("mousedown", function (e) { e.preventDefault(); clearRecents(); close(); });
          head.append(clr); box.append(head);
          r.forEach(function (x) { list.push({ kind: "Недавнее", label: x.q }); });
        } else {
          var scored = [];
          items.forEach(function (it) { var s = score(it, words); if (s >= 0) scored.push([s, KIND_RANK[it.kind], it]); });
          scored.sort(function (a, b) { return a[0] - b[0] || a[1] - b[1] || (b[2].n > 0) - (a[2].n > 0) || a[2].label.localeCompare(b[2].label, "ru"); });
          var used = {};
          list = scored.filter(function (x) { var k = x[2].kind; used[k] = (used[k] || 0) + 1; return used[k] <= KIND_CAP[k]; }).slice(0, MAXS).map(function (x) { return x[2]; });
          if (!list.length) { close(); return; }
        }
        list.forEach(function (it, i) {
          var n = el("div", "sg-item"); n.id = "sg-" + i; n.setAttribute("role", "option"); n.setAttribute("aria-selected", "false");
          n.append(el("span", "sg-kind", it.kind), el("span", "sg-text", it.label), it.sub ? el("span", "sg-sub", it.sub) : document.createTextNode(""));
          n.addEventListener("mousedown", function (e) { e.preventDefault(); pick(it); });
          box.append(n);
        });
        open = true; box.hidden = false; qInput.setAttribute("aria-expanded", "true"); active = -1;
      }
      function clear() { while (box.firstChild) box.removeChild(box.firstChild); }
      qInput.addEventListener("input", render);
      qInput.addEventListener("focus", render);
      qInput.addEventListener("blur", function () { saveRecent(qInput.value); setTimeout(close, 120); });
      qInput.addEventListener("keydown", function (e) {
        if (e.key === "ArrowDown") { if (!open) render(); else setActive(active + 1); e.preventDefault(); }
        else if (e.key === "ArrowUp" && open) { setActive(active < 0 ? -1 : active - 1); e.preventDefault(); }
        else if (e.key === "Enter") {
          if (open && active >= 0 && list[active]) { e.preventDefault(); pick(list[active]); }
          else { saveRecent(qInput.value); close(); }
        } else if (e.key === "Escape" && open) { close(); e.stopPropagation(); }
      });
    })();

    /* Значок поиска в шапке: на главной переводит в поле поиска, на других страницах ведёт на главную */
    function focusSearch() {
      qInput.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
      setTimeout(function () { try { qInput.focus({ preventScroll: true }); } catch (e) { qInput.focus(); } }, reduceMotion ? 0 : 250);
    }
    var sBtn = document.querySelector(".head-search");
    if (sBtn) sBtn.addEventListener("click", function (e) { e.preventDefault(); focusSearch(); });
    if (location.hash === "#search") { try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { } focusSearch(); }

    apply(false);
  }

  /* ------------------------------------------------------------ страница номера: плеер */
  var stage = document.getElementById("stage");
  if (stage && stage.dataset.oid) initPlayer(stage);

  function initPlayer(stage) {
    var iframe = null, vk = null, vkApiState = 0; // 0 нет, 1 грузится, 2 готов

    function src(sec) {
      var u = "https://" + stage.dataset.host + "/video_ext.php?oid=" + stage.dataset.oid + "&id=" + stage.dataset.vid;
      if (stage.dataset.hash) u += "&hash=" + stage.dataset.hash;
      u += "&hd=2&autoplay=1&js_api=1";
      if (sec > 0) u += "&t=" + sec;
      return u;
    }

    function loadApi(then) {
      if (window.VK && window.VK.VideoPlayer) { vkApiState = 2; return then(); }
      if (vkApiState === 1) return;
      vkApiState = 1;
      var s = document.createElement("script");
      s.src = "https://vk.com/js/api/videoplayer.js";
      s.onload = function () { vkApiState = 2; then(); };
      s.onerror = function () { vkApiState = 0; };
      document.head.appendChild(s);
    }

    function bindApi() {
      loadApi(function () {
        try { vk = window.VK.VideoPlayer(iframe); } catch (e) { vk = null; }
      });
    }

    function playAt(sec) {
      sec = Math.max(0, parseInt(sec, 10) || 0);
      if (!iframe) {
        iframe = document.createElement("iframe");
        iframe.src = src(sec);
        iframe.title = "Запись концерта";
        iframe.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture";
        iframe.setAttribute("allowfullscreen", "");
        iframe.addEventListener("load", bindApi, { once: true });
        stage.appendChild(iframe);
        var btn = stage.querySelector(".play");
        if (btn) btn.hidden = true;
      } else if (vk) {
        try { vk.seek(sec); vk.play(); } catch (e) { iframe.src = src(sec); }
      } else {
        iframe.src = src(sec); // запасной путь: перезапуск плеера с нужной секунды
      }
      stage.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });
    }

    /* Одна обработка на весь документ: кнопки со временем появляются и позже (в комментариях). */
    document.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("button[data-t]");
      if (b) playAt(b.dataset.t);
    });

    /* Ссылка с временем открывает номер сразу с нужного места: ?t=135, ?t=2:15, ?t=1h2m3s или #t=2:15.
       Время считается по записи концерта целиком, как в плеере. */
    var want = new URLSearchParams(location.search).get("t") || (location.hash.match(/^#t=(.+)$/) || [])[1];
    var sec = parseTime(want);
    if (sec !== null) playAt(sec);
  }

  function parseTime(v) {
    if (!v) return null;
    v = String(v).trim();
    var m;
    if ((m = v.match(/^(\d+)$/))) return +m[1];
    if ((m = v.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/))) return (+m[1] || 0) * 3600 + (+m[2]) * 60 + (+m[3]);
    if ((m = v.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/)) && (m[1] || m[2] || m[3])) return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
    return null;
  }
})();

/* Доп. материалы: фото-галерея (листается свайпом, кнопками и стрелками) и просмотр на весь экран */
(function () {
  function init(g) {
    var track = g.querySelector(".gal-track");
    if (!track || g.dataset.ready) return;
    g.dataset.ready = "1";
    var items = track.querySelectorAll(".gal-item");
    var prev = g.querySelector(".gal-prev"), next = g.querySelector(".gal-next"), cnt = g.querySelector(".gal-count");
    function cur() { var w = track.clientWidth || 1; return Math.max(0, Math.min(items.length - 1, Math.round(track.scrollLeft / w))); }
    function show() {
      var i = cur();
      if (cnt) cnt.textContent = (i + 1) + " / " + items.length;
      if (prev) prev.hidden = i === 0;
      if (next) next.hidden = i >= items.length - 1;
    }
    function go(d) { track.scrollTo({ left: (cur() + d) * track.clientWidth, behavior: "smooth" }); }
    var raf;
    track.addEventListener("scroll", function () { cancelAnimationFrame(raf); raf = requestAnimationFrame(show); }, { passive: true });
    if (prev) prev.addEventListener("click", function () { go(-1); });
    if (next) next.addEventListener("click", function () { go(1); });
    track.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") { go(-1); e.preventDefault(); }
      if (e.key === "ArrowRight") { go(1); e.preventDefault(); }
    });
    track.addEventListener("click", function (e) {
      var img = e.target.closest && e.target.closest("img");
      if (img) big(img);
    });
    window.addEventListener("resize", show);
    show();
  }
  function big(img) {
    var box = document.createElement("div");
    box.className = "lightbox";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-label", "Фото на весь экран");
    var im = document.createElement("img");
    im.src = img.currentSrc || img.src;
    im.alt = img.alt;
    var x = document.createElement("button");
    x.type = "button"; x.className = "lightbox-x"; x.setAttribute("aria-label", "Закрыть"); x.textContent = "\u00d7";
    box.appendChild(im); box.appendChild(x);
    function close() { box.remove(); document.removeEventListener("keydown", key); }
    function key(e) { if (e.key === "Escape") close(); }
    box.addEventListener("click", close);
    document.addEventListener("keydown", key);
    document.body.appendChild(box);
    x.focus();
  }
  function all() { document.querySelectorAll("[data-gal]").forEach(init); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", all); else all();
})();
