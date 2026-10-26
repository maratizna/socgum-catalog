/* Вход через Google, комментарии с метками времени, кабинет постановщика.
   Подключается только если в config.json заполнен блок "firebase". Без него сайт остаётся статическим. */
(function () {
  "use strict";

  var cfgEl = document.getElementById("fb-config");
  if (!cfgEl) return;
  var CFG = JSON.parse(cfgEl.textContent);
  var ROOT = document.documentElement.dataset.root || "";
  var SDK = "https://www.gstatic.com/firebasejs/11.0.2/";

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function norm(s) { return String(s || "").trim().replace(/\s+/g, " ").toLowerCase().replace(/ё/g, "е"); }
  function el(tag, attrs) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === "class") n.className = attrs[k];
      else if (k === "text") n.textContent = attrs[k];
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] === true) n.setAttribute(k, "");
      else if (attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c == null || c === false) continue;
      n.append(c.nodeType ? c : document.createTextNode(c));
    }
    return n;
  }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }

  /* ------------------------------------------------------------ кеш чтений
     Ответы сервиса держатся в памяти и в localStorage на ограниченное время, чтобы не ходить на сервер при каждом заходе.
     Любая запись сбрасывает связанные ключи. Без localStorage всё работает, только без запоминания между страницами. */
  var TTL = { me: 10 * 60e3, pub: 5 * 60e3, comments: 60e3, note: 2 * 60e3, avatar: 30 * 60e3 };
  var MEM = {};
  function store() { try { return window.localStorage; } catch (e) { return null; } }
  function pack(v) {
    if (v && typeof v === "object") {
      if (typeof v.toMillis === "function") return { __t: v.toMillis() };
      if (Array.isArray(v)) return v.map(pack);
      var o = {}; Object.keys(v).forEach(function (k) { o[k] = pack(v[k]); }); return o;
    }
    return v;
  }
  function unpack(v) {
    if (v && typeof v === "object") {
      if (typeof v.__t === "number") { var ms = v.__t; return { toMillis: function () { return ms; }, toDate: function () { return new Date(ms); } }; }
      if (Array.isArray(v)) return v.map(unpack);
      var o = {}; Object.keys(v).forEach(function (k) { o[k] = unpack(v[k]); }); return o;
    }
    return v;
  }
  function cget(key, ttl) {
    var now = Date.now(), r = MEM[key];
    if (!r) {
      var st = store();
      try { r = st && JSON.parse(st.getItem("sg:" + key)); } catch (e) { r = null; }
      if (r) MEM[key] = r;
    }
    return r && now - r.t < ttl ? { v: unpack(r.v) } : null;
  }
  function cput(key, v) {
    var r = { t: Date.now(), v: pack(v) };
    MEM[key] = r;
    try { var st = store(); if (st) st.setItem("sg:" + key, JSON.stringify(r)); } catch (e) { }
  }
  function cdrop(prefix) {
    Object.keys(MEM).forEach(function (k) { if (k.indexOf(prefix) === 0) delete MEM[k]; });
    try {
      var st = store();
      if (st) for (var i = st.length - 1; i >= 0; i--) { var k = st.key(i); if (k && k.indexOf("sg:" + prefix) === 0) st.removeItem("sg:" + k.slice(3)); }
    } catch (e) { }
  }
  /* прочитать через кеш: fetchFn возвращает обещание значения */
  function cached(key, ttl, fresh, fetchFn) {
    if (!fresh) { var hit = cget(key, ttl); if (hit) return Promise.resolve(hit.v); }
    return fetchFn().then(function (v) { cput(key, v); return v; });
  }

  /* ------------------------------------------------------------ метки времени в тексте */
  var TC = /(^|[^\d:])((?:\d{1,2}:)?[0-5]?\d:[0-5]\d)(?![\d:])/g;
  function tcSeconds(s) {
    var p = s.split(":").map(Number);
    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
  }
  function tcList(text) {
    var out = [], m;
    TC.lastIndex = 0;
    while ((m = TC.exec(text))) { out.push({ label: m[2], sec: tcSeconds(m[2]) }); TC.lastIndex = m.index + m[1].length + m[2].length; }
    return out;
  }
  /* Текст → узлы. Время превращается в кнопку, которая перематывает запись (её слушает app.js). */
  function richText(text, canSeek) {
    var frag = document.createDocumentFragment(), last = 0, m;
    TC.lastIndex = 0;
    while ((m = TC.exec(text))) {
      var start = m.index + m[1].length, tc = m[2];
      frag.append(text.slice(last, start));
      frag.append(canSeek
        ? el("button", { type: "button", class: "tc", "data-t": tcSeconds(tc), title: "Открыть запись с этого места", text: tc })
        : tc);
      last = start + tc.length;
      TC.lastIndex = last;
    }
    frag.append(text.slice(last));
    return frag;
  }

  /* ------------------------------------------------------------ загрузка SDK */
  var fb = null;          // { auth, db, a, f } после загрузки
  var state = { user: null, admin: false, claims: {}, ready: false };
  var views = [];         // функции перерисовки страниц

  function refreshViews() { views.forEach(function (v) { try { v(); } catch (e) { console.error(e); } }); }

  function load() {
    return Promise.all([
      import(SDK + "firebase-app.js"),
      import(SDK + "firebase-auth.js"),
      import(SDK + "firebase-firestore.js")
    ]).then(function (m) {
      var app = m[0].initializeApp(CFG);
      fb = { a: m[1], f: m[2], auth: m[1].getAuth(app), db: m[2].getFirestore(app) };
    });
  }

  function fdoc(path) { return fb.f.doc.apply(null, [fb.db].concat(path.split("/"))); }
  function fcol(name) { return fb.f.collection(fb.db, name); }

  /* ------------------------------------------------------------ вход: окно с двумя способами */
  function authError(e) {
    var c = e && e.code || "";
    var map = {
      "auth/email-already-in-use": "Этот e-mail уже зарегистрирован. Войдите или восстановите пароль.",
      "auth/invalid-credential": "Неверный e-mail или пароль.",
      "auth/wrong-password": "Неверный e-mail или пароль.",
      "auth/user-not-found": "Неверный e-mail или пароль.",
      "auth/invalid-email": "Проверьте e-mail: он записан с ошибкой.",
      "auth/weak-password": "Пароль слишком короткий: нужно не меньше 6 символов.",
      "auth/too-many-requests": "Слишком много попыток. Подождите немного и повторите.",
      "auth/network-request-failed": "Нет связи с сервисом. Проверьте интернет и повторите.",
      "auth/popup-blocked": "Браузер заблокировал окно входа. Разрешите всплывающие окна для этого сайта и повторите."
    };
    return map[c] || ("Не удалось войти: " + ((e && e.message) || c));
  }

  function signInGoogle() {
    var provider = new fb.a.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    // Вход «с переходом на другую страницу» между разными адресами браузеры ломают, поэтому только окно входа.
    return fb.a.signInWithPopup(fb.auth, provider);
  }

  function signIn() {
    var old = document.getElementById("auth-dialog");
    if (old) old.remove();
    var mode = "login";
    var dlg = el("dialog", { id: "auth-dialog", class: "auth-dialog", "aria-label": "Вход на сайт" });
    var body = el("div", { class: "auth-body" });
    dlg.append(body);
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener("close", function () { dlg.remove(); });
    document.body.append(dlg);

    function finish(p, msg) {
      return p.then(function () { dlg.close(); }, function (e) {
        var c = e && e.code || "";
        if (c === "auth/popup-closed-by-user" || c === "auth/cancelled-popup-request") return;
        console.warn("Вход не удался:", c, e && e.message);
        note(body, authError(e), "err");
        busy(false);
      });
    }
    var buttons = [];
    function busy(on) { buttons.forEach(function (b) { b.disabled = on; }); }

    function draw() {
      clear(body); buttons = [];
      var reg = mode === "register", reset = mode === "reset";
      body.append(el("h2", { text: reset ? "Восстановление пароля" : reg ? "Регистрация" : "Вход" }));
      if (!reset) {
        var g = el("button", { type: "button", class: "btn btn-wide", text: "Продолжить с Google", onclick: function () { busy(true); finish(signInGoogle()); } });
        buttons.push(g);
        body.append(g, el("p", { class: "c-hint auth-or", text: "или по e-mail" }));
      }
      var name = el("input", { class: "c-input", type: "text", autocomplete: "name", maxlength: "100", required: true, "aria-label": "Имя и фамилия" });
      var email = el("input", { class: "c-input", type: "email", autocomplete: "email", required: true, "aria-label": "E-mail" });
      var pass = el("input", { class: "c-input", type: "password", autocomplete: reg ? "new-password" : "current-password", minlength: "6", required: true, "aria-label": "Пароль" });
      var submit = el("button", { type: "submit", class: "btn btn-wide", text: reset ? "Отправить письмо" : reg ? "Зарегистрироваться" : "Войти" });
      buttons.push(submit);
      var f = el("form", { class: "auth-form", onsubmit: function (ev) {
        ev.preventDefault();
        busy(true); note(body, "");
        var em = email.value.trim();
        if (reset) {
          fb.a.sendPasswordResetEmail(fb.auth, em).then(function () { busy(false); note(body, "Если такой e-mail зарегистрирован, мы отправили на него письмо со ссылкой для нового пароля.", "ok"); },
            function (e) { busy(false); note(body, authError(e), "err"); });
        } else if (reg) {
          var nm = name.value.trim().replace(/\s+/g, " ");
          if (nm.length < 2) { busy(false); note(body, "Укажите имя и фамилию.", "err"); return; }
          finish(fb.a.createUserWithEmailAndPassword(fb.auth, em, pass.value).then(function (cred) {
            return fb.a.updateProfile(cred.user, { displayName: nm })
              .then(function () { return cred.user.getIdToken(true); })   // имя попадает в токен, по нему работают правила
              .then(function () { fb.a.sendEmailVerification(cred.user).catch(function () { }); return loadMe(cred.user, true); })
              .then(refreshViews);
          }));
        } else {
          finish(fb.a.signInWithEmailAndPassword(fb.auth, em, pass.value));
        }
      } },
        reg && el("label", null, "Имя и фамилия", name),
        reg && el("p", { class: "c-hint", text: "Так вас увидят в комментариях. Постановщикам лучше написать имя так же, как в таблице: тогда страница подтвердится сразу." }),
        el("label", null, "E-mail", email),
        !reset && el("label", null, "Пароль" + (reg ? " (не меньше 6 символов)" : ""), pass),
        submit);
      body.append(f);
      var links = el("p", { class: "auth-links" });
      if (mode !== "login") links.append(el("button", { type: "button", class: "linkbtn", text: "Уже есть аккаунт: войти", onclick: function () { mode = "login"; draw(); } }));
      if (mode !== "register") links.append(el("button", { type: "button", class: "linkbtn", text: "Зарегистрироваться", onclick: function () { mode = "register"; draw(); } }));
      if (mode === "login") links.append(el("button", { type: "button", class: "linkbtn", text: "Забыли пароль?", onclick: function () { mode = "reset"; draw(); } }));
      body.append(links, el("button", { type: "button", class: "linkbtn auth-close", text: "Закрыть", onclick: function () { dlg.close(); } }));
      note(body, "");
    }
    draw();
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
  }

  function toast(text) {
    var t = document.getElementById("toast");
    if (!t) { t = el("p", { id: "toast", class: "toast", role: "alert" }); document.body.append(t); }
    t.textContent = text; t.hidden = false;
    clearTimeout(t._h); t._h = setTimeout(function () { t.hidden = true; }, 9000);
  }
  function signOut() { cdrop("me:"); return fb.a.signOut(fb.auth); }

  var avatars = {};   // uid → картинка (строка) или "" если фото нет

  function loadMe(user, fresh) {
    state.user = user; state.admin = false; state.claims = {};
    if (!user) { state.ready = true; return Promise.resolve(); }
    var uid = user.uid;
    return Promise.all([
      cached("me:" + uid + ":admin", TTL.me, fresh, function () {
        return fb.f.getDoc(fdoc("admins/" + uid)).then(function (s) { return s.exists(); });
      }).then(function (v) { state.admin = !!v; }, function () { }),
      cached("me:" + uid + ":claims", TTL.pub, fresh, function () {
        return fb.f.getDocs(fb.f.query(fcol("claims"), fb.f.where("uid", "==", uid))).then(function (s) {
          var o = {}; s.forEach(function (d) { o[d.id] = d.data(); }); return o;
        });
      }).then(function (v) { state.claims = v || {}; }, function () { }),
      loadAvatars([uid], fresh)
    ]).then(function () { state.ready = true; });
  }

  /* фото пользователей: users/{uid}.avatar, маленькая картинка. Несколько uid читаются одним запросом. */
  function loadAvatars(uids, fresh) {
    var need = [];
    uids.forEach(function (u) {
      if (!u || (!fresh && avatars[u] !== undefined)) return;
      var hit = fresh ? null : cget("avatar:" + u, TTL.avatar);
      if (hit) avatars[u] = hit.v; else if (need.indexOf(u) === -1) need.push(u);
    });
    if (!need.length) return Promise.resolve();
    var jobs = [];
    for (var i = 0; i < need.length; i += 30) {
      (function (chunk) {
        jobs.push(fb.f.getDocs(fb.f.query(fcol("users"), fb.f.where(fb.f.documentId(), "in", chunk))).then(function (s) {
          var got = {};
          s.forEach(function (d) { got[d.id] = d.data().avatar || ""; });
          chunk.forEach(function (u) { avatars[u] = got[u] || ""; cput("avatar:" + u, avatars[u]); });
        }, function () { chunk.forEach(function (u) { if (avatars[u] === undefined) avatars[u] = ""; }); }));
      })(need.slice(i, i + 30));
    }
    return Promise.all(jobs);
  }
  function hue(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; }
  /* круглая картинка: фото или первая буква имени */
  function saveAvatar(data) {
    var u = state.user;
    var p = data
      ? fb.f.setDoc(fdoc("users/" + u.uid), { avatar: data, updatedAt: fb.f.serverTimestamp() })
      : fb.f.deleteDoc(fdoc("users/" + u.uid));
    return p.then(function () { avatars[u.uid] = data; cput("avatar:" + u.uid, data); cdrop("comments:"); refreshViews(); });
  }
  function avatarNode(uid, name, size) {
    var cls = "avatar avatar-" + (size || "s");
    if (avatars[uid]) return el("img", { class: cls, src: avatars[uid], alt: "" });
    var ch = (String(name || "?").trim().charAt(0) || "?").toUpperCase();
    var n = el("span", { class: cls + " avatar-init", "aria-hidden": "true", text: ch });
    n.style.background = "hsl(" + hue(String(uid || name)) + ",35%,32%)";
    return n;
  }

  /* ------------------------------------------------------------ шапка: вход */
  function drawAuth() {
    var slot = document.getElementById("auth-slot");
    if (!slot) return;
    clear(slot);
    if (!state.ready) return;
    if (!state.user) {
      slot.append(el("button", { type: "button", class: "head-link head-btn", text: "Войти", onclick: signIn }));
    } else {
      var first = (state.user.displayName || "Аккаунт").split(" ")[0];
      slot.append(el("a", { class: "head-link head-me", href: ROOT + "account/", title: "Личный кабинет" },
        avatarNode(state.user.uid, state.user.displayName, "xs"), el("span", { text: first + (state.admin ? " (админ)" : "") })));
    }
  }

  function note(container, text, kind) {
    var n = container.querySelector(".msg");
    if (!n) { n = el("p", { class: "msg", role: "status" }); container.append(n); }
    n.className = "msg" + (kind ? " msg-" + kind : "");
    n.textContent = text || "";
    n.hidden = !text;
  }
  function errText(e) {
    var c = e && e.code || "";
    if (c.indexOf("permission-denied") !== -1) return "Нет прав на это действие.";
    if (c.indexOf("unavailable") !== -1) return "Нет связи с сервисом. Попробуйте ещё раз.";
    return (e && e.message) || "Что-то пошло не так.";
  }

  /* ------------------------------------------------------------ страница номера: комментарии */
  function initNumber() {
    var root = document.getElementById("comments");
    if (!root) return;
    var nid = root.dataset.number;
    var directors = (root.dataset.directors || "").split(" ").filter(Boolean);
    var stage = document.getElementById("stage");
    var canSeek = !!(stage && stage.dataset.oid);
    var comments = [], loaded = false, replyTo = null, noteData = null, fail = "";

    var list = el("div", { class: "c-list" });
    var form = el("div", { class: "c-form" });
    var moments = el("details", { class: "moments", open: true });
    var noteBox = document.getElementById("director-note");
    root.append(moments, list, form);

    function loadComments(fresh) {
      var q = state.admin
        ? fb.f.query(fcol("comments"), fb.f.where("numberId", "==", nid))
        : fb.f.query(fcol("comments"), fb.f.where("numberId", "==", nid), fb.f.where("status", "==", "visible"));
      return cached("comments:" + nid + (state.admin ? ":a" : state.user ? ":" + state.user.uid : ""), TTL.comments, fresh, function () {
        return fb.f.getDocs(q).then(function (s) { return s.docs.map(function (d) { var x = d.data(); x.id = d.id; return x; }); });
      }).then(function (list) {
        comments = list;
        comments.sort(function (a, b) { return ms(a) - ms(b); });
        loaded = true; fail = "";
        return loadAvatars(comments.map(function (c) { return c.uid; }));
      }, function (e) { loaded = true; fail = errText(e); });
    }
    function dropComments() { cdrop("comments:" + nid); }
    function ms(c) { return c.createdAt && c.createdAt.toMillis ? c.createdAt.toMillis() : Date.now(); }
    function when(c) {
      if (!c.createdAt || !c.createdAt.toDate) return "только что";
      return c.createdAt.toDate().toLocaleString("ru-RU", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
    }

    function myDirectorPerson() {
      var ids = Object.keys(state.claims).filter(function (p) { return state.claims[p].status === "approved" && directors.indexOf(p) !== -1; });
      return ids[0] || null;
    }

    function drawMoments() {
      clear(moments);
      var items = [];
      comments.forEach(function (c) {
        if (c.status !== "visible") return;
        tcList(c.text).forEach(function (t) { items.push({ sec: t.sec, label: t.label, c: c }); });
      });
      if (noteData) tcList(noteData.text).forEach(function (t) { items.push({ sec: t.sec, label: t.label, c: null }); });
      moments.hidden = items.length === 0;
      if (!items.length) return;
      items.sort(function (a, b) { return a.sec - b.sec; });
      moments.append(el("summary", { text: "Моменты, о которых пишут (" + items.length + ")" }));
      // один человек: все его моменты рядом, по времени
      var groups = [], byKey = {};
      items.forEach(function (it) {
        var key = it.c ? "u:" + it.c.uid : "note";
        if (!byKey[key]) { byKey[key] = { c: it.c, items: [] }; groups.push(byKey[key]); }
        byKey[key].items.push(it);
      });
      groups.sort(function (a, b) { return a.items[0].sec - b.items[0].sec; });
      var ul = el("ul", { class: "moment-list" });
      groups.forEach(function (g) {
        var line = el("span", { class: "who" });
        var seen = {};
        g.items.forEach(function (it) {
          if (seen[it.sec]) return;
          seen[it.sec] = true;
          line.append(canSeek ? el("button", { type: "button", class: "tc", "data-t": it.sec, text: it.label }) : el("span", { class: "tc", text: it.label }));
        });
        ul.append(el("li", null, line,
          g.c ? el("a", { href: "#c-" + g.items[0].c.id, text: " " + g.c.authorName }) : el("span", { text: " слово постановщика" })));
      });
      moments.append(ul);
    }

    function commentNode(c, isReply) {
      var isDir = c.authorPersonId && directors.indexOf(c.authorPersonId) !== -1;
      var mine = state.user && c.uid === state.user.uid;
      var head = el("p", { class: "c-head" },
        avatarNode(c.uid, c.authorName, "xs"),
        el("strong", { text: c.authorName || "Без имени" }),
        isDir && el("span", { class: "badge", text: "Постановщик" }),
        c.status === "hidden" && el("span", { class: "badge badge-off", text: "Скрыт" }),
        el("a", { class: "c-date", href: "#c-" + c.id, text: when(c) }));
      var actions = el("p", { class: "c-actions" });
      if (!isReply && state.user) actions.append(el("button", { type: "button", class: "linkbtn", text: "Ответить", onclick: function () { replyTo = c; drawForm(); form.scrollIntoView({ block: "center" }); } }));
      if (state.admin) actions.append(el("button", { type: "button", class: "linkbtn", text: c.status === "hidden" ? "Показать" : "Скрыть", onclick: function () { act(fb.f.updateDoc(fdoc("comments/" + c.id), { status: c.status === "hidden" ? "visible" : "hidden" })); } }));
      if (mine || state.admin) actions.append(el("button", { type: "button", class: "linkbtn", text: "Удалить", onclick: function () { if (confirm("Удалить комментарий насовсем?")) act(fb.f.deleteDoc(fdoc("comments/" + c.id))); } }));
      return el("article", { class: "comment" + (isReply ? " reply" : "") + (c.status === "hidden" ? " is-hidden" : ""), id: "c-" + c.id },
        head, el("p", { class: "c-text" }, richText(c.text, canSeek)), actions);
    }
    function act(p) { return p.then(function () { dropComments(); return loadComments(true); }).then(draw, function (e) { toast(errText(e)); }); }

    function drawList() {
      clear(list);
      if (!loaded) { list.append(el("p", { class: "c-empty", text: "Загружаем комментарии…" })); return; }
      if (fail) { list.append(el("p", { class: "msg msg-err", text: "Комментарии не загрузились: " + fail })); return; }
      var top = comments.filter(function (c) { return !c.parentId; });
      var byParent = {};
      comments.forEach(function (c) { if (c.parentId) (byParent[c.parentId] = byParent[c.parentId] || []).push(c); });
      var ids = {}; comments.forEach(function (c) { ids[c.id] = 1; });
      comments.forEach(function (c) { if (c.parentId && !ids[c.parentId]) top.push(c); }); // ответ на удалённый
      top.sort(function (a, b) { return ms(a) - ms(b); });
      if (!top.length) list.append(el("p", { class: "c-empty", text: "Пока нет комментариев. Напишите первым." }));
      top.forEach(function (c) {
        list.append(commentNode(c, false));
        (byParent[c.id] || []).forEach(function (r) { list.append(commentNode(r, true)); });
      });
    }

    function drawForm() {
      clear(form);
      if (!state.ready) return;
      if (!state.user) {
        form.append(el("p", { class: "c-hint", text: "Чтобы написать комментарий, войдите через Google." }),
          el("button", { type: "button", class: "btn", text: "Войти через Google", onclick: signIn }));
        return;
      }
      var ta = el("textarea", { class: "c-input", rows: "3", maxlength: "2000", placeholder: canSeek ? "Ваш комментарий. Время вида 1:23:45 станет ссылкой на этот момент записи." : "Ваш комментарий", "aria-label": "Комментарий" });
      var send = el("button", { type: "submit", class: "btn", text: "Отправить" });
      var f = el("form", { onsubmit: function (ev) {
        ev.preventDefault();
        var text = ta.value.trim();
        if (!text) { note(form, "Напишите текст комментария.", "err"); return; }
        send.disabled = true;
        var data = { numberId: nid, uid: state.user.uid, authorName: state.user.displayName || "Без имени", text: text, createdAt: fb.f.serverTimestamp(), status: "visible" };
        if (replyTo) data.parentId = replyTo.id;
        var pid = myDirectorPerson();
        if (pid) data.authorPersonId = pid;
        fb.f.addDoc(fcol("comments"), data).then(function () { replyTo = null; dropComments(); return loadComments(true); }).then(draw, function (e) { send.disabled = false; note(form, errText(e), "err"); });
      } },
        replyTo && el("p", { class: "c-replyto" }, "Ответ для " + replyTo.authorName + " ",
          el("button", { type: "button", class: "linkbtn", text: "отменить", onclick: function () { replyTo = null; drawForm(); } })),
        ta, el("div", { class: "c-row" }, send,
          el("span", { class: "c-hint", text: "Вы пишете как " + (state.user.displayName || "Без имени") + (myDirectorPerson() ? ", постановщик" : "") })));
      form.append(f);
      note(form, "");
    }

    /* слово постановщика */
    function loadNote(fresh) {
      return cached("note:" + nid, TTL.note, fresh, function () {
        return fb.f.getDoc(fdoc("notes/" + nid)).then(function (s) { return s.exists() ? s.data() : null; });
      }).then(function (v) { noteData = v; }, function () { noteData = null; });
    }
    function drawNote() {
      if (!noteBox) return;
      clear(noteBox);
      var pid = myDirectorPerson();
      var editorPid = pid || (state.admin ? directors[0] : null);
      if (noteData && noteData.text) {
        noteBox.append(el("h2", { text: "Слово постановщика" }), el("p", { class: "c-text" }, richText(noteData.text, canSeek)));
      }
      if (editorPid) {
        var ta = el("textarea", { class: "c-input", rows: "4", maxlength: "3000", placeholder: "Что вы хотите сказать о номере: замысел, благодарности, важные моменты (время вида 1:23:45 станет ссылкой)", "aria-label": "Слово постановщика" });
        ta.value = noteData ? noteData.text : "";
        var box = el("details", { class: "edit-box" }, el("summary", { text: noteData ? "Изменить слово постановщика" : "Добавить слово постановщика" }),
          ta, el("div", { class: "c-row" },
            el("button", { type: "button", class: "btn", text: "Сохранить", onclick: function () {
              var t = ta.value.trim();
              var p = t ? fb.f.setDoc(fdoc("notes/" + nid), { text: t, personId: editorPid, updatedAt: fb.f.serverTimestamp() }) : fb.f.deleteDoc(fdoc("notes/" + nid));
              p.then(function () { cdrop("note:" + nid); return loadNote(true); }).then(function () { drawNote(); drawMoments(); }, function (e) { note(box, errText(e), "err"); });
            } })));
        noteBox.append(box);
      }
      noteBox.hidden = !noteBox.firstChild;
    }

    function draw() { drawMoments(); drawList(); drawForm(); drawNote(); }
    views.push(function () { loaded = false; replyTo = null; draw(); Promise.all([loadComments(), loadNote()]).then(draw); });
  }

  /* ------------------------------------------------------------ страница человека */
  function initPerson() {
    var box = document.getElementById("claim");
    if (!box) return;
    var pid = box.dataset.person, pname = box.dataset.name, isDirector = box.dataset.director === "1";
    var claim = null, profile = null, profileLoaded = false;
    var aboutEl = document.getElementById("p-about"), linkEl = document.getElementById("p-link"), avatarEl = document.getElementById("p-avatar");

    function loadPublic(fresh) {
      fresh = fresh === true;
      return Promise.all([
        cached("pub:claim:" + pid, TTL.pub, fresh, function () { return fb.f.getDoc(fdoc("claims/" + pid)).then(function (s) { return s.exists() ? s.data() : null; }); })
          .then(function (v) { claim = v; }, function () { claim = null; }),
        cached("pub:profile:" + pid, TTL.pub, fresh, function () { return fb.f.getDoc(fdoc("profiles/" + pid)).then(function (s) { return s.exists() ? s.data() : null; }); })
          .then(function (v) { profile = v; }, function () { profile = null; })
      ]).then(function () { profileLoaded = true; });
    }
    function reloadPublic() { cdrop("pub:"); return loadPublic(true); }
    function applyProfile() {
      if (!profile) return;
      if (profile.bio && aboutEl) { aboutEl.textContent = profile.bio; aboutEl.hidden = false; }
      if (profile.link && linkEl) {
        clear(linkEl).append(el("a", { href: profile.link, rel: "noopener ugc", text: profile.link.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") }));
        linkEl.hidden = false;
      }
      if (avatarEl) { if (profile.avatar) { avatarEl.src = profile.avatar; avatarEl.hidden = false; } else avatarEl.hidden = true; }
    }

    function mine() { return state.user && claim && claim.uid === state.user.uid; }
    function claimPerson() {
      var u = state.user;
      return fb.f.setDoc(fdoc("claims/" + pid), { uid: u.uid, name: u.displayName || "Без имени", status: "pending", createdAt: fb.f.serverTimestamp() })
        .then(function () { return loadMe(u, true); }).then(reloadPublic).then(draw, function (e) {
          note(box, e && e.code === "permission-denied"
            ? "Страница ещё не передана сервису. Попросите администратора открыть «Кабинет» и нажать «Обновить список»."
            : errText(e), "err");
        });
    }

    function editor() {
      var ta = el("textarea", { class: "c-input", rows: "5", maxlength: "2000", "aria-label": "О себе", placeholder: "Коротко о себе" });
      ta.value = profile && profile.bio || (aboutEl ? aboutEl.textContent.trim() : "");
      var link = el("input", { class: "c-input", type: "url", maxlength: "300", "aria-label": "Ссылка", placeholder: "https://vk.com/…" });
      link.value = profile && profile.link || "";
      var avatar = profile && profile.avatar || "";
      var prev = el("img", { class: "avatar", alt: "", hidden: !avatar, src: avatar || null });
      var file = el("input", { type: "file", accept: "image/*", "aria-label": "Фото", onchange: function () {
        var f = file.files[0]; if (!f) return;
        shrink(f).then(function (data) { avatar = data; prev.src = data; prev.hidden = false; }, function (e) { note(wrap, e.message, "err"); });
      } });
      var wrap = el("div", { class: "edit-box" },
        el("label", null, "О себе", ta), el("label", null, "Ссылка (сайт или страница)", link),
        el("div", { class: "c-row" }, prev, file,
          el("button", { type: "button", class: "linkbtn", text: "Убрать фото", onclick: function () { avatar = ""; prev.hidden = true; file.value = ""; } })),
        el("div", { class: "c-row" }, el("button", { type: "button", class: "btn", text: "Сохранить", onclick: function () {
          var l = link.value.trim();
          if (l && !/^https?:\/\//i.test(l)) { note(wrap, "Ссылка должна начинаться с https://", "err"); return; }
          fb.f.setDoc(fdoc("profiles/" + pid), { bio: ta.value.trim(), link: l, avatar: avatar, updatedAt: fb.f.serverTimestamp() })
            .then(reloadPublic).then(function () { applyProfile(); note(wrap, "Сохранено.", "ok"); }, function (e) { note(wrap, errText(e), "err"); });
        } })));
      return wrap;
    }

    function draw() {
      clear(box);
      if (!state.ready || !profileLoaded) return;
      applyProfile();
      if (!isDirector) { box.hidden = true; return; }
      box.hidden = false;
      var u = state.user;
      if (claim && claim.status === "approved") box.append(el("p", { class: "c-hint", text: "Страница подтверждена владельцем." }));
      if (!u) {
        if (!claim) box.append(el("p", { class: "c-hint", text: "Вы постановщик? Войдите через Google, чтобы вести эту страницу." }), el("button", { type: "button", class: "btn", text: "Войти через Google", onclick: signIn }));
      } else if (!claim) {
        box.append(el("button", { type: "button", class: "btn", text: "Это моя страница", onclick: claimPerson }),
          el("p", { class: "c-hint", text: "Заявку проверит и подтвердит администратор." }));
      } else if (mine() && claim.status === "pending") {
        box.append(el("p", { class: "msg", text: "Заявка отправлена. Администратор подтвердит её, и здесь появится редактирование." }),
          el("button", { type: "button", class: "linkbtn", text: "Отозвать заявку", onclick: function () { fb.f.deleteDoc(fdoc("claims/" + pid)).then(function () { return loadMe(u, true); }).then(reloadPublic).then(draw); } }));
      }
      if (mine() && claim.status === "approved") {
        box.append(el("details", { class: "edit-box" }, el("summary", { text: "Редактировать страницу" }), editor()),
          el("button", { type: "button", class: "linkbtn", text: "Отказаться от страницы", onclick: function () { if (confirm("Отвязать аккаунт от этой страницы?")) fb.f.deleteDoc(fdoc("claims/" + pid)).then(function () { return loadMe(u, true); }).then(reloadPublic).then(draw); } }));
      }
      if (state.admin) {
        var adm = el("div", { class: "admin-box" }, el("p", { class: "c-hint", text: claim ? "Аккаунт: " + claim.name + ", статус: " + (claim.status === "approved" ? "подтверждён" : "ждёт подтверждения") : "Страницу пока никто не занял." }));
        if (claim && claim.status === "pending") adm.append(el("button", { type: "button", class: "btn", text: "Подтвердить", onclick: function () { fb.f.updateDoc(fdoc("claims/" + pid), { status: "approved" }).then(function () { cdrop("me:"); }).then(reloadPublic).then(draw, function (e) { toast(errText(e)); }); } }));
        if (claim) adm.append(el("button", { type: "button", class: "linkbtn", text: "Отозвать доступ", onclick: function () { if (confirm("Отозвать доступ у «" + claim.name + "»?")) fb.f.deleteDoc(fdoc("claims/" + pid)).then(reloadPublic).then(draw); } }));
        if (!mine()) adm.append(el("details", { class: "edit-box" }, el("summary", { text: "Править страницу как администратор" }), editor()));
        box.append(adm);
      }
    }
    views.push(function () { draw(); loadPublic().then(draw); });
  }

  /* уменьшаем фото до 192 px: Storage не нужен, картинка хранится строкой в профиле */
  function shrink(file, side, limit) {
    side = side || 192; limit = limit || 100000;
    return new Promise(function (ok, bad) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var s = side, c = document.createElement("canvas"); c.width = c.height = s;
        var sq = Math.min(img.width, img.height), sx = (img.width - sq) / 2, sy = (img.height - sq) / 3;
        c.getContext("2d").drawImage(img, sx, Math.max(0, sy), sq, sq, 0, 0, s, s);
        URL.revokeObjectURL(url);
        var q = 0.85, d = c.toDataURL("image/jpeg", q);
        while (d.length > limit && q > 0.3) { q -= 0.15; d = c.toDataURL("image/jpeg", q); }
        d.length > limit * 1.2 ? bad(new Error("Фото слишком тяжёлое. Выберите другое.")) : ok(d);
      };
      img.onerror = function () { URL.revokeObjectURL(url); bad(new Error("Не удалось открыть изображение.")); };
      img.src = url;
    });
  }

  /* ------------------------------------------------------------ кабинет */
  function initAccount() {
    var box = document.getElementById("account");
    if (!box) return;
    var names = {}, catalog = null, pending = [], approved = [], syncMsg = "";

    function loadCatalog() {
      if (catalog) return Promise.resolve(catalog);
      return fetch(ROOT + "catalog.json", { cache: "no-store" }).then(function (r) { return r.json(); }).then(function (j) {
        catalog = j; (j.people || []).forEach(function (p) { names[p.id] = p.name; }); return j;
      }, function () { return null; });
    }
    function nameOf(pid) { return names[pid] || pid; }

    function loadAdmin() {
      if (!state.admin) return Promise.resolve();
      return fb.f.getDocs(fcol("claims")).then(function (s) {
        pending = []; approved = [];
        s.forEach(function (d) { var x = d.data(); x.id = d.id; (x.status === "pending" ? pending : approved).push(x); });
      }, function (e) { syncMsg = errText(e); });
    }

    /* Список людей и номеров из catalog.json переносится в сервис: по нему правила узнают постановщиков. */
    function sync(force) {
      return loadCatalog().then(function (cat) {
        if (!cat || !cat.people) throw new Error("Не удалось прочитать catalog.json.");
        return fb.f.getDoc(fdoc("meta/sync")).then(function (m) {
          if (!force && m.exists() && m.data().hash === cat.sync_hash) return "Список уже актуален.";
          var people = cat.people, nums = cat.numbers;
          return Promise.all([fb.f.getDocs(fcol("people")), fb.f.getDocs(fcol("numbers"))]).then(function (old) {
            var ops = [];
            people.forEach(function (p) { ops.push(["set", "people/" + p.id, { name: p.name, nameKey: norm(p.name), isDirector: !!p.director }]); });
            nums.forEach(function (n) { ops.push(["set", "numbers/" + n.id, { title: n.title, directors: n.director_ids || [] }]); });
            var keepP = {}, keepN = {};
            people.forEach(function (p) { keepP[p.id] = 1; }); nums.forEach(function (n) { keepN[n.id] = 1; });
            old[0].forEach(function (d) { if (!keepP[d.id]) ops.push(["del", "people/" + d.id]); });
            old[1].forEach(function (d) { if (!keepN[d.id]) ops.push(["del", "numbers/" + d.id]); });
            ops.push(["set", "meta/sync", { hash: cat.sync_hash, generated: cat.generated || "", at: fb.f.serverTimestamp() }]);
            var chunks = [];
            for (var i = 0; i < ops.length; i += 400) chunks.push(ops.slice(i, i + 400));
            return chunks.reduce(function (p, chunk) {
              return p.then(function () {
                var b = fb.f.writeBatch(fb.db);
                chunk.forEach(function (o) { o[0] === "set" ? b.set(fdoc(o[1]), o[2]) : b.delete(fdoc(o[1])); });
                return b.commit();
              });
            }, Promise.resolve()).then(function () { return "Список обновлён: людей " + people.length + ", номеров " + nums.length + "."; });
          });
        });
      });
    }

    /* своя фотография: сжимается в браузере до 128 px и хранится строкой в users/{uid} */
    function avatarBox() {
      var u = state.user, wrap = el("div", { class: "avatar-edit" });
      var file = el("input", { type: "file", accept: "image/*", "aria-label": "Выбрать фото", hidden: true, onchange: function () {
        var f = file.files[0]; if (!f) return;
        note(wrap, "Загружаем…");
        shrink(f, 128, 30000).then(function (data) { return saveAvatar(data); }).then(function () { note(wrap, "Фото сохранено.", "ok"); draw(); },
          function (e) { note(wrap, e && e.code ? errText(e) : e.message, "err"); });
        file.value = "";
      } });
      wrap.append(avatarNode(u.uid, u.displayName, "l"),
        el("div", null,
          el("button", { type: "button", class: "btn btn-s", text: avatars[u.uid] ? "Заменить фото" : "Загрузить фото", onclick: function () { file.click(); } }),
          avatars[u.uid] && el("button", { type: "button", class: "linkbtn", text: "Убрать фото", onclick: function () { saveAvatar("").then(draw, function (e) { note(wrap, errText(e), "err"); }); } }),
          el("p", { class: "c-hint", text: "Фото видно рядом с вашими комментариями. Подойдёт любая картинка, она сожмётся и обрежется до квадрата." })),
        file);
      return wrap;
    }

    function draw() {
      clear(box);
      if (!state.ready) { box.append(el("p", { class: "c-hint", text: "Загрузка…" })); return; }
      if (!state.user) {
        box.append(el("p", { class: "lead", text: "Войдите через Google, чтобы вести свою страницу постановщика и писать комментарии." }),
          el("button", { type: "button", class: "btn", text: "Войти через Google", onclick: signIn }));
        return;
      }
      box.append(el("p", { class: "lead", text: state.user.displayName + (state.admin ? ". Вы администратор." : "") }));
      box.append(avatarBox());
      var nameIn = el("input", { class: "c-input", type: "text", maxlength: "100", "aria-label": "Имя в комментариях" });
      nameIn.value = state.user.displayName || "";
      var nameBox = el("details", { class: "edit-box" }, el("summary", { text: "Изменить имя" }),
        el("label", null, "Имя в комментариях и для подтверждения страницы", nameIn),
        el("button", { type: "button", class: "btn btn-s", text: "Сохранить имя", onclick: function () {
          var nm = nameIn.value.trim().replace(/\s+/g, " ");
          if (nm.length < 2) { note(nameBox, "Имя слишком короткое.", "err"); return; }
          fb.a.updateProfile(state.user, { displayName: nm }).then(function () { return state.user.getIdToken(true); })
            .then(function () { refreshViews(); }, function (e) { note(nameBox, errText(e), "err"); });
        } }));
      box.append(nameBox);
      var viaPass = state.user.providerData.some(function (p) { return p.providerId === "password"; });
      if (viaPass && !state.user.emailVerified) {
        box.append(el("p", { class: "c-hint", text: "E-mail " + state.user.email + " пока не подтверждён." }),
          el("button", { type: "button", class: "linkbtn", text: "Отправить письмо ещё раз", onclick: function (ev) {
            fb.a.sendEmailVerification(state.user).then(function () { ev.target.textContent = "Письмо отправлено"; }, function (e) { toast(errText(e)); }); } }));
      }
      var mineIds = Object.keys(state.claims);
      box.append(el("h2", { text: "Мои страницы" }));
      if (!mineIds.length) box.append(el("p", { class: "c-hint", text: "Пока нет. Откройте свою страницу в каталоге и нажмите «Это моя страница»." }));
      else {
        var ul = el("ul", { class: "acc-list" });
        mineIds.forEach(function (pid) {
          ul.append(el("li", null, el("a", { href: ROOT + "p/" + pid + "/", text: nameOf(pid) }), " ",
            el("span", { class: "badge" + (state.claims[pid].status === "approved" ? "" : " badge-off"), text: state.claims[pid].status === "approved" ? "подтверждена" : "ждёт подтверждения" })));
        });
        box.append(ul);
      }
      if (state.admin) {
        box.append(el("h2", { text: "Заявки на подтверждение" }));
        if (!pending.length) box.append(el("p", { class: "c-hint", text: "Новых заявок нет." }));
        else {
          var pl = el("ul", { class: "acc-list" });
          pending.forEach(function (c) {
            pl.append(el("li", null, el("a", { href: ROOT + "p/" + c.id + "/", text: nameOf(c.id) }), " ← аккаунт «" + c.name + "» ",
              el("button", { type: "button", class: "btn btn-s", text: "Подтвердить", onclick: function () { fb.f.updateDoc(fdoc("claims/" + c.id), { status: "approved" }).then(reload); } }), " ",
              el("button", { type: "button", class: "linkbtn", text: "Отклонить", onclick: function () { fb.f.deleteDoc(fdoc("claims/" + c.id)).then(reload); } })));
          });
          box.append(pl);
        }
        box.append(el("h2", { text: "Подтверждённые страницы" }));
        if (!approved.length) box.append(el("p", { class: "c-hint", text: "Пока нет." }));
        else {
          var al = el("ul", { class: "acc-list" });
          approved.forEach(function (c) {
            al.append(el("li", null, el("a", { href: ROOT + "p/" + c.id + "/", text: nameOf(c.id) }), " ← «" + c.name + "» ",
              el("button", { type: "button", class: "linkbtn", text: "Отозвать", onclick: function () { if (confirm("Отозвать доступ у «" + c.name + "»?")) fb.f.deleteDoc(fdoc("claims/" + c.id)).then(reload); } })));
          });
          box.append(al);
        }
        box.append(el("h2", { text: "Список людей и номеров" }),
          el("p", { class: "c-hint", text: "Сервис узнаёт постановщиков из таблицы. После правок в таблице и обновления сайта нажмите кнопку, чтобы передать ему новый список. Это нужно, например, когда добавили нового постановщика." }),
          el("button", { type: "button", class: "btn", text: "Обновить список", onclick: function (ev) {
            ev.target.disabled = true; syncMsg = "Обновляем…"; draw();
            sync(true).then(function (m) { syncMsg = m; }, function (e) { syncMsg = errText(e); }).then(draw);
          } }), el("p", { class: "msg", text: syncMsg, hidden: !syncMsg }));
      }
      box.append(el("h2", { text: "Выход" }),
        el("button", { type: "button", class: "btn btn-s", text: "Выйти из аккаунта", onclick: signOut }));
    }
    function reload() { loadMe(state.user, true).then(loadAdmin).then(draw); }
    views.push(function () {
      draw();
      loadCatalog().then(function () {
        if (!state.admin) return draw();
        return sync(false).then(function (m) { syncMsg = /обновлён/.test(m) ? m : ""; }, function (e) { syncMsg = errText(e); }).then(loadAdmin).then(draw);
      });
    });
  }

  /* ------------------------------------------------------------ запуск */
  var slot = document.getElementById("auth-slot");
  load().then(function () {
    initNumber(); initPerson(); initAccount();
    views.unshift(drawAuth);
    fb.a.onAuthStateChanged(fb.auth, function (user) { loadMe(user).then(refreshViews); });
  }, function (e) {
    console.error(e);
    if (slot) slot.textContent = "";
    var acc = document.getElementById("account");
    if (acc) acc.textContent = "Сервис входа сейчас недоступен. Попробуйте позже.";
    var cm = document.getElementById("comments");
    if (cm) cm.append(el("p", { class: "msg msg-err", text: "Комментарии сейчас недоступны." }));
  });
})();
