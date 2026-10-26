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

  function initCatalog() {
    var cards = Array.prototype.slice.call(grid.children);
    var qInput = document.getElementById("q");
    var sortSel = document.getElementById("sort");
    var count = document.getElementById("count");
    var empty = document.getElementById("empty");
    var total = cards.length;
    var params = new URLSearchParams(location.search);
    var state = { q: params.get("q") || "", c: params.get("c") || "", d: params.get("d") || "", s: params.get("s") || "concert" };
    if (!/^(concert|title|collective)$/.test(state.s)) state.s = "concert";

    cards.forEach(function (c) { c._search = norm(c.dataset.search); });

    function matches(card) {
      if (state.c && card.dataset.concert !== state.c) return false;
      if (state.d && card.dataset.direction !== state.d) return false;
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

    function apply(pushUrl) {
      var visible = 0;
      cards.forEach(function (card) {
        var ok = matches(card);
        card.hidden = !ok;
        if (ok) visible++;
      });
      var ordered = cards.slice().sort(function (a, b) {
        var ka = sortKey(a), kb = sortKey(b);
        if (ka === null) return (+a.dataset.order) - (+b.dataset.order);
        return ka < kb ? -1 : ka > kb ? 1 : (+a.dataset.order) - (+b.dataset.order);
      });
      ordered.forEach(function (c) { grid.appendChild(c); });

      var filtered = state.q || state.c || state.d;
      count.textContent = filtered ? "Найдено: " + visible + " из " + total : "Номеров: " + total;
      empty.hidden = visible !== 0;
      document.querySelector(".linkbtn[data-reset]").hidden = !filtered;
      grid.hidden = visible === 0;

      document.querySelectorAll(".chips").forEach(function (group) {
        var key = group.dataset.group;
        group.querySelectorAll(".chip").forEach(function (chip) {
          chip.setAttribute("aria-pressed", String(chip.dataset.value === state[key]));
        });
      });
      if (pushUrl) {
        var p = new URLSearchParams();
        if (state.q) p.set("q", state.q);
        if (state.c) p.set("c", state.c);
        if (state.d) p.set("d", state.d);
        if (state.s !== "concert") p.set("s", state.s);
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
    document.querySelectorAll(".chips").forEach(function (group) {
      group.addEventListener("click", function (e) {
        var chip = e.target.closest(".chip");
        if (!chip) return;
        state[group.dataset.group] = chip.dataset.value;
        apply(true);
      });
    });
    document.querySelectorAll("[data-reset]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.q = ""; state.c = ""; state.d = "";
        qInput.value = "";
        apply(true);
      });
    });

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
