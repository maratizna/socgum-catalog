/* Плейлист концерта: карточка с обложкой и кнопкой «Включить».
   Платформа (ВКонтакте / Яндекс Музыка / SoundCloud) подгружается только после нажатия —
   до этого ни одного внешнего запроса. Без JS остаётся только ссылка, которую подставляет сборка. */
(function () {
  "use strict";

  var SDK_VK = "https://vk.ru/js/api/openapi.js?169";
  var loaded = {};

  function loadScript(src) {
    if (!loaded[src]) {
      loaded[src] = new Promise(function (res, rej) {
        var s = document.createElement("script");
        s.src = src; s.async = true;
        s.onload = res;
        s.onerror = function () { rej(new Error("не загрузился")); };
        document.head.appendChild(s);
      });
    }
    return loaded[src];
  }

  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "class") n.className = attrs[k];
      else if (k === "text") n.textContent = attrs[k];
      else if (attrs[k] === true) n.setAttribute(k, "");
      else if (attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { if (c != null) n.appendChild(c); });
    return n;
  }

  function note(host, text) {
    host.appendChild(el("p", { class: "pl-note", text: text }));
  }

  /* плеер не загрузился или источник не встраивается — остаётся кнопка-ссылка */
  function openLink(btn, url, label) {
    btn.textContent = label;
    btn.disabled = false;
    btn.addEventListener("click", function () { window.open(url, "_blank", "noopener"); });
  }

  function start(host, card, data, btn) {
    if (card._started) return;
    card._started = true;
    btn.disabled = true; btn.textContent = "Загружаем…";
    var frame = el("div", { class: "pl-frame" });

    if (data.kind === "vk-playlist") {
      var id = "vk_pl_" + data.owner + "_" + data.playlist;
      frame.appendChild(el("div", { id: id }));
      host.appendChild(frame);
      loadScript(SDK_VK).then(function () {
        window.VK.Widgets.Playlist(id, data.owner, data.playlist, data.hash || "", {});
        btn.remove();
        note(host, "Плеер ВКонтакте: первые пять треков играют здесь, остальные — на vk.ru.");
      }, function () {
        openLink(btn, data.url, "Открыть во ВКонтакте");
        note(host, "Не удалось загрузить плеер ВКонтакте.");
      });
      return;
    }
    if (data.kind === "yandex-album") {
      frame.appendChild(el("iframe", {
        src: "https://music.yandex.ru/iframe/#album/" + data.album,
        class: "pl-frame", width: "100%", height: "250", frameborder: "0", title: "Плейлист Яндекс Музыки"
      }));
      host.appendChild(frame);
      btn.remove();
      note(host, "Плеер Яндекс Музыки.");
      return;
    }
    if (data.kind === "sc-set") {
      frame.appendChild(el("iframe", {
        src: "https://w.soundcloud.com/player/?url=" + encodeURIComponent(data.url) + "&color=%23ff8b36&auto_play=false&visual=true",
        class: "pl-frame", width: "100%", height: "300", frameborder: "0", scrolling: "no", title: "Плейлист SoundCloud"
      }));
      host.appendChild(frame);
      btn.remove();
      note(host, "Плеер SoundCloud.");
      return;
    }
    openLink(btn, data.url, "Открыть плейлист");
  }

  function mount(host) {
    var data;
    try { data = JSON.parse(host.dataset.pl || "null"); } catch (e) { return; }
    if (!data || !data.kind) return;
    var cover = host.dataset.cover || "";
    var card = el("div", { class: "pl-card" });
    if (cover) card.appendChild(el("img", { class: "pl-cover", src: cover, alt: "", loading: "lazy", decoding: "async", referrerpolicy: "no-referrer" }));
    var body = el("div", { class: "pl-body" });
    body.appendChild(el("p", { class: "pl-title", text: "Плейлист концерта" }));
    body.appendChild(el("p", { class: "pl-src", text: data.label || "Музыка" }));
    var btn = el("button", { type: "button", class: "add-btn add-btn-s", text: "Включить плейлист" });
    btn.addEventListener("click", function () { start(host, card, data, btn); });
    body.appendChild(btn);
    card.appendChild(body);
    host.appendChild(card);
  }

  function all() { document.querySelectorAll(".pl-concert").forEach(mount); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", all); else all();
})();
