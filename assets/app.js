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
    var segs = Array.prototype.slice.call(document.querySelectorAll(".seg"));
    var segById = {};
    segs.forEach(function (s) { segById[s.dataset.id] = s; });
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
        var seg = segById[card.dataset.id];
        if (seg) seg.classList.toggle("off", !ok);
      });
      var ordered = cards.slice().sort(function (a, b) {
        var ka = sortKey(a), kb = sortKey(b);
        if (ka === null) return (+a.dataset.order) - (+b.dataset.order);
        return ka < kb ? -1 : ka > kb ? 1 : (+a.dataset.order) - (+b.dataset.order);
      });
      ordered.forEach(function (c) { grid.appendChild(c); });

      document.querySelectorAll(".runsheet").forEach(function (r) {
        r.hidden = !!state.c && r.dataset.concert !== state.c;
      });
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

    /* карточка и её отрезок на шкале концерта подсвечиваются вместе */
    cards.forEach(function (card) {
      function on() { var s = segById[card.dataset.id]; if (s) s.classList.add("hot"); }
      function off() { var s = segById[card.dataset.id]; if (s) s.classList.remove("hot"); }
      card.addEventListener("pointerenter", on);
      card.addEventListener("pointerleave", off);
      card.addEventListener("focusin", on);
      card.addEventListener("focusout", off);
    });

    /* подсказка над отрезком шкалы */
    var tip = document.createElement("div");
    tip.className = "float-tip";
    tip.hidden = true;
    document.body.appendChild(tip);
    function showTip(seg) {
      tip.textContent = "";
      tip.appendChild(document.createTextNode(seg.dataset.tip));
      var sub = document.createElement("small");
      sub.textContent = seg.dataset.tipSub;
      tip.appendChild(sub);
      tip.hidden = false;
      var r = seg.getBoundingClientRect();
      var w = tip.offsetWidth;
      var left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
      tip.style.left = left + "px";
      tip.style.top = (r.top - tip.offsetHeight - 8) + "px";
    }
    segs.forEach(function (seg) {
      seg.addEventListener("pointerenter", function () { showTip(seg); });
      seg.addEventListener("pointerleave", function () { tip.hidden = true; });
      seg.addEventListener("focus", function () { showTip(seg); });
      seg.addEventListener("blur", function () { tip.hidden = true; });
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

    document.querySelectorAll("[data-t]").forEach(function (el) {
      if (el.tagName !== "BUTTON") return;
      el.addEventListener("click", function () {
        playAt(el.dataset.t);
        document.querySelectorAll(".cue[aria-current]").forEach(function (c) { c.removeAttribute("aria-current"); });
        var cue = document.querySelector('button.cue[data-t="' + el.dataset.t + '"]');
        if (cue) cue.setAttribute("aria-current", "true");
      });
    });
  }
})();
