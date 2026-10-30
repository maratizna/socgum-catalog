/* Граф связей человека (как локальный граф в Obsidian): в центре человек, вокруг люди, с которыми он делал номера.
   Размер шарика и близость к центру зависят от числа общих номеров. Данные лежат на странице (готовятся при сборке сайта),
   сервис и таблица при просмотре не нужны. Шарики можно перетаскивать, нажатие открывает страницу человека. */
(function () {
  "use strict";
  var box = document.getElementById("p-graph"), svg = document.getElementById("graph-svg"), wrap = document.getElementById("graph-wrap");
  var raw = document.getElementById("graph-json");
  if (!box || !svg || !wrap || !raw) return;
  var data; try { data = JSON.parse(raw.textContent); } catch (e) { return; }
  var ROOT = document.documentElement.dataset.root || "";
  var NS = "http://www.w3.org/2000/svg";
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var nodes = [], center = null, W = 0, H = 0, built = false, raf = 0, drag = null, moved = false, hover = null, ticks = 0;

  function s(tag, attrs, text) {
    var n = document.createElementNS(NS, tag);
    for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  }
  function word(n) { var a = n % 10, b = n % 100; return a === 1 && b !== 11 ? "общий номер" : (a >= 2 && a <= 4 && !(b >= 12 && b <= 14) ? "общих номера" : "общих номеров"); }
  function radius(c) { return Math.min(30, 9 + 5 * Math.sqrt(c)); }

  function layout() {
    W = Math.max(260, wrap.clientWidth); H = Math.round(Math.max(340, Math.min(560, W * 0.9)));
    svg.setAttribute("viewBox", "0 0 " + W + " " + H); svg.setAttribute("width", W); svg.setAttribute("height", H);
    var cx = W / 2, cy = H / 2, maxC = Math.max.apply(null, data.nodes.map(function (n) { return n.c; })) || 1;
    var rOut = Math.min(W, H) * 0.5 - 36, rIn = 26 + 38;
    center.x = cx; center.y = cy;
    nodes.forEach(function (n, i) {
      var t = maxC > 1 ? Math.pow((n.c - 1) / (maxC - 1), 0.75) : 0;   // одна общая работа — на внешнем кольце
      n.target = rOut - (rOut - rIn) * t;
      var a = i * 2.399963 + 0.4;                      // золотой угол: равномерная раскладка по кругу
      n.x = cx + Math.cos(a) * n.target; n.y = cy + Math.sin(a) * n.target; n.vx = 0; n.vy = 0;
    });
    for (var k = 0; k < 260; k++) step(0.9);
  }

  /* один шаг простой физики: пружина к «своему» расстоянию от центра и отталкивание шариков друг от друга */
  function step(damp) {
    var cx = W / 2, cy = H / 2, i, j, a, b, dx, dy, d, f;
    for (i = 0; i < nodes.length; i++) {
      a = nodes[i];
      if (a === drag) continue;
      dx = a.x - cx; dy = a.y - cy; d = Math.sqrt(dx * dx + dy * dy) || 1;
      f = (a.target - d) * 0.06;
      a.vx += dx / d * f; a.vy += dy / d * f;
    }
    for (i = 0; i < nodes.length; i++) for (j = i + 1; j < nodes.length; j++) {
      a = nodes[i]; b = nodes[j];
      dx = b.x - a.x; dy = b.y - a.y; d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      var min = a.r + b.r + 10;
      if (d < min) {
        f = (min - d) * 0.5 / d;
        if (a !== drag) { a.vx -= dx * f; a.vy -= dy * f; }
        if (b !== drag) { b.vx += dx * f; b.vy += dy * f; }
      }
    }
    for (i = 0; i < nodes.length; i++) {
      a = nodes[i];
      if (a === drag) continue;
      // от центрального шарика
      dx = a.x - cx; dy = a.y - cy; d = Math.sqrt(dx * dx + dy * dy) || 1;
      var m = a.r + center.r + 12;
      if (d < m) { a.vx += dx / d * (m - d) * 0.5; a.vy += dy / d * (m - d) * 0.5; }
      a.vx *= damp; a.vy *= damp;
      a.x += a.vx; a.y += a.vy;
      a.x = Math.max(a.r + 4, Math.min(W - a.r - 4, a.x)); a.y = Math.max(a.r + 4, Math.min(H - a.r - 18, a.y));
    }
  }

  function draw() {
    nodes.forEach(function (n) {
      n.line.setAttribute("x1", center.x); n.line.setAttribute("y1", center.y); n.line.setAttribute("x2", n.x); n.line.setAttribute("y2", n.y);
      n.g.setAttribute("transform", "translate(" + n.x.toFixed(1) + " " + n.y.toFixed(1) + ")");
    });
  }
  function loop() {
    raf = 0;
    step(0.82); draw(); ticks++;
    var calm = nodes.every(function (n) { return Math.abs(n.vx) + Math.abs(n.vy) < 0.05; });
    if (drag || (!calm && ticks < 240)) raf = requestAnimationFrame(loop);
  }
  function kick() { ticks = 0; if (!raf && !reduce) raf = requestAnimationFrame(loop); else if (reduce) { for (var k = 0; k < 40; k++) step(0.8); draw(); } }

  function focusNode(n, on) {
    hover = on ? n : null;
    nodes.forEach(function (m) {
      var self = m === n;
      m.g.classList.toggle("is-dim", on && !self);
      m.line.classList.toggle("is-hot", on && self);
      if (m.showLabel || (on && self)) m.label.removeAttribute("display"); else m.label.setAttribute("display", "none");
    });
  }

  function build() {
    built = true;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    center = { r: 26, c: 0 };
    nodes = data.nodes.map(function (d) { return { d: d, c: d.c, r: radius(d.c), showLabel: d.c >= 2 || data.nodes.length <= 14 }; });
    var lines = s("g", { "class": "g-lines" }), balls = s("g", { "class": "g-nodes" });
    svg.appendChild(lines); svg.appendChild(balls);
    var maxC = Math.max.apply(null, nodes.map(function (n) { return n.c; })) || 1;
    nodes.forEach(function (n) {
      n.line = s("line", { "class": "g-line", "stroke-width": (1 + Math.sqrt(n.c) * 0.7).toFixed(1) });
      lines.appendChild(n.line);
      var a = s("a", { href: ROOT + "p/" + encodeURIComponent(n.d.s) + "/", "class": "g-node" });
      var title = s("title", {}, n.d.n + ": " + n.c + " " + word(n.c));
      n.circle = s("circle", { r: n.r.toFixed(1), "class": "g-ball", "fill-opacity": (0.28 + 0.6 * Math.sqrt(n.c / maxC)).toFixed(2) });
      n.label = s("text", { "class": "g-label", y: (n.r + 14).toFixed(1), "text-anchor": "middle" }, n.d.n);
      if (!n.showLabel) n.label.setAttribute("display", "none");
      a.appendChild(title); a.appendChild(n.circle); a.appendChild(n.label);
      n.g = s("g", {}); n.g.appendChild(a); balls.appendChild(n.g);
      a.addEventListener("pointerenter", function () { focusNode(n, true); });
      a.addEventListener("pointerleave", function () { if (!drag) focusNode(n, false); });
      a.addEventListener("focus", function () { focusNode(n, true); });
      a.addEventListener("blur", function () { focusNode(n, false); });
      a.addEventListener("click", function (e) { if (moved) { e.preventDefault(); moved = false; } });
      a.addEventListener("dragstart", function (e) { e.preventDefault(); });
      a.addEventListener("pointerdown", function (e) {
        if (e.button) return;
        drag = n; moved = false;
        var sx = e.clientX, sy = e.clientY, box0 = svg.getBoundingClientRect();
        function mv(ev) {
          if (!moved && Math.abs(ev.clientX - sx) + Math.abs(ev.clientY - sy) < 5) return;
          moved = true;
          n.x = ev.clientX - box0.left; n.y = ev.clientY - box0.top; n.vx = n.vy = 0;
          if (reduce) draw(); else kick();
          ev.preventDefault();
        }
        function up() {
          window.removeEventListener("pointermove", mv); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", up);
          drag = null; focusNode(n, false); kick();
        }
        window.addEventListener("pointermove", mv, { passive: false }); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", up);
      });
    });
    var cg = s("g", { "class": "g-center" });
    cg.appendChild(s("circle", { r: center.r, "class": "g-ball-c" }));
    cg.appendChild(s("text", { "class": "g-label g-label-c", y: center.r + 16, "text-anchor": "middle" }, data.name));
    balls.appendChild(cg); center.g = cg;
    layout();
    cg.setAttribute("transform", "translate(" + center.x + " " + center.y + ")");
    draw();
  }

  function open() {
    if (!built) build();
  }
  box.addEventListener("toggle", function () { if (box.open) open(); });
  if (box.open) open();
  var rt;
  window.addEventListener("resize", function () {
    if (!built || !box.open) return;
    clearTimeout(rt);
    rt = setTimeout(function () {
      if (Math.abs(wrap.clientWidth - W) < 2) return;
      layout(); center.g.setAttribute("transform", "translate(" + center.x + " " + center.y + ")"); draw();
    }, 150);
  });
})();
