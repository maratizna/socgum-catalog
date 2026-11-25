/* Просмотр фотографий на весь экран — одно окно для всего сайта:
   обложка концерта, фото номера, фото отзывов, аватарки.
   Листается кнопками, стрелками клавиатуры и свайпом, закрывается по Esc. */
/* Просмотр фотографий на весь экран: обложка номера, фото отзывов и фото номера.
   Одно окно для всего: картинка, автор (если нужен), счётчик и стрелки;
   листается кнопками, стрелками клавиатуры и свайпом. */
(function () {
  function gallery(items, start, opts) {
    items = (items || []).filter(function (it) { return it && it.url; });
    if (!items.length) return;
    opts = opts || {};
    var i = 0;
    var host = document.activeElement;

    var img = document.createElement("img");
    img.className = "lb-img";
    var who = document.createElement("span");
    who.className = "lb-who";
    var cnt = document.createElement("span");
    cnt.className = "lb-count";
    var prev = document.createElement("button");
    prev.type = "button"; prev.className = "lb-nav lb-prev";
    prev.setAttribute("aria-label", "Предыдущее фото"); prev.textContent = "\u2039";
    var next = document.createElement("button");
    next.type = "button"; next.className = "lb-nav lb-next";
    next.setAttribute("aria-label", "Следующее фото"); next.textContent = "\u203A";
    var x = document.createElement("button");
    x.type = "button"; x.className = "lb-x";
    x.setAttribute("aria-label", "Закрыть"); x.textContent = "\u00D7";

    var bar = document.createElement("div");
    bar.className = "lb-bar";
    var left = document.createElement("div");
    left.className = "lb-left"; left.appendChild(who);
    var right = document.createElement("div");
    right.className = "lb-right"; right.append(cnt, prev, next);
    bar.append(left, right);

    var box = document.createElement("div");
    box.id = "lb"; box.className = "lb";
    box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", "Фото");
    box.append(img, bar, x);

    function show(n) {
      i = (n + items.length) % items.length;
      var it = items[i];
      img.src = it.url;
      img.alt = it.alt || (it.author ? ("Фото: " + it.author) : "Фото");
      var author = opts.author ? (it.author || "") : "";
      who.textContent = author;
      who.hidden = !author;
      var many = items.length > 1;
      cnt.textContent = (many || opts.countAlways) ? ((i + 1) + " / " + items.length) : "";
      cnt.hidden = !cnt.textContent;
      prev.hidden = !many;
      next.hidden = !many;
    }
    function close() {
      box.remove();
      document.body.classList.remove("lb-on");
      document.removeEventListener("keydown", onKey);
      if (host && host.focus) { try { host.focus(); } catch (e) { } }
    }
    function go(step) { show(i + step); }
    function onKey(e) {
      if (e.key === "Escape") { close(); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); go(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); go(1); }
    }
    var sx = 0, sy = 0, tracking = false;
    box.addEventListener("pointerdown", function (e) { tracking = true; sx = e.clientX; sy = e.clientY; });
    box.addEventListener("pointerup", function (e) {
      if (!tracking) return;
      tracking = false;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.abs(dx) > 45 && Math.abs(dy) < 70 && items.length > 1) go(dx < 0 ? 1 : -1);
    });
    box.addEventListener("click", function (e) { if (e.target === box || e.target === img) close(); });
    prev.addEventListener("click", function (e) { e.stopPropagation(); go(-1); });
    next.addEventListener("click", function (e) { e.stopPropagation(); go(1); });
    x.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    document.body.classList.add("lb-on");
    document.body.appendChild(box);
    show(Math.max(0, Math.min(start || 0, items.length - 1)));
    x.focus();
  }
  window.SGPhoto = { open: gallery };

  /* Клик по аватарке пользователя — открыть фото в том же окне, что и остальные фотографии */
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || t.tagName !== "IMG" || !t.classList.contains("avatar")) return;
    if (!t.hasAttribute("data-photo")) return;
    if (t.closest("button, a")) return;
    e.preventDefault();
    gallery([{ url: t.currentSrc || t.src, alt: t.alt || "" }], 0, {});
  });

  function cover() {
    var poster = document.querySelector(".stage-poster");
    if (!poster || !poster.src) return;
    gallery([{ url: poster.currentSrc || poster.src, alt: poster.alt || "" }], 0, {});
  }
  var btn = document.getElementById("cover-zoom");
  if (btn) btn.addEventListener("click", function (e) { e.stopPropagation(); cover(); });
  var poster = document.querySelector(".stage-poster");
  if (poster) poster.addEventListener("click", cover);
})();

/* Обложка концерта на главной — открыть фото в том же окне, что и остальные фотографии */
(function () {
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || t.tagName !== "IMG" || !t.classList.contains("concert-cover")) return;
    if (t.closest("a, button")) return;
    e.preventDefault();
    window.SGPhoto.open([{ url: t.currentSrc || t.src, alt: t.alt || "" }], 0, {});
  });
})();
