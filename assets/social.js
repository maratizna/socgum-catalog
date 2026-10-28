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

  /* ------------------------------------------------------------ фильтр мата
     Проверка в браузере до отправки комментария. Понимает замену букв латиницей и цифрами, повтор букв,
     пробелы и знаки между буквами. Корни ищутся с начала слова (с приставками),
     чтобы не ловить обычные слова вроде «небо», «хлеб», «скипидар». Слова с буквой, закрытой звёздочкой, пропускаются. Список правится только здесь. */
  /* PROFANITY BEGIN */
  var LATMAP = { a: "а", b: "в", c: "с", e: "е", h: "н", k: "к", m: "м", o: "о", p: "р", t: "т", x: "х", y: "у" };
  var BAD_CYR = [
    /^(?:[а-я]{0,2}|раз|рас|при|под|про|над|пере|недо)?ху(?:й|ю|я|е|ил)/,
    /пизд/,
    /^пид[оае]р|^пидр/,
    /^(?:за|вы|на|по|до|про|у|раз|объ|подъ|отъ|съ|сь|недо|долбо|мудо|дебило)?[ъь]?еб(?:а|у|л|н|и|ы|ет|ешь|ем|ете|ут)/,
    /^(?:долбо|мудо|дебило|у|за|на|вы|съ|сь)[ъь]?еб(?:ок|ки|ан|$)/,
    /^бля$|бляд|блят/,
    /^сук(?:а|и|у|е|ой|ам|ами)$|^сучар/,
    /мудак|мудил|мудозв|мудох/,
    /залуп/,
    /^г[ао]ндон/,
    /^шлюх|^шлюшк/,
    /^хули$/
  ];
  var BAD_LAT = /^(?:[xh]u[yij]|xy[ijyu]|pizd|pezd|ebat|ebal|eban|ebu|blya|blyat|blyad|pidor|pidar|pidr|mudak|gandon|zalup)/;
  function badCyr(w) { for (var i = 0; i < BAD_CYR.length; i++) if (BAD_CYR[i].test(w)) return true; return false; }
  function badWord(raw) {
    var w = raw.toLowerCase().replace(/ё/g, "е");
    if (/[а-яa-z][*#@%$&]+[а-яa-z]/.test(w)) return false;   // слово с буквой, закрытой звёздочкой, пропускаем
    var cyr = /[а-я]/.test(w);
    if (cyr) w = w.replace(/[a-z]/g, function (c) { return LATMAP[c] || c; }).replace(/0/g, "о").replace(/3/g, "з").replace(/6/g, "б").replace(/4/g, "ч");
    w = w.replace(/[^а-яa-z]/g, "").replace(/(.)\1+/g, "$1");
    if (w.length < 2) return false;
    return cyr ? badCyr(w) : BAD_LAT.test(w);
  }
  /* Возвращает найденное слово (как написал человек) или "" */
  function findProfanity(text) {
    var toks = String(text || "").split(/[\s.,;:!?()\[\]{}"«»…\/\\|<>=+~^_—–]+/).filter(Boolean), i, k;
    for (i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (badWord(t)) return t;
      if (t.indexOf("-") !== -1) {
        var ps = t.split(/-+/);
        for (k = 0; k < ps.length; k++) if (ps[k] && badWord(ps[k])) return t;
      }
    }
    // буквы по одной: «х у й», «х.у.й»
    var run = [];
    for (i = 0; i <= toks.length; i++) {
      var s = toks[i];
      if (s && /^[A-Za-zА-Яа-яЁё]$/.test(s)) { run.push(s); continue; }
      if (run.length >= 3 && badWord(run.join(""))) return run.join(" ");
      run = [];
    }
    return "";
  }
  /* PROFANITY END */

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

  /* ------------------------------------------------------------ единая страница человека
     Подтверждённый владелец ведёт одну страницу: описание и ссылка лежат в profiles/{pid}, а фото одно на аккаунт.
     Фото аккаунта (users) и фото страниц, которыми он владеет (profiles), меняются вместе. */
  function readProfile(pid) { return fb.f.getDoc(fdoc("profiles/" + pid)).then(function (s) { return s.exists() ? s.data() : null; }); }
  function profileCached(pid, fresh) { return cached("pub:profile:" + pid, TTL.pub, fresh === true, function () { return readProfile(pid); }); }
  function writeProfile(pid, patch) {
    return readProfile(pid).then(function (cur) {
      cur = cur || {};
      var d = { bio: cur.bio || "", link: cur.link || "", avatar: cur.avatar || "", updatedAt: fb.f.serverTimestamp() };
      Object.keys(patch).forEach(function (k) { d[k] = patch[k]; });
      return fb.f.setDoc(fdoc("profiles/" + pid), d);
    }).then(function () { cdrop("pub:profile:" + pid); });
  }
  function approvedPids() {
    return Object.keys(state.claims).filter(function (p) { return state.claims[p].status === "approved"; });
  }
  /* Фото владельца подтягивается на страницу, если у страницы своего фото ещё нет. Возвращает актуальный профиль. */
  function ownProfile(pid) {
    return profileCached(pid).then(function (p) {
      var a = state.user && avatars[state.user.uid];
      if ((p && p.avatar) || !a) return p;
      return writeProfile(pid, { avatar: a }).then(function () { return profileCached(pid, true); }, function () { return p; });
    });
  }
  /* Подтверждение заявки администратором: фото человека сразу переходит на его страницу. */
  function approveClaim(pid, uid) {
    return fb.f.updateDoc(fdoc("claims/" + pid), { status: "approved" }).then(function () {
      cdrop("me:"); cdrop("pub:");
      return Promise.all([loadAvatars([uid], true), profileCached(pid, true)]).then(function (r) {
        var a = avatars[uid];
        if (a && !(r[1] && r[1].avatar)) return writeProfile(pid, { avatar: a });
      }).catch(function () { });
    });
  }
  function setMyAvatar(file) {
    return Promise.all([shrink(file, 128, 30000), shrink(file, 192, 100000)]).then(function (r) {
      return saveAvatar(r[0]).then(function () {
        return Promise.all(approvedPids().map(function (pid) { return writeProfile(pid, { avatar: r[1] }); }));
      }).then(function () { refreshViews(); return r[1]; });
    });
  }
  function clearMyAvatar() {
    return saveAvatar("").then(function () {
      return Promise.all(approvedPids().map(function (pid) { return writeProfile(pid, { avatar: "" }); }));
    }).then(function () { refreshViews(); });
  }
  function pageUrl(pid) { return new URL(ROOT + "p/" + pid + "/", location.href).href; }
  function shareButton(pid, title, urlOverride) {
    var url = urlOverride || pageUrl(pid), b = el("button", { type: "button", class: "btn btn-s", text: "Поделиться страницей", onclick: function () {
      if (navigator.share) { navigator.share({ title: title, url: url }).catch(function () { }); return; }
      var copy = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(url) : Promise.reject();
      copy.then(function () { b.textContent = "Ссылка скопирована"; setTimeout(function () { b.textContent = "Поделиться страницей"; }, 2500); },
        function () { window.prompt("Скопируйте ссылку", url); });
    } });
    return b;
  }
  /* Редактор страницы: описание, ссылка, фото. own: владелец правит свою страницу, и фото общее с аккаунтом. */
  function profileEditor(pid, profile, aboutDefault, own, done) {
    var ta = el("textarea", { class: "c-input", rows: "5", maxlength: "2000", "aria-label": "О себе", placeholder: "Коротко о себе" });
    ta.value = profile && profile.bio || aboutDefault || "";
    var link = el("input", { class: "c-input", type: "url", maxlength: "300", "aria-label": "Ссылка", placeholder: "https://vk.com/…" });
    link.value = profile && profile.link || "";
    var avatar = profile && profile.avatar || "";
    var prev = el("img", { class: "avatar avatar-l", alt: "", hidden: !avatar, src: avatar || null });
    var wrap;
    var file = el("input", { type: "file", accept: "image/*", "aria-label": "Фото", hidden: true, onchange: function () {
      var f = file.files[0]; if (!f) return;
      if (own) {
        note(wrap, "Загружаем…");
        setMyAvatar(f).then(function (big) { avatar = big; prev.src = big; prev.hidden = false; note(wrap, "Фото сохранено.", "ok"); done && done(); },
          function (e) { note(wrap, e && e.code ? errText(e) : e.message, "err"); });
      } else {
        shrink(f).then(function (data) { avatar = data; prev.src = data; prev.hidden = false; }, function (e) { note(wrap, e.message, "err"); });
      }
      file.value = "";
    } });
    var removeBtn = el("button", { type: "button", class: "linkbtn", text: "Убрать фото", onclick: function () {
      if (own) {
        clearMyAvatar().then(function () { avatar = ""; prev.hidden = true; note(wrap, "Фото убрано.", "ok"); done && done(); }, function (e) { note(wrap, errText(e), "err"); });
      } else { avatar = ""; prev.hidden = true; }
    } });
    wrap = el("div", { class: "edit-box" },
      el("label", null, "О себе", ta), el("label", null, "Ссылка (сайт или страница)", link),
      el("div", { class: "c-row" }, prev,
        el("button", { type: "button", class: "btn btn-s", text: "Загрузить фото", onclick: function () { file.click(); } }), removeBtn, file),
      own ? el("p", { class: "c-hint", text: "Это же фото показывается рядом с вашими комментариями." }) : null,
      el("div", { class: "c-row" }, el("button", { type: "button", class: "btn", text: "Сохранить", onclick: function () {
        var l = link.value.trim();
        if (l && !/^https?:\/\//i.test(l)) { note(wrap, "Ссылка должна начинаться с https://", "err"); return; }
        var patch = { bio: ta.value.trim(), link: l };
        if (!own) patch.avatar = avatar;
        writeProfile(pid, patch).then(function () { note(wrap, "Сохранено.", "ok"); done && done(); }, function (e) { note(wrap, errText(e), "err"); });
      } })));
    return wrap;
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

  /* ------------------------------------------------------------ страница номера: оценки и комментарии */
  /* Критерии оценки 1–5: ключ в базе, название, подсказка, короткое название для строки под комментарием */
  var RATE = [
    ["idea", "Замысел", "идея, образы, история номера", "замысел"],
    ["comp", "Постановка", "что придумал постановщик: рисунок, переходы, ритм, музыка", "постановка"],
    ["perf", "Исполнение", "как выступили артисты: техника, синхронность, игра", "исполнение"],
    ["stage", "Сценическое воплощение", "свет, костюмы, видео, реквизит", "сцена"],
    ["overall", "Общее впечатление", "эмоции, атмосфера, вайб", "впечатление"]
  ];
  /* Вес общего впечатления в сумме: четыре критерия по 1, общее впечатление ×1,2. Каждая оценка по-прежнему от 1 до 5. */
  var OVERALL_W = 1.2;
  var TOTAL_MAX = 4 * 5 + 5 * OVERALL_W;   // 26
  function fmtT(x) { var s = fmt1(x); return s.slice(-2) === ",0" ? s.slice(0, -2) : s; }
  var SORTS = [["old", "Сначала старые"], ["new", "Сначала новые"], ["top", "Популярные"]];
  function fmt1(x) { return (Math.round(x * 10) / 10).toFixed(1).replace(".", ","); }
  function plRate(n) {
    var m = n % 100, d = n % 10;
    return n + " " + (m > 10 && m < 20 ? "оценок" : d === 1 ? "оценка" : d > 1 && d < 5 ? "оценки" : "оценок");
  }

  /* Сумма пяти оценок: четыре критерия плюс общее впечатление ×1,2 (от 5,2 до 26). Считается только если поставлены все пять. */
  function ratingTotal(r) {
    var t = 0;
    for (var i = 0; i < RATE.length; i++) {
      var v = r && r[RATE[i][0]];
      if (!v) return null;
      t += RATE[i][0] === "overall" ? v * OVERALL_W : v;
    }
    return Math.round(t * 10) / 10;
  }
  function tipText(k, v) { return k[1] + ": " + v + " из 5" + (k[2] ? " (" + k[2] + ")" : ""); }
  function closeTips(except) { Array.prototype.forEach.call(document.querySelectorAll(".rt-chip.is-open,.rt-total.is-open"), function (n) { if (n !== except) n.classList.remove("is-open"); }); }
  document.addEventListener("click", function (e) { if (!e.target.closest || !e.target.closest(".rt-chip,.rt-total")) closeTips(); });
  /* Компактная строка оценки у комментария: сумма и пять цифр, подсказка по наведению или нажатию */
  function ratingNode(r) {
    var wrap = el("div", { class: "rt", role: "group", "aria-label": "Оценка номера" });
    var tot = ratingTotal(r);
    var toggle = function (ev) { var b = ev.currentTarget; closeTips(b); b.classList.toggle("is-open"); };
    if (tot !== null) wrap.append(el("button", { type: "button", class: "rt-total", "data-tip": "Сумма: четыре критерия и общее впечатление ×1,2. " + fmtT(tot) + " из " + TOTAL_MAX, "aria-label": "Сумма оценок: " + fmtT(tot) + " из " + TOTAL_MAX, onclick: toggle }, el("b", { text: fmtT(tot) }), "/" + TOTAL_MAX));
    RATE.forEach(function (k) {
      var v = r[k[0]];
      if (!v) return;
      wrap.append(el("button", { type: "button", class: "rt-chip v" + v + (k[0] === "overall" ? " vibe" : ""), "data-tip": tipText(k, v), "aria-label": tipText(k, v), onclick: toggle, text: String(v) }));
    });
    return wrap;
  }

  function initNumber() {
    var root = document.getElementById("comments");
    if (!root) return;
    var nid = root.dataset.number;
    var directors = (root.dataset.directors || "").split(" ").filter(Boolean);
    var stage = document.getElementById("stage");
    var canSeek = !!(stage && stage.dataset.oid);
    var comments = [], loaded = false, replyTo = null, noteData = null, fail = "";
    var myLikes = {}, openLikers = {};   // мои лайки на этой странице; комментарии с раскрытым списком лайкнувших
    var ratings = [], ratingBy = {}, firstTop = {};   // оценки зрителей этого номера; они же по аккаунтам; первый комментарий каждого автора (под ним показываем оценку)
    var sortMode = "old";
    try { var sv = store() && store().getItem("sg:sort"); if (sv === "new" || sv === "old" || sv === "top") sortMode = sv; } catch (e) { }

    var sumBox = el("div", { class: "rate-sum", hidden: true });
    var sortBar = el("div", { class: "c-sort", hidden: true });
    var list = el("div", { class: "c-list" });
    var form = el("div", { class: "c-form" });
    var moments = el("details", { class: "moments", open: true });
    var noteBox = document.getElementById("director-note");
    root.append(sumBox, form, moments, sortBar, list);

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
        return Promise.all([loadAvatars(comments.map(function (c) { return c.uid; })), loadMyLikes(fresh), loadRatings(fresh)]);
      }, function (e) { loaded = true; fail = errText(e); });
    }
    /* Лайки читаются только мои (чтобы закрасить сердечко); число лайков приходит вместе с комментарием.
       Полный список лайкнувших грузится лишь когда его раскрывают. */
    function loadMyLikes(fresh) {
      myLikes = {};
      if (!state.user) return Promise.resolve();
      var uid = state.user.uid;
      return cached("likes:" + nid + ":" + uid, TTL.comments, fresh, function () {
        return fb.f.getDocs(fb.f.query(fcol("likes"), fb.f.where("uid", "==", uid), fb.f.where("numberId", "==", nid))).then(function (s) {
          return s.docs.map(function (d) { return d.data().commentId; });
        });
      }).then(function (ids) { (ids || []).forEach(function (id) { myLikes[id] = true; }); }, function () { });
    }
    /* Оценки: по одному документу на человека и номер (ratings/номер_аккаунт). Читаются списком, до 500 штук. */
    function loadRatings(fresh) {
      return cached("ratings:" + nid, TTL.comments, fresh, function () {
        return fb.f.getDocs(fb.f.query(fcol("ratings"), fb.f.where("numberId", "==", nid), fb.f.limit(500))).then(function (s) {
          return s.docs.map(function (d) {
            var x = d.data(), o = { uid: x.uid };
            RATE.forEach(function (r) { if (typeof x[r[0]] === "number") o[r[0]] = x[r[0]]; });
            return o;
          });
        });
      }).then(function (arr) {
        ratings = arr || []; ratingBy = {};
        ratings.forEach(function (r) { ratingBy[r.uid] = r; });
      }, function () { ratings = []; ratingBy = {}; });
    }
    function dropComments() { cdrop("comments:" + nid); cdrop("likes:" + nid); cdrop("ratings:" + nid); }
    function plural(n) {
      var m = n % 100, d = n % 10;
      return n + " " + (m > 10 && m < 20 ? "лайков" : d === 1 ? "лайк" : d > 1 && d < 5 ? "лайка" : "лайков");
    }
    function toggleLike(c) {
      if (!state.user) { toast("Войдите, чтобы ставить лайки."); return Promise.resolve(); }
      var uid = state.user.uid, on = !myLikes[c.id], b = fb.f.writeBatch(fb.db), ref = fdoc("likes/" + c.id + "_" + uid), cref = fdoc("comments/" + c.id);
      if (on) {
        b.set(ref, { commentId: c.id, numberId: nid, uid: uid, userName: state.user.displayName || "Без имени", createdAt: fb.f.serverTimestamp() });
        b.update(cref, { likeCount: fb.f.increment(1) });
      } else {
        b.delete(ref);
        b.update(cref, { likeCount: fb.f.increment(-1) });
      }
      return b.commit().then(function () {
        myLikes[c.id] = on;
        c.likeCount = Math.max(0, (c.likeCount || 0) + (on ? 1 : -1));
        dropComments(); cdrop("likers:" + c.id);
        drawList();
      }, function (e) { toast(errText(e)); });
    }
    /* список лайкнувших: один запрос, только после раскрытия */
    function likersBox(c) {
      var box = el("div", { class: "like-list" }, el("p", { class: "c-hint", text: "Загружаем…" }));
      cached("likers:" + c.id, 30e3, false, function () {
        return fb.f.getDocs(fb.f.query(fcol("likes"), fb.f.where("commentId", "==", c.id), fb.f.limit(200))).then(function (s) {
          return s.docs.map(function (d) { var x = d.data(); return { uid: x.uid, userName: x.userName, createdAt: x.createdAt }; });
        });
      }).then(function (arr) {
        arr.sort(function (a, b) { return ms(a) - ms(b); });
        return loadAvatars(arr.map(function (a) { return a.uid; })).then(function () { return arr; });
      }).then(function (arr) {
        clear(box);
        if (!arr.length) { box.append(el("p", { class: "c-hint", text: "Лайков пока нет." })); return; }
        arr.forEach(function (a) {
          box.append(el("a", { class: "c-who", href: ROOT + "u/?id=" + encodeURIComponent(a.uid), title: "Страница пользователя" },
            avatarNode(a.uid, a.userName, "xs"), el("span", { text: a.userName || "Без имени" })));
        });
      }, function (e) { clear(box).append(el("p", { class: "msg msg-err", text: errText(e) })); });
      return box;
    }
    /* комментарий удаляется вместе со своими лайками одним пакетом */
    function deleteComment(c) {
      return fb.f.getDocs(fb.f.query(fcol("likes"), fb.f.where("commentId", "==", c.id), fb.f.limit(450))).then(function (s) {
        var b = fb.f.writeBatch(fb.db);
        s.forEach(function (d) { b.delete(d.ref); });
        b.delete(fdoc("comments/" + c.id));
        return b.commit();
      }).then(function () { cdrop("likers:" + c.id); });
    }
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
        el("a", { class: "c-who", href: c.authorPersonId ? ROOT + "p/" + c.authorPersonId + "/" : ROOT + "u/?id=" + encodeURIComponent(c.uid), title: "Страница автора" },
          avatarNode(c.uid, c.authorName, "xs"), el("strong", { text: c.authorName || "Без имени" })),
        isDir && el("span", { class: "badge", text: "Постановщик" }),
        c.status === "hidden" && el("span", { class: "badge badge-off", text: "Скрыт" }),
        el("a", { class: "c-date", href: "#c-" + c.id, text: when(c) }));
      var actions = el("p", { class: "c-actions" });
      var n = c.likeCount || 0, liked = !!myLikes[c.id];
      if (c.status !== "hidden") actions.append(el("button", { type: "button", class: "like-btn" + (liked ? " is-on" : ""), "aria-pressed": liked ? "true" : "false",
        "aria-label": liked ? "Убрать лайк" : "Поставить лайк", title: liked ? "Убрать лайк" : "Нравится", onclick: function () { toggleLike(c); } },
        el("span", { "aria-hidden": "true", text: "♥" })));
      if (n > 0) actions.append(el("button", { type: "button", class: "linkbtn like-count", "aria-expanded": openLikers[c.id] ? "true" : "false", text: plural(n),
        onclick: function () { openLikers[c.id] = !openLikers[c.id]; drawList(); } }));
      if (!isReply && state.user) actions.append(el("button", { type: "button", class: "linkbtn", text: "Ответить", onclick: function () { replyTo = c; drawForm(); form.scrollIntoView({ block: "center" }); } }));
      if (state.admin) actions.append(el("button", { type: "button", class: "linkbtn", text: c.status === "hidden" ? "Показать" : "Скрыть", onclick: function () { act(fb.f.updateDoc(fdoc("comments/" + c.id), { status: c.status === "hidden" ? "visible" : "hidden" })); } }));
      if (mine || state.admin) actions.append(el("button", { type: "button", class: "linkbtn", text: "Удалить", onclick: function () { if (confirm("Удалить комментарий насовсем?")) act(deleteComment(c)); } }));
      var rt = !isReply && firstTop[c.uid] === c.id && ratingBy[c.uid], rline = rt ? ratingNode(rt) : null;
      return el("article", { class: "comment" + (isReply ? " reply" : "") + (c.status === "hidden" ? " is-hidden" : ""), id: "c-" + c.id },
        head, el("p", { class: "c-text" }, richText(c.text, canSeek)), rline, actions, n > 0 && openLikers[c.id] ? likersBox(c) : null);
    }
    function act(p) { return p.then(function () { dropComments(); return loadComments(true); }).then(draw, function (e) { toast(errText(e)); }); }

    /* Сводка: средняя сумма крупно, пять средних полосками (четыре критерия и общее впечатление) */
    function drawSummary() {
      clear(sumBox);
      if (!ratings.length) { sumBox.hidden = true; return; }
      var sum = {}, cnt = {}, tsum = 0, tcnt = 0;
      ratings.forEach(function (r) {
        RATE.forEach(function (k) { if (r[k[0]]) { sum[k[0]] = (sum[k[0]] || 0) + r[k[0]]; cnt[k[0]] = (cnt[k[0]] || 0) + 1; } });
        var t = ratingTotal(r); if (t !== null) { tsum += t; tcnt++; }
      });
      var bars = el("ul", { class: "rate-bars" });
      RATE.forEach(function (k) {
        var v = cnt[k[0]] ? sum[k[0]] / cnt[k[0]] : null;
        bars.append(el("li", { class: k[0] === "overall" ? "vibe" : null, title: k[2] ? k[1] + ": " + k[2] : k[1] },
          el("span", { class: "rate-bar-name", text: k[1] }),
          el("span", { class: "rate-bar", role: "img", "aria-label": v === null ? "нет оценок" : fmt1(v) + " из 5" }, el("i", { style: "width:" + (v === null ? 0 : Math.round(v / 5 * 100)) + "%" })),
          el("span", { class: "rate-bar-val", text: v === null ? "–" : fmt1(v) })));
      });
      sumBox.append(el("h3", { text: "Оценки зрителей" }),
        el("div", { class: "rate-sum-grid" },
          tcnt ? el("p", { class: "rate-big" }, el("strong", { text: fmtT(tsum / tcnt) }), el("span", { text: " из " + TOTAL_MAX }),
            el("small", { text: "средняя сумма, " + plRate(tcnt) })) : el("p", { class: "rate-big" }, el("small", { text: plRate(ratings.length) + ", полных нет" })),
          bars));
      sumBox.hidden = false;
    }
    function drawSort(topCount) {
      clear(sortBar);
      sortBar.hidden = topCount < 2;
      if (topCount < 2) return;
      sortBar.append(el("span", { class: "c-sort-label", text: "Порядок:" }));
      SORTS.forEach(function (s) {
        sortBar.append(el("button", { type: "button", class: "chip", "aria-pressed": sortMode === s[0] ? "true" : "false", text: s[1],
          onclick: function () {
            sortMode = s[0];
            try { store() && store().setItem("sg:sort", sortMode); } catch (e) { }
            drawList();
          } }));
      });
    }
    function cmpFor(mode) {
      if (mode === "new") return function (a, b) { return ms(b) - ms(a); };
      if (mode === "top") return function (a, b) { return (b.likeCount || 0) - (a.likeCount || 0) || ms(a) - ms(b); };
      return function (a, b) { return ms(a) - ms(b); };
    }

    function drawList() {
      clear(list);
      if (!loaded) { sortBar.hidden = true; list.append(el("p", { class: "c-empty", text: "Загружаем комментарии…" })); return; }
      if (fail) { sortBar.hidden = true; list.append(el("p", { class: "msg msg-err", text: "Комментарии не загрузились: " + fail })); return; }
      var top = comments.filter(function (c) { return !c.parentId; });
      var byParent = {};
      comments.forEach(function (c) { if (c.parentId) (byParent[c.parentId] = byParent[c.parentId] || []).push(c); });
      var ids = {}; comments.forEach(function (c) { ids[c.id] = 1; });
      comments.forEach(function (c) { if (c.parentId && !ids[c.parentId]) top.push(c); }); // ответ на удалённый
      firstTop = {};
      top.slice().sort(function (a, b) { return ms(a) - ms(b); }).forEach(function (c) { if (!firstTop[c.uid]) firstTop[c.uid] = c.id; });
      top.sort(cmpFor(sortMode));
      drawSort(top.length);
      if (!top.length) list.append(el("p", { class: "c-empty", text: "Пока нет комментариев. Напишите первым." }));
      top.forEach(function (c) {
        list.append(commentNode(c, false));
        (byParent[c.id] || []).forEach(function (r) { list.append(commentNode(r, true)); });
      });
    }

    /* Форма: необязательные оценки (ползунки, выпадающий блок), потом комментарий */
    function drawForm() {
      clear(form);
      if (!state.ready) return;
      if (!state.user) {
        form.append(el("p", { class: "c-hint", text: "Чтобы поставить оценку или написать комментарий, войдите." }),
          el("button", { type: "button", class: "btn", text: "Войти", onclick: signIn }));
        return;
      }
      var uid = state.user.uid;
      var prev = ratingBy[uid] || null;                // уже сохранённая оценка этого человека
      var draft = {}; RATE.forEach(function (k) { if (prev && prev[k[0]]) draft[k[0]] = prev[k[0]]; });
      var cleared = false;                              // человек нажал «Убрать оценку»

      var ta = el("textarea", { class: "c-input", rows: "3", maxlength: "2000", placeholder: canSeek ? "Ваш комментарий. Время вида 1:23:45 станет ссылкой на этот момент записи." : "Ваш комментарий", "aria-label": "Комментарий" });
      var send = el("button", { type: "submit", class: "btn", text: "Отправить" });

      function setCount() { return Object.keys(draft).length; }
      function same() { return RATE.every(function (k) { return (draft[k[0]] || 0) === ((prev && prev[k[0]]) || 0); }); }
      function rateChanged() { return !same(); }
      function syncSend() {
        var hasText = !!ta.value.trim(), rc = rateChanged() && setCount() > 0;
        send.textContent = hasText ? (rc ? "Отправить с оценкой" : "Отправить") : (rc ? "Сохранить оценку" : (cleared ? "Убрать оценку" : "Отправить"));
      }

      var rateBox = null;
      if (!replyTo) {
        var sumLine = el("span", { class: "rate-state" }), totalLine = el("p", { class: "rate-total" });
        var painters = [];
        var showState = function () {
          var n = setCount(), tot = ratingTotal(draft);
          sumLine.textContent = cleared ? "оценку уберём" : prev && same() && tot !== null ? "ваша оценка сохранена" : n ? "выбрано " + n + " из " + RATE.length : "необязательно";
          totalLine.textContent = tot !== null ? "Сумма: " + fmtT(tot) + " из " + TOTAL_MAX + " (общее впечатление считается с множителем 1,2)" : "Сумма появится, когда поставите все пять оценок";
          totalLine.classList.toggle("is-full", tot !== null);
        };
        var sliderRow = function (k) {
          var out = el("span", { class: "rate-val", "aria-hidden": "true", text: "–" });
          var inp = el("input", { type: "range", class: "rate-range", min: "1", max: "5", step: "1", value: String(draft[k[0]] || 3), "aria-label": k[1] + (k[2] ? " (" + k[2] + ")" : "") + ", от 1 до 5" });
          var paint = function () {
            var v = draft[k[0]];
            inp.classList.toggle("is-unset", !v);
            inp.style.setProperty("--p", v ? ((v - 1) / 4 * 100) + "%" : "0%");
            out.textContent = v ? String(v) : "–";
            inp.setAttribute("aria-valuetext", v ? v + " из 5" : "не выбрано");
          };
          var take = function () { draft[k[0]] = Number(inp.value); cleared = false; paint(); showState(); syncSend(); };
          inp.addEventListener("input", take);
          inp.addEventListener("pointerup", take);     // нажать на среднюю тройку без сдвига тоже считается выбором
          painters.push(function () { inp.value = String(draft[k[0]] || 3); paint(); });
          paint();
          return el("div", { class: "rate-row" },
            el("div", { class: "rate-head" }, el("span", { class: "rate-name" }, k[1], k[2] ? el("small", { text: k[2] }) : null), out),
            inp, el("span", { class: "rate-ticks", "aria-hidden": "true" }, el("i", { text: "1" }), el("i", { text: "2" }), el("i", { text: "3" }), el("i", { text: "4" }), el("i", { text: "5" })));
        };
        var grpCrit = el("div", { class: "rate-grp" }), grpVibe = el("div", { class: "rate-grp rate-vibe" });
        RATE.forEach(function (k) { (k[0] === "overall" ? grpVibe : grpCrit).append(sliderRow(k)); });
        grpVibe.append(el("p", { class: "rate-feel", text: "Эмоциональный отклик: что вы почувствовали? Этот пункт про ощущение от номера в целом, и в сумме он весит больше остальных (×1,2). Своими словами расскажите об этом в комментарии ниже." }));
        var reset = el("button", { type: "button", class: "linkbtn", text: prev ? "Убрать мою оценку" : "Сбросить", onclick: function () {
          draft = {}; cleared = !!prev;
          painters.forEach(function (f) { f(); });
          showState(); syncSend();
        } });
        rateBox = el("details", { class: "rate-box" },
          el("summary", null, el("span", { text: prev ? "Ваша оценка номера" : "Оценить номер" }), " ", sumLine),
          el("p", { class: "c-hint", text: "От 1 до 5, ползунком. Нужны все пять пунктов, сумма считается по ним. Если оценка не нужна, оставьте блок закрытым." }),
          grpCrit, grpVibe, totalLine, el("div", { class: "c-row" }, reset));
        showState();
      }

      var rules = el("p", { class: "c-rules" },
        el("strong", { text: "Мат не проходит. " }),
        "Комментарий с нецензурными словами не отправится: перепишите его. Пишите о номере и по делу, без оскорблений.");

      ta.addEventListener("input", syncSend);
      var f = el("form", { onsubmit: function (ev) {
        ev.preventDefault();
        var text = ta.value.trim(), full = setCount() === RATE.length;
        if (setCount() && !full && rateChanged()) { note(form, "Оцените все пять пунктов или нажмите «Сбросить».", "err"); return; }
        var wantRate = full && rateChanged(), wantClear = cleared && !!prev && !wantRate;
        if (!text && !wantRate && !wantClear) { note(form, replyTo ? "Напишите текст ответа." : "Напишите комментарий или поставьте оценку.", "err"); return; }
        if (text) {
          var bad = findProfanity(text);
          if (bad) { note(form, "Мат не проходит: слово «" + bad + "». Уберите его и отправьте снова.", "err"); ta.focus(); return; }
        }
        send.disabled = true;
        var b = fb.f.writeBatch(fb.db);
        if (text) {
          var data = { numberId: nid, uid: uid, authorName: state.user.displayName || "Без имени", text: text, createdAt: fb.f.serverTimestamp(), status: "visible" };
          if (replyTo) data.parentId = replyTo.id;
          var pid = myDirectorPerson();
          if (pid) data.authorPersonId = pid;
          b.set(fb.f.doc(fcol("comments")), data);
        }
        var rref = fdoc("ratings/" + nid + "_" + uid);
        if (wantRate) {
          var rd = { numberId: nid, uid: uid, updatedAt: fb.f.serverTimestamp() };
          RATE.forEach(function (k) { rd[k[0]] = draft[k[0]]; });
          b.set(rref, rd);
        } else if (wantClear) b.delete(rref);
        b.commit().then(function () { replyTo = null; dropComments(); return loadComments(true); }).then(draw, function (e) { send.disabled = false; note(form, errText(e), "err"); });
      } },
        replyTo && el("p", { class: "c-replyto" }, "Ответ для " + replyTo.authorName + " ",
          el("button", { type: "button", class: "linkbtn", text: "отменить", onclick: function () { replyTo = null; drawForm(); } })),
        rateBox, rules, ta, el("div", { class: "c-row" }, send,
          el("span", { class: "c-hint", text: "Вы пишете как " + (state.user.displayName || "Без имени") + (myDirectorPerson() ? ", постановщик" : "") })));
      form.append(f);
      syncSend();
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

    function draw() { drawSummary(); drawMoments(); drawList(); drawForm(); drawNote(); }
    views.push(function () { loaded = false; replyTo = null; draw(); Promise.all([loadComments(), loadNote()]).then(draw); });
  }

  /* ------------------------------------------------------------ страница человека */
  function initPerson() {
    var box = document.getElementById("claim");
    if (!box) return;
    var pid = box.dataset.person, pname = box.dataset.name, isDirector = box.dataset.director === "1";
    var claim = null, profile = null, profileLoaded = false;
    var aboutEl = document.getElementById("p-about"), linkEl = document.getElementById("p-link"), avatarEl = document.getElementById("p-avatar");

    function approved() { return !!(claim && claim.status === "approved"); }
    function loadPublic(fresh) {
      fresh = fresh === true;
      return Promise.all([
        cached("pub:claim:" + pid, TTL.pub, fresh, function () { return fb.f.getDoc(fdoc("claims/" + pid)).then(function (s) { return s.exists() ? s.data() : null; }); })
          .then(function (v) { claim = v; }, function () { claim = null; }),
        profileCached(pid, fresh).then(function (v) { profile = v; }, function () { profile = null; })
      ]).then(function () {
        if (!approved()) return;
        // фото владельца: подтягиваем на страницу, а гостям показываем фото аккаунта, пока у страницы нет своего
        return loadAvatars([claim.uid]).then(function () {
          if (mine()) return ownProfile(pid).then(function (p) { profile = p; });
        }).catch(function () { });
      }).then(function () { profileLoaded = true; });
    }
    function reloadPublic() { cdrop("pub:"); return loadPublic(true); }
    function applyProfile() {
      if (profile && profile.bio && aboutEl) { aboutEl.textContent = profile.bio; aboutEl.hidden = false; }
      if (profile && profile.link && linkEl) {
        clear(linkEl).append(el("a", { href: profile.link, rel: "noopener ugc", text: profile.link.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") }));
        linkEl.hidden = false;
      }
      var av = profile && profile.avatar || (approved() && avatars[claim.uid]) || "";
      if (avatarEl) { if (av) { avatarEl.src = av; avatarEl.hidden = false; } else avatarEl.hidden = true; }
    }

    function mine() { return !!(state.user && claim && claim.uid === state.user.uid && claim.status === "approved"); }
    function claimPerson() {
      var u = state.user;
      return fb.f.setDoc(fdoc("claims/" + pid), { uid: u.uid, name: u.displayName || "Без имени", status: "pending", createdAt: fb.f.serverTimestamp() })
        .then(function () { return loadMe(u, true); }).then(reloadPublic).then(draw, function (e) {
          note(box, e && e.code === "permission-denied"
            ? "Страница ещё не передана сервису. Попросите администратора открыть «Кабинет» и нажать «Обновить список»."
            : errText(e), "err");
        });
    }

    function draw() {
      clear(box);
      if (!state.ready || !profileLoaded) return;
      applyProfile();
      box.hidden = false;
      var u = state.user;
      if (approved()) box.append(el("p", { class: "c-hint", text: "Страница подтверждена владельцем." }));
      if (!u) {
        if (!claim) box.append(el("p", { class: "c-hint", text: "Это вы? Войдите через Google, чтобы вести эту страницу." }), el("button", { type: "button", class: "btn", text: "Войти через Google", onclick: signIn }));
      } else if (!claim) {
        box.append(el("button", { type: "button", class: "btn", text: "Это моя страница", onclick: claimPerson }),
          el("p", { class: "c-hint", text: "Заявку проверит и подтвердит администратор." }));
      } else if (claim.uid === u.uid && claim.status === "pending") {
        box.append(el("p", { class: "msg", text: "Заявка отправлена. Администратор подтвердит её, и здесь появится редактирование." }),
          el("button", { type: "button", class: "linkbtn", text: "Отозвать заявку", onclick: function () { fb.f.deleteDoc(fdoc("claims/" + pid)).then(function () { return loadMe(u, true); }).then(reloadPublic).then(draw); } }));
      }
      if (mine()) {
        box.append(el("div", { class: "c-row" }, shareButton(pid, pname), el("a", { class: "btn btn-s btn-ghost", href: ROOT + "account/", text: "Мой кабинет" })),
          el("details", { class: "edit-box" }, el("summary", { text: "Редактировать страницу" }),
            profileEditor(pid, profile, aboutEl ? aboutEl.textContent.trim() : "", true, function () { reloadPublic().then(draw); })),
          el("button", { type: "button", class: "linkbtn", text: "Отказаться от страницы", onclick: function () { if (confirm("Отвязать аккаунт от этой страницы?")) fb.f.deleteDoc(fdoc("claims/" + pid)).then(function () { return loadMe(u, true); }).then(reloadPublic).then(draw); } }));
      }
      if (state.admin) {
        var adm = el("div", { class: "admin-box" }, el("p", { class: "c-hint", text: claim ? "Аккаунт: " + claim.name + ", статус: " + (claim.status === "approved" ? "подтверждён" : "ждёт подтверждения") : "Страницу пока никто не занял." }));
        if (claim && claim.status === "pending") adm.append(el("button", { type: "button", class: "btn", text: "Подтвердить", onclick: function () { approveClaim(pid, claim.uid).then(reloadPublic).then(draw, function (e) { toast(errText(e)); }); } }));
        if (claim) adm.append(el("button", { type: "button", class: "linkbtn", text: "Отозвать доступ", onclick: function () { if (confirm("Отозвать доступ у «" + claim.name + "»?")) fb.f.deleteDoc(fdoc("claims/" + pid)).then(reloadPublic).then(draw); } }));
        if (!mine()) adm.append(el("details", { class: "edit-box" }, el("summary", { text: "Править страницу как администратор" }),
          profileEditor(pid, profile, aboutEl ? aboutEl.textContent.trim() : "", false, function () { reloadPublic().then(draw); })));
        box.append(adm);
      }
    }
    views.push(function () { draw(); loadPublic().then(draw); });
  }

  /* ------------------------------------------------------------ страница пользователя
     Создаётся сама для каждого, кто оставил комментарий: имя, фото и его комментарии.
     Если аккаунт подтверждён владельцем страницы человека, ссылка ведёт сразу на ту страницу. */
  function initUserPage() {
    var box = document.getElementById("user-page");
    if (!box) return;
    var uid = new URLSearchParams(location.search).get("id") || "";
    var data = null, titles = {}, done = false, moved = false;

    function load() {
      if (!uid) { done = true; return Promise.resolve(); }
      return Promise.all([
        cached("user:claims:" + uid, TTL.pub, false, function () {
          return fb.f.getDocs(fb.f.query(fcol("claims"), fb.f.where("uid", "==", uid))).then(function (s) {
            var o = {}; s.forEach(function (d) { o[d.id] = d.data(); }); return o;
          });
        }).catch(function () { return {}; }),
        cached("user:comments:" + uid, TTL.pub, false, function () {
          return fb.f.getDocs(fb.f.query(fcol("comments"), fb.f.where("uid", "==", uid), fb.f.where("status", "==", "visible"), fb.f.limit(100))).then(function (s) {
            var a = [];
            s.forEach(function (d) { var x = d.data(); a.push({ id: d.id, numberId: x.numberId, text: x.text, authorName: x.authorName, createdAt: x.createdAt, likeCount: x.likeCount || 0 }); });
            return a;
          });
        }).catch(function () { return null; }),
        loadAvatars([uid]),
        fetch(ROOT + "catalog.json").then(function (r) { return r.json(); }).then(function (j) {
          (j.numbers || []).forEach(function (n) { titles[n.id] = n.title; });
        }).catch(function () { })
      ]).then(function (r) {
        var cl = r[0] || {}, pids = Object.keys(cl).filter(function (p) { return cl[p].status === "approved"; });
        if (pids.length) { moved = true; location.replace(ROOT + "p/" + pids[0] + "/"); return; }
        data = r[1]; done = true;
      });
    }
    function ms(c) { return c.createdAt && c.createdAt.toMillis ? c.createdAt.toMillis() : 0; }
    function when(c) {
      return c.createdAt && c.createdAt.toDate
        ? c.createdAt.toDate().toLocaleString("ru-RU", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
    }

    function draw() {
      clear(box);
      if (!uid) { box.append(el("p", { class: "c-hint", text: "Не указан пользователь." })); return; }
      if (!done || moved) { box.append(el("p", { class: "c-hint", text: "Загрузка…" })); return; }
      var self = !!(state.user && state.user.uid === uid);
      var list = (data || []).slice().sort(function (a, b) { return ms(b) - ms(a); });
      var name = (list.length && list[0].authorName) || (self && state.user.displayName) || "Пользователь";
      document.title = document.title.replace(/^[^:]*:/, name + ":");
      box.append(el("div", { class: "user-head" }, avatarNode(uid, name, "l"),
        el("div", null, el("h1", { text: name }),
          el("p", { class: "c-hint", text: data === null ? "Комментарии не загрузились." : "Комментариев: " + list.length }))));
      if (self) box.append(el("div", { class: "c-row" }, shareButton("", name, location.href), el("a", { class: "btn btn-s btn-ghost", href: ROOT + "account/", text: "Мой кабинет" })));
      if (data && !list.length) box.append(el("p", { class: "c-empty", text: "Пока нет комментариев." }));
      var ul = el("div", { class: "c-list" });
      list.forEach(function (c) {
        ul.append(el("article", { class: "comment user-comment" },
          el("p", { class: "c-head" },
            el("a", { href: ROOT + "n/" + c.numberId + "/#c-" + c.id, text: titles[c.numberId] || "Номер" }),
            el("span", { class: "c-date", text: when(c) }),
            c.likeCount ? el("span", { class: "c-date", text: "♥ " + c.likeCount }) : null),
          el("p", { class: "c-text", text: c.text })));
      });
      box.append(ul);
    }
    views.push(draw);
    load().then(draw);
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
    var myProfiles = {};   // pid → профиль страницы, которой владеет этот аккаунт

    function loadMine() {
      myProfiles = {};
      if (!state.user) return Promise.resolve();
      return Promise.all(approvedPids().map(function (pid) {
        return ownProfile(pid).then(function (p) { myProfiles[pid] = p || {}; }, function () { myProfiles[pid] = {}; });
      }));
    }

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

    /* своя фотография: сжимается в браузере и хранится строкой. Одно фото на аккаунт и на все его подтверждённые страницы. */
    function avatarBox() {
      var u = state.user, wrap = el("div", { class: "avatar-edit" });
      var file = el("input", { type: "file", accept: "image/*", "aria-label": "Выбрать фото", hidden: true, onchange: function () {
        var f = file.files[0]; if (!f) return;
        note(wrap, "Загружаем…");
        setMyAvatar(f).then(function () { note(wrap, "Фото сохранено.", "ok"); return loadMine(); }).then(draw,
          function (e) { note(wrap, e && e.code ? errText(e) : e.message, "err"); });
        file.value = "";
      } });
      var on = approvedPids().length ? " и на вашей странице" : "";
      wrap.append(avatarNode(u.uid, u.displayName, "l"),
        el("div", null,
          el("button", { type: "button", class: "btn btn-s", text: avatars[u.uid] ? "Заменить фото" : "Загрузить фото", onclick: function () { file.click(); } }),
          avatars[u.uid] && el("button", { type: "button", class: "linkbtn", text: "Убрать фото", onclick: function () { clearMyAvatar().then(loadMine).then(draw, function (e) { note(wrap, errText(e), "err"); }); } }),
          el("p", { class: "c-hint", text: "Фото видно рядом с вашими комментариями" + on + ". Подойдёт любая картинка, она сожмётся и обрежется до квадрата." })),
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
      if (!mineIds.length) box.append(el("p", { class: "c-hint", text: "Пока нет. Откройте свою страницу в каталоге и нажмите «Это моя страница». После подтверждения она станет вашим кабинетом: фото и описание общие, а ссылкой на страницу можно делиться." }));
      else {
        var ul = el("div", { class: "my-pages" });
        mineIds.forEach(function (pid) {
          var ok = state.claims[pid].status === "approved", pr = myProfiles[pid] || {};
          var shown = pr.avatar || avatars[state.user.uid] || "";
          var card = el("div", { class: "my-page" },
            shown ? el("img", { class: "avatar avatar-l", src: shown, alt: "" }) : avatarNode(state.user.uid, nameOf(pid), "l"),
            el("div", { class: "my-page-body" },
              el("div", null, el("a", { href: ROOT + "p/" + pid + "/", text: nameOf(pid) }), " ",
                el("span", { class: "badge" + (ok ? "" : " badge-off"), text: ok ? "подтверждена" : "ждёт подтверждения" })),
              ok && pr.bio ? el("p", { class: "c-hint my-page-bio", text: pr.bio.length > 160 ? pr.bio.slice(0, 160) + "…" : pr.bio }) : null,
              ok ? el("div", { class: "c-row" }, shareButton(pid, nameOf(pid)), el("a", { class: "btn btn-s btn-ghost", href: ROOT + "p/" + pid + "/", text: "Открыть страницу" })) : null),
            ok ? el("details", { class: "edit-box my-page-edit" }, el("summary", { text: "Описание, ссылка и фото" }),
              profileEditor(pid, pr, "", true, function () { loadMine().then(draw); })) : null);
          ul.append(card);
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
              el("button", { type: "button", class: "btn btn-s", text: "Подтвердить", onclick: function () { approveClaim(c.id, c.uid).then(reload); } }), " ",
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
    function reload() { loadMe(state.user, true).then(loadAdmin).then(loadMine).then(draw); }
    views.push(function () {
      draw();
      loadMine().then(draw);
      loadCatalog().then(function () {
        if (!state.admin) return draw();
        return sync(false).then(function (m) { syncMsg = /обновлён/.test(m) ? m : ""; }, function (e) { syncMsg = errText(e); }).then(loadAdmin).then(draw);
      });
    });
  }

  /* ------------------------------------------------------------ запуск */
  var slot = document.getElementById("auth-slot");
  load().then(function () {
    initNumber(); initPerson(); initAccount(); initUserPage();
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
