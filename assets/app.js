/* Каталог номеров СоцГума: фильтры и сортировка на главной, плеер VK с метками времени на странице номера.
   Без библиотек. Если скрипт не загрузился, каталог и страницы всё равно читаются. */
(function () {
  "use strict";

  function norm(s) {
    return String(s || "").trim().replace(/\s+/g, " ").toLowerCase().replace(/ё/g, "е");
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

    cards.forEach(function (c) { c._search = norm(c.dataset.search); c._dirs = (c.dataset.direction || "").split(" "); });

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
        var words = norm(state.q).split(" ");
        for (var i = 0; i < words.length; i++) if (card._search.indexOf(words[i]) === -1) return false;
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
      var resetBtn = document.querySelector(".linkbtn[data-reset]");
      if (resetBtn) resetBtn.hidden = !filtered;
      empty.hidden = visible !== 0;
      grid.hidden = visible === 0;

      /* Карточка выбранного концерта: обложка, тема, ссылка на запись */
      panels.forEach(function (p) { p.hidden = !(state.c && p.dataset.concert === state.c); });

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
