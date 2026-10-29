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
  /* сроки хранения в браузере; свои изменения человека сбрасывают нужные ключи сразу, не дожидаясь срока */
  var TTL = { me: 3 * 86400e3, pub: 10 * 60e3, comments: 10 * 60e3, note: 2 * 60e3, avatar: 14 * 86400e3 };
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
    return fetchFn().then(function (v) { cput(key, v); return v; }, function (e) {
      /* нет сети или сервис не отвечает: показываем сохранённое раньше, каким бы старым оно ни было */
      var old = cget(key, Infinity);
      if (old) return old.v;
      throw e;
    });
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

  /* ------------------------------------------------------------ лимиты
     Счётчики лежат в usage/{аккаунт}_d{день} (комментарии, лайки) и usage/{аккаунт}_m{месяц} (фото, смена имени).
     День и месяц считаются по времени Самары (UTC+4), так же, как в правилах базы. */
  var LIM = { comments: 10, likes: 50, avatars: 3, renames: 5 };
  function sTime() { return new Date(Date.now() + 4 * 3600e3); }
  function dayStamp() { var d = sTime(); return d.getUTCFullYear() + "-" + (d.getUTCMonth() + 1) + "-" + d.getUTCDate(); }
  function monthStamp() { var d = sTime(); return d.getUTCFullYear() + "-" + (d.getUTCMonth() + 1); }
  function usageRef(kind) { return fdoc("usage/" + state.user.uid + "_" + (kind === "d" ? "d" + dayStamp() : "m" + monthStamp())); }
  function readUsage(kind) { return fb.f.getDoc(usageRef(kind)).then(function (s) { return s.exists() ? s.data() : {}; }); }
  function bumpUsage(batch, kind, cur, field) {
    var d = { uid: state.user.uid, updatedAt: fb.f.serverTimestamp() };
    (kind === "d" ? ["comments", "likes"] : ["avatars", "renames"]).forEach(function (f) { d[f] = (cur[f] || 0) + (f === field ? 1 : 0); });
    batch.set(usageRef(kind), d);
  }

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
  function signOut() { cdrop("me:"); cdrop("ua:"); return fb.a.signOut(fb.auth); }

  var avatars = {};   // uid → картинка (строка) или "" если фото нет
  var nicks = {};     // uid → ник из кабинета или "" (если не менялся)
  var realNames = {}; // uid → имя аккаунта (публичное поле users/{uid}.name)
  var userLinks = {};     // uid → ссылки на соцсети { vk, tg, ig, yt, web }
  var peopleNames = {};   // id страницы человека → имя на странице (из каталога)
  function nrm(s) { return String(s || "").trim().replace(/\s+/g, " ").toLowerCase().replace(/ё/g, "е"); }
  function myName() { var u = state.user; return u ? (nicks[u.uid] || u.displayName || "Без имени") : "Без имени"; }
  /* Имя на странице не меняется. Если ник отличается от него, рядом в скобках стоит имя со страницы. */
  function fullName(name, pid) {
    var n = name || "Без имени", pn = pid && peopleNames[pid];
    return pn && nrm(pn) !== nrm(n) ? n + " (" + pn + ")" : n;
  }
  function putUA(u) { cput("ua:" + u, { a: avatars[u] || "", n: nicks[u] || "", m: realNames[u] || "", l: userLinks[u] || {} }); }

  function loadMe(user, fresh) {
    state.user = user; state.admin = false; state.claims = {};
    /* запоминаем, что человек входил: при следующем заходе кружок аватарки виден сразу, ещё до ответа сервиса */
    try { if (user) { window.localStorage.setItem("sg:signed", "1"); document.documentElement.setAttribute("data-signed", "1"); } else { window.localStorage.removeItem("sg:signed"); document.documentElement.removeAttribute("data-signed"); } } catch (e) { }
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
    ]).then(function () {
      state.ready = true;
      /* публичное имя аккаунта нужно, чтобы у страницы пользователя было имя, даже если он ещё ничего не писал */
      var nm = user.displayName || "";
      if (nm && realNames[uid] !== nm) {
        fb.f.setDoc(fdoc("users/" + uid), { name: nm.slice(0, 100), updatedAt: fb.f.serverTimestamp() }, { merge: true })
          .then(function () { realNames[uid] = nm; putUA(uid); }, function () { });
      }
    });
  }

  /* фото пользователей: users/{uid}.avatar, маленькая картинка. Несколько uid читаются одним запросом. */
  function loadAvatars(uids, fresh) {
    var need = [];
    uids.forEach(function (u) {
      if (!u || (!fresh && avatars[u] !== undefined)) return;
      var hit = fresh ? null : cget("ua:" + u, TTL.avatar);
      if (hit) { avatars[u] = hit.v.a || ""; nicks[u] = hit.v.n || ""; realNames[u] = hit.v.m || ""; userLinks[u] = hit.v.l || {}; } else if (need.indexOf(u) === -1) need.push(u);
    });
    if (!need.length) return Promise.resolve();
    var jobs = [];
    for (var i = 0; i < need.length; i += 30) {
      (function (chunk) {
        jobs.push(fb.f.getDocs(fb.f.query(fcol("users"), fb.f.where(fb.f.documentId(), "in", chunk))).then(function (s) {
          var got = {}, gotN = {}, gotM = {}, gotL = {};
          s.forEach(function (d) { var x = d.data(); got[d.id] = x.avatar || ""; gotN[d.id] = x.nick || ""; gotM[d.id] = x.name || ""; gotL[d.id] = x.links || {}; });
          chunk.forEach(function (u) { avatars[u] = got[u] || ""; nicks[u] = gotN[u] || ""; realNames[u] = gotM[u] || ""; userLinks[u] = gotL[u] || {}; putUA(u); });
        }, function () { chunk.forEach(function (u) { if (avatars[u] === undefined) { avatars[u] = ""; nicks[u] = ""; realNames[u] = ""; userLinks[u] = {}; } }); }));
      })(need.slice(i, i + 30));
    }
    return Promise.all(jobs);
  }
  function hue(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; }
  /* круглая картинка: фото или первая буква имени */

  function avatarNode(uid, name, size) {
    var cls = "avatar avatar-" + (size || "s");
    if (avatars[uid]) return el("img", { class: cls, src: avatars[uid], alt: "" });
    var ch = (String(name || "?").trim().charAt(0) || "?").toUpperCase();
    var n = el("span", { class: cls + " avatar-init", "aria-hidden": "true", text: ch });
    n.style.background = "hsl(" + hue(String(uid || name)) + ",35%,32%)";
    return n;
  }

  /* ссылки на соцсети в профиле: ВКонтакте, Telegram, Instagram, YouTube, сайт */
  var SOC = [
    { k: "vk", label: "ВКонтакте", ph: "https://vk.com/ваш_адрес" },
    { k: "tg", label: "Telegram", ph: "https://t.me/ваш_ник" },
    { k: "ig", label: "Instagram", ph: "https://instagram.com/ваш_ник" },
    { k: "yt", label: "YouTube", ph: "https://youtube.com/@ваш_канал" },
    { k: "web", label: "Сайт", ph: "https://" }
  ];
  var SOC_SVG = {
    vk: '<svg class="soc-i" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="2" width="20" height="20" rx="5" fill="currentColor"/><path d="M5.5 8.5h2c.1 3 1.4 4.3 2.4 4.6V8.5h1.9v2.6c1-.1 2.1-1.3 2.5-2.6h1.9c-.3 1.6-1.4 2.7-2.2 3.2.8.4 2.1 1.4 2.6 3.3h-2.1c-.4-1.3-1.4-2.3-2.7-2.4v2.4h-.3c-4 0-6.2-2.8-6.3-6.5z" fill="#0b0a08"/></svg>',
    tg: '<svg class="soc-i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M5.8 11.8l11.3-4.4c.5-.2 1 .1.8.9l-1.9 9c-.1.6-.5.8-1 .5l-2.9-2.1-1.4 1.4c-.2.2-.3.3-.6.3l.2-3 5.4-4.9c.2-.2 0-.3-.4-.1l-6.7 4.2-2.9-.9c-.6-.2-.6-.6.1-.9z" fill="#0b0a08"/></svg>',
    ig: '<svg class="soc-i" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4.2" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17.2" cy="6.8" r="1.2" fill="currentColor"/></svg>',
    yt: '<svg class="soc-i" viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="5" width="20" height="14" rx="4.5" fill="currentColor"/><path d="M10 9l5.5 3-5.5 3z" fill="#0b0a08"/></svg>',
    web: '<svg class="soc-i" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>'
  };
  /* значок: готовая разметка из константы выше, пользовательский текст сюда не попадает */
  function socIcon(kind) { var w = el("span", { class: "soc-ic" }); w.innerHTML = SOC_SVG[kind] || SOC_SVG.web; return w; }
  function socialRow(links) {
    var row = el("p", { class: "social-links" });
    SOC.forEach(function (s) {
      var u = links && links[s.k];
      if (!u || !/^https?:\/\/\S+$/i.test(u)) return;
      row.append(el("a", { class: "add-btn add-btn-s soc soc-" + s.k, href: u, rel: "noopener nofollow ugc", target: "_blank" }, socIcon(s.k), el("span", { text: s.label })));
    });
    return row.firstChild ? row : null;
  }
  /* адрес из поля: добавляем https://, пустое остаётся пустым, непохожее на адрес — null */
  function cleanUrl(v) {
    v = String(v || "").trim();
    if (!v) return "";
    if (!/^https?:\/\//i.test(v)) v = "https://" + v;
    return v.length <= 200 && /^https?:\/\/[^\s\/]+\.[^\s\/]{2,}\S*$/i.test(v) ? v : null;
  }
  function plural(n, one, few, many) {
    var a = n % 10, b = n % 100;
    return a === 1 && b !== 11 ? one : (a >= 2 && a <= 4 && !(b >= 12 && b <= 14) ? few : many);
  }
  function statItem(n, one, few, many) { return el("li", null, el("b", { text: String(n) }), " " + plural(n, one, few, many)); }
  /* число комментариев пользователя: считает сервис без загрузки самих комментариев, ответ держится в кеше */
  function commentCount(uid, fresh) {
    return cached("user:ccount:" + uid, TTL.pub, fresh === true, function () {
      var q = fb.f.query(fcol("comments"), fb.f.where("uid", "==", uid), fb.f.where("status", "==", "visible"));
      if (fb.f.getCountFromServer) return fb.f.getCountFromServer(q).then(function (s) { return s.data().count; });
      return loadUserComments(uid).then(function (l) { return l.length; });
    });
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
      cdrop("me:"); cdrop("pub:"); cdrop("admin:");
      return Promise.all([loadAvatars([uid], true), profileCached(pid, true)]).then(function (r) {
        var a = avatars[uid];
        if (a && !(r[1] && r[1].avatar)) return writeProfile(pid, { avatar: a });
      }).catch(function () { });
    });
  }
  /* Лимит фото проверяем до выбора и обрезки, чтобы человек не делал лишнюю работу */
  function avatarLimitLeft() {
    return readUsage("m").then(function (cur) {
      if ((cur.avatars || 0) >= LIM.avatars) throw new Error("Фото можно менять " + LIM.avatars + " раза в месяц. На этот месяц лимит исчерпан.");
      return cur;
    });
  }
  function setMyAvatar(file) {
    var u = state.user;
    return avatarLimitLeft().then(function (cur) {
      return Promise.all([shrink(file, 128, 30000), shrink(file, 192, 100000)]).then(function (r) {
        var b = fb.f.writeBatch(fb.db);
        b.set(fdoc("users/" + u.uid), { avatar: r[0], updatedAt: fb.f.serverTimestamp() }, { merge: true });
        bumpUsage(b, "m", cur, "avatars");
        return b.commit().then(function () {
          avatars[u.uid] = r[0]; putUA(u.uid); cdrop("comments:");
          return Promise.all(approvedPids().map(function (pid) { return writeProfile(pid, { avatar: r[1] }); }));
        }).then(function () { refreshViews(); return r[1]; });
      });
    });
  }
  function clearMyAvatar() {
    var u = state.user;
    return fb.f.setDoc(fdoc("users/" + u.uid), { avatar: "", updatedAt: fb.f.serverTimestamp() }, { merge: true }).then(function () {
      avatars[u.uid] = ""; putUA(u.uid); cdrop("comments:");
      return Promise.all(approvedPids().map(function (pid) { return writeProfile(pid, { avatar: "" }); }));
    }).then(function () { refreshViews(); });
  }
  /* Смена имени в кабинете: имя на странице не меняется, в комментариях появится новое (ник) */
  function setMyNick(nm) {
    var u = state.user;
    if (nm === myName()) return Promise.resolve();
    return readUsage("m").then(function (cur) {
      if ((cur.renames || 0) >= LIM.renames) throw new Error("Имя можно менять " + LIM.renames + " раз в месяц. На этот месяц лимит исчерпан.");
      var nick = nm === (u.displayName || "") ? "" : nm;
      var b = fb.f.writeBatch(fb.db);
      b.set(fdoc("users/" + u.uid), { nick: nick, updatedAt: fb.f.serverTimestamp() }, { merge: true });
      bumpUsage(b, "m", cur, "renames");
      return b.commit().then(function () { nicks[u.uid] = nick; putUA(u.uid); cdrop("comments:"); refreshViews(); });
    });
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
      file.value = "";
      (own ? avatarLimitLeft() : Promise.resolve()).then(function () { return cropDialog(f); }).then(function (blob) {
        if (own) {
          note(wrap, "Загружаем…");
          return setMyAvatar(blob).then(function (big) { avatar = big; prev.src = big; prev.hidden = false; note(wrap, "Фото сохранено.", "ok"); done && done(); });
        }
        return shrink(blob).then(function (data) { avatar = data; prev.src = data; prev.hidden = false; });
      }).catch(function (e) {
        if (e && e.cancelled) return;
        note(wrap, e && e.code ? errText(e) : (e && e.message) || "Не удалось загрузить фото.", "err");
      });
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
  /* Страница самого пользователя: подтверждённая страница человека, иначе временная страница аккаунта */
  function ownPageUrl() {
    var ids = approvedPids();
    return ids.length ? ROOT + "p/" + ids[0] + "/" : ROOT + "u/?id=" + encodeURIComponent(state.user.uid);
  }
  /* число новых заявок: видит только администратор */
  function adminPending() {
    return cached("admin:pending", TTL.comments, false, function () {
      return fb.f.getDocs(fb.f.query(fcol("claims"), fb.f.where("status", "==", "pending"))).then(function (q) { return q.size; });
    });
  }
  var menuOpen = false;
  function setMenu(on, focusBtn) {
    menuOpen = on; drawAuth();
    var b = document.querySelector(".head-me");
    if (on) { var f = document.querySelector(".user-menu .um-item"); if (f) f.focus(); } else if (focusBtn && b) b.focus();
  }
  /* путь клика берём заранее: к моменту обработки кнопка меню уже перерисована и из документа убрана */
  document.addEventListener("click", function (e) {
    if (!menuOpen) return;
    var path = e.composedPath ? e.composedPath() : [], inside = path.some(function (n) { return n && n.id === "auth-slot"; });
    if (!inside) setMenu(false);
  });
  document.addEventListener("keydown", function (e) { if (menuOpen && e.key === "Escape") setMenu(false, true); });
  var UM_ICON = {
    page: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4.5 20c.8-3.6 3.7-5.5 7.5-5.5s6.7 1.9 7.5 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    gear: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    admin: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M12 3l7.5 3v5.5c0 4.6-3.1 8.2-7.5 9.5-4.4-1.3-7.5-4.9-7.5-9.5V6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>'
  };
  function umItem(href, icon, text, extra) {
    var a = el("a", { class: "um-item", role: "menuitem", href: href });
    var ic = el("span", { class: "um-ic" }); ic.innerHTML = UM_ICON[icon];
    a.append(ic, el("span", { class: "um-text", text: text }));
    if (extra) a.append(extra);
    return a;
  }
  function drawAuth() {
    var slot = document.getElementById("auth-slot");
    if (!slot) return;
    if (!state.ready) return;   // до ответа сервиса остаётся кружок из страницы
    clear(slot);
    if (!state.user) {
      menuOpen = false;
      slot.append(el("button", { type: "button", class: "head-link head-btn", text: "Войти", title: "Войти, чтобы писать комментарии и ставить оценки", onclick: signIn }));
      return;
    }
    var uid = state.user.uid, nm = myName();
    var btn = el("button", { type: "button", class: "head-link head-me", "aria-haspopup": "menu", "aria-expanded": menuOpen ? "true" : "false",
      "aria-label": "Меню профиля: " + nm, title: nm, onclick: function () { setMenu(!menuOpen); } }, avatarNode(uid, nm, "s"));
    slot.append(btn);
    if (menuOpen) {
      var menu = el("div", { class: "user-menu", role: "menu", "aria-label": "Профиль" },
        el("div", { class: "um-head" }, avatarNode(uid, nm, "s"),
          el("div", { class: "um-who" }, el("b", { text: nm }), state.admin ? el("span", { class: "c-hint", text: "Администратор" }) : null)),
        umItem(ownPageUrl(), "page", "Моя страница"),
        umItem(ROOT + "settings/", "gear", "Настройки профиля"));
      var admItem = null;
      if (state.admin) { admItem = umItem(ROOT + "account/", "admin", "Кабинет администратора"); menu.append(admItem); }
      slot.append(menu);
    }
    if (state.admin) {
      adminPending().then(function (n) {
        if (n > 0 && btn.isConnected) {
          btn.append(el("span", { class: "head-badge", title: "Заявки на подтверждение страниц", text: String(n) }));
          var it = slot.querySelector(".um-item[href$='account/']");
          if (it) it.append(el("span", { class: "head-badge", text: String(n) }));
        }
      }, function () { });
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
  var RATE_DEFAULT = [
    ["idea", "Замысел", "идея, образы, история номера", "замысел"],
    ["comp", "Постановка", "что придумал постановщик: рисунок, переходы, ритм, музыка", "постановка"],
    ["perf", "Исполнение", "как выступили артисты: техника, синхронность, игра", "исполнение"],
    ["stage", "Сценическое воплощение", "свет, костюмы, видео, реквизит", "сцена"],
    ["overall", "Общее впечатление", "эмоции, атмосфера, вайб", "впечатление"]
  ];
  var RATE = RATE_DEFAULT;   // на странице направления вне сцены заменяется критериями из листа «Направления»
  var OFFSTAGE = false;
  var CTX = [["team", "Я участвовал(а) в концерте или в команде"], ["hall", "Я был(а) на концерте зрителем"], ["absent", "Меня не было на концерте, сужу по тому, что видел(а) со стороны"]];
  /* Вес общего впечатления в сумме: четыре критерия по 1, общее впечатление ×1,2. Каждая оценка по-прежнему от 1 до 5. */
  var OVERALL_W = 1.2;
  var TOTAL_MAX = 4 * 5 + 5 * OVERALL_W;   // 26
  /* ------------------------------------------------------------ состояния: пусто, ошибка, нужен вход */
  function emptyState(title, text, action) {
    return el("div", { class: "empty-state" }, el("p", { class: "empty-title", text: title }), text ? el("p", { class: "c-hint", text: text }) : null, action || null);
  }
  function errorState(text, retry) {
    var offline = typeof navigator !== "undefined" && navigator.onLine === false;
    var box = el("div", { class: "error-state", role: "alert" }, el("p", { class: "empty-title", text: "Не получилось загрузить" }),
      el("p", { class: "c-hint", text: offline ? "Нет соединения с интернетом. Проверьте сеть и повторите." : text }));
    if (retry) box.append(el("button", { type: "button", class: "btn btn-s", text: "Повторить", onclick: function (ev) { ev.target.disabled = true; ev.target.textContent = "Загружаем…"; retry(); } }));
    return box;
  }
  function signInPrompt(title, text) {
    return el("div", { class: "login-card" }, el("p", { class: "empty-title", text: title }),
      el("p", { class: "c-hint", text: text || "Войдите через Google или по e-mail. Так мы знаем, кто пишет: можно оставлять комментарии и оценки, ставить лайки, собирать плейлисты и вести свою страницу. Читать каталог можно и без входа." }),
      el("button", { type: "button", class: "btn", text: "Войти", onclick: signIn }));
  }
  function fmtT(x) { var s = fmt1(x); return s.slice(-2) === ",0" ? s.slice(0, -2) : s; }
  var SORTS = [["old", "Сначала старые"], ["new", "Сначала новые"], ["top", "Популярные"]];
  function fmt1(x) { return (Math.round(x * 10) / 10).toFixed(1).replace(".", ","); }
  function plRate(n) {
    var m = n % 100, d = n % 10;
    return n + " " + (m > 10 && m < 20 ? "оценок" : d === 1 ? "оценка" : d > 1 && d < 5 ? "оценки" : "оценок");
  }

  /* Сумма пяти оценок: четыре критерия плюс общее впечатление ×1,2 (от 5,2 до 26). Считается только если поставлены все пять. */
  function ratingTotal(r, K) {
    K = K || RATE;
    var t = 0;
    for (var i = 0; i < K.length; i++) {
      var v = r && r[K[i][0]];
      if (!v) return null;
      t += K[i][0] === "overall" ? v * OVERALL_W : v;
    }
    return Math.round(t * 10) / 10;
  }
  function tipText(k, v) { return k[1] + ": " + v + " из 5" + (k[2] ? " (" + k[2] + ")" : ""); }
  function closeTips(except) { Array.prototype.forEach.call(document.querySelectorAll(".rt-chip.is-open,.rt-total.is-open"), function (n) { if (n !== except) n.classList.remove("is-open"); }); }
  document.addEventListener("click", function (e) { if (!e.target.closest || !e.target.closest(".rt-chip,.rt-total")) closeTips(); });
  /* Компактная строка оценки у комментария: сумма и пять цифр, подсказка по наведению или нажатию */
  function ratingNode(r, K) {
    K = K || RATE;
    var wrap = el("div", { class: "rt", role: "group", "aria-label": "Оценка" });
    var tot = ratingTotal(r, K);
    var toggle = function (ev) { var b = ev.currentTarget; closeTips(b); b.classList.toggle("is-open"); };
    if (tot !== null) wrap.append(el("button", { type: "button", class: "rt-total", "data-tip": "Сумма: четыре критерия и общее впечатление ×1,2. " + fmtT(tot) + " из " + TOTAL_MAX, "aria-label": "Сумма оценок: " + fmtT(tot) + " из " + TOTAL_MAX, onclick: toggle }, el("b", { text: fmtT(tot) }), "/" + TOTAL_MAX));
    K.forEach(function (k) {
      var v = r[k[0]];
      if (!v) return;
      wrap.append(el("button", { type: "button", class: "rt-chip v" + v + (k[0] === "overall" ? " vibe" : ""), "data-tip": tipText(k, v), "aria-label": tipText(k, v), onclick: toggle, text: String(v) }));
    });
    if (r.ctx === "absent") wrap.append(el("span", { class: "rt-ctx", text: "не был(а) на концерте" }));
    return wrap;
  }

  function initNumber() {
    var root = document.getElementById("comments");
    if (!root) return;
    var nid = root.dataset.number;
    OFFSTAGE = !!root.dataset.offstage;
    RATE = RATE_DEFAULT;
    if (root.dataset.rate) {
      try { var pr = JSON.parse(root.dataset.rate); if (Array.isArray(pr) && pr.length === 5) RATE = pr; } catch (e) { }
    }
    var rateNote = root.dataset.rateNote || "";
    var directors = (root.dataset.directors || "").split(" ").filter(Boolean);
    var stage = document.getElementById("stage");
    var canSeek = !!(stage && stage.dataset.oid);
    var comments = [], loaded = false, replyTo = null, noteData = null, fail = "", justDone = null;
    var editing = {}, editSess = {}, editDraft = {};   // правка комментария: открыта сейчас / начата на этой странице (после обновления страницы сбрасывается) / несохранённый текст
    var EDIT_MIN = 15;                                  // сколько минут после отправки можно начать правку
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
            if (x.ctx) o.ctx = x.ctx;
            RATE.forEach(function (r) { if (typeof x[r[0]] === "number") o[r[0]] = x[r[0]]; });
            return o;
          });
        });
      }).then(function (arr) {
        ratings = arr || []; ratingBy = {};
        ratings.forEach(function (r) { ratingBy[r.uid] = r; });
      }, function () { ratings = []; ratingBy = {}; });
    }
    function dropComments() { cdrop("comments:" + nid); cdrop("likes:" + nid); cdrop("ratings:" + nid); cdrop("user:ccount:"); cdrop("user:comments2:"); }
    function plural(n) {
      var m = n % 100, d = n % 10;
      return n + " " + (m > 10 && m < 20 ? "лайков" : d === 1 ? "лайк" : d > 1 && d < 5 ? "лайка" : "лайков");
    }
    function toggleLike(c) {
      if (!state.user) { toast("Войдите, чтобы ставить лайки."); return Promise.resolve(); }
      var uid = state.user.uid, on = !myLikes[c.id], b = fb.f.writeBatch(fb.db), ref = fdoc("likes/" + c.id + "_" + uid), cref = fdoc("comments/" + c.id);
      return (on ? readUsage("d") : Promise.resolve({})).then(function (cur) {
        if (on && (cur.likes || 0) >= LIM.likes) throw new Error("Лимит: " + LIM.likes + " лайков в день. Продолжить можно завтра.");
        if (on) {
          b.set(ref, { commentId: c.id, numberId: nid, uid: uid, userName: myName(), createdAt: fb.f.serverTimestamp() });
          b.update(cref, { likeCount: fb.f.increment(1) });
          bumpUsage(b, "d", cur, "likes");
        } else {
          b.delete(ref);
          b.update(cref, { likeCount: fb.f.increment(-1) });
        }
        return b.commit();
      }).then(function () {
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

    /* Страница, от имени которой пишется комментарий: подтверждённая страница автора (постановщика этого номера — в первую очередь) */
    function myPersonForComment() { return myDirectorPerson() || approvedPids()[0] || null; }
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

    function canEdit(c) {
      if (!state.user || c.uid !== state.user.uid || c.status === "hidden") return false;
      return !!editSess[c.id] || Date.now() - ms(c) < EDIT_MIN * 60e3;
    }
    /* Первая правка записывает «окно» (editUntil) — оно нужно правилам базы, чтобы пустить сохранение и после 15 минут.
       Кнопка «Править» после обновления страницы пропадает, когда 15 минут уже прошли. */
    function startEdit(c) {
      if (editSess[c.id]) { editing[c.id] = true; drawList(); return; }
      fb.f.updateDoc(fdoc("comments/" + c.id), { editUntil: new Date(Date.now() + 5 * 3600e3) }).then(function () {
        editSess[c.id] = true; editing[c.id] = true; drawList();
      }, function (e) { toast(errText(e)); });
    }
    function editBox(c) {
      var ta = el("textarea", { class: "c-input", rows: "3", maxlength: "2000", "aria-label": "Текст комментария" });
      ta.value = editDraft[c.id] != null ? editDraft[c.id] : c.text;
      ta.addEventListener("input", function () { editDraft[c.id] = ta.value; });
      var msg = el("p", { class: "msg msg-err", hidden: true });
      var save = el("button", { type: "button", class: "btn btn-s", text: "Сохранить" });
      var fail = function (t) { msg.textContent = t; msg.hidden = false; };
      save.addEventListener("click", function () {
        var t = ta.value.trim();
        if (!t) { fail("Комментарий не может быть пустым. Чтобы убрать его, нажмите «Удалить»."); return; }
        var bad = findProfanity(t);
        if (bad) { fail("Мат не проходит: слово «" + bad + "». Уберите его и сохраните снова."); return; }
        if (t === c.text) { editing[c.id] = false; delete editDraft[c.id]; drawList(); return; }
        save.disabled = true;
        fb.f.updateDoc(fdoc("comments/" + c.id), { text: t, editedAt: fb.f.serverTimestamp() }).then(function () {
          editing[c.id] = false; delete editDraft[c.id]; dropComments(); return loadComments(true);
        }).then(draw, function (e) { save.disabled = false; fail(errText(e)); });
      });
      return el("div", { class: "c-edit" }, ta, msg, el("div", { class: "c-row" }, save,
        el("button", { type: "button", class: "linkbtn", text: "Отмена", onclick: function () { editing[c.id] = false; delete editDraft[c.id]; drawList(); } })));
    }
    function commentNode(c, isReply) {
      var isDir = c.authorPersonId && directors.indexOf(c.authorPersonId) !== -1;
      var mine = state.user && c.uid === state.user.uid;
      var head = el("p", { class: "c-head" },
        el("a", { class: "c-who", href: c.authorPersonId ? ROOT + "p/" + c.authorPersonId + "/" : ROOT + "u/?id=" + encodeURIComponent(c.uid), title: "Страница автора" },
          avatarNode(c.uid, c.authorName, "xs"), el("strong", { text: fullName(c.authorName, c.authorPersonId) })),
        isDir && el("span", { class: "badge", text: "Постановщик" }),
        c.status === "hidden" && el("span", { class: "badge badge-off", text: "Скрыт" }),
        el("a", { class: "c-date", href: "#c-" + c.id, text: when(c) }),
        c.editedAt && el("span", { class: "c-date", text: "изменён" }));
      var actions = el("p", { class: "c-actions" });
      var n = c.likeCount || 0, liked = !!myLikes[c.id];
      if (c.status !== "hidden") actions.append(el("button", { type: "button", class: "like-btn" + (liked ? " is-on" : ""), "aria-pressed": liked ? "true" : "false",
        "aria-label": liked ? "Убрать лайк" : "Поставить лайк", title: liked ? "Убрать лайк" : "Нравится", onclick: function () { toggleLike(c); } },
        el("span", { "aria-hidden": "true", text: "♥" })));
      if (n > 0) actions.append(el("button", { type: "button", class: "linkbtn like-count", "aria-expanded": openLikers[c.id] ? "true" : "false", text: plural(n),
        onclick: function () { openLikers[c.id] = !openLikers[c.id]; drawList(); } }));
      if (!isReply && state.user) actions.append(el("button", { type: "button", class: "linkbtn", text: "Ответить", onclick: function () { replyTo = c; drawForm(); form.scrollIntoView({ block: "center" }); } }));
      if (state.admin) actions.append(el("button", { type: "button", class: "linkbtn", text: c.status === "hidden" ? "Показать" : "Скрыть", onclick: function () { act(fb.f.updateDoc(fdoc("comments/" + c.id), { status: c.status === "hidden" ? "visible" : "hidden" })); } }));
      if (canEdit(c) && !editing[c.id]) actions.append(el("button", { type: "button", class: "linkbtn", text: "Править", onclick: function () { startEdit(c); } }));
      if (mine || state.admin) actions.append(el("button", { type: "button", class: "linkbtn", text: "Удалить", onclick: function () { if (confirm("Удалить комментарий насовсем?")) act(deleteComment(c)); } }));
      var rt = !isReply && firstTop[c.uid] === c.id && ratingBy[c.uid], rline = rt ? ratingNode(rt) : null;
      return el("article", { class: "comment" + (isReply ? " reply" : "") + (c.status === "hidden" ? " is-hidden" : ""), id: "c-" + c.id },
        head, editing[c.id] ? editBox(c) : el("p", { class: "c-text" }, richText(c.text, canSeek)), rline, actions, n > 0 && openLikers[c.id] ? likersBox(c) : null);
    }
    function act(p) { return p.then(function () { dropComments(); return loadComments(true); }).then(draw, function (e) { toast(errText(e)); }); }

    /* Сводка: средняя сумма крупно, пять средних полосками (четыре критерия и общее впечатление) */
    function drawSummary() {
      clear(sumBox);
      if (!ratings.length) { sumBox.hidden = true; return; }
      var sum = {}, cnt = {}, tsum = 0, tcnt = 0, absentN = 0;
      ratings.forEach(function (r) {
        if (r.ctx === "absent") absentN++;
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
      sumBox.append(el("h3", { text: OFFSTAGE ? "Оценки" : "Оценки зрителей" }),
        el("div", { class: "rate-sum-grid" },
          tcnt ? el("p", { class: "rate-big" }, el("strong", { text: fmtT(tsum / tcnt) }), el("span", { text: " из " + TOTAL_MAX }),
            el("small", { text: "средняя сумма, " + plRate(tcnt) })) : el("p", { class: "rate-big" }, el("small", { text: plRate(ratings.length) + ", полных нет" })),
          bars),
        OFFSTAGE && absentN ? el("p", { class: "rate-ctx-note", text: "Не были на концерте: " + absentN + " из " + ratings.length }) : "");
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
      if (fail) { sortBar.hidden = true; list.append(errorState(fail, function () { loadComments(true).then(draw); })); return; }
      var top = comments.filter(function (c) { return !c.parentId; });
      var byParent = {};
      comments.forEach(function (c) { if (c.parentId) (byParent[c.parentId] = byParent[c.parentId] || []).push(c); });
      var ids = {}; comments.forEach(function (c) { ids[c.id] = 1; });
      comments.forEach(function (c) { if (c.parentId && !ids[c.parentId]) top.push(c); }); // ответ на удалённый
      firstTop = {};
      top.slice().sort(function (a, b) { return ms(a) - ms(b); }).forEach(function (c) { if (!firstTop[c.uid]) firstTop[c.uid] = c.id; });
      top.sort(cmpFor(sortMode));
      drawSort(top.length);
      if (!top.length) list.append(emptyState("Пока нет комментариев", "Напишите первым: что запомнилось в номере, что понравилось, кому спасибо."));
      top.forEach(function (c) {
        list.append(commentNode(c, false));
        (byParent[c.id] || []).forEach(function (r) { list.append(commentNode(r, true)); });
      });
    }

    /* Итог после отправки: крупная сумма и «Спасибо», исчезает через 20 секунд */
    function thanksNode() {
      var d = justDone;
      if (!d || Date.now() - d.t > 20000) return null;
      var n = el("div", { class: "rate-thanks", role: "status" });
      if (d.rate) {
        n.append(el("p", { class: "rate-thanks-big" }, el("b", { text: d.tot !== null ? fmtT(d.tot) : "✓" }), d.tot !== null ? el("span", { text: " из " + TOTAL_MAX }) : null),
          el("p", { class: "empty-title", text: "Спасибо, оценка учтена" }),
          el("p", { class: "c-hint", text: (d.text ? "Комментарий опубликован. " : "") + "Оценку можно изменить в любой момент: откройте блок «Ваша оценка»." }));
      } else if (d.clear) {
        n.append(el("p", { class: "empty-title", text: "Оценка убрана" }), el("p", { class: "c-hint", text: d.text ? "Комментарий опубликован." : "Поставить новую можно в любой момент." }));
      } else {
        n.append(el("p", { class: "empty-title", text: "Комментарий опубликован" }));
      }
      setTimeout(function () { if (n.parentNode) n.remove(); }, Math.max(1000, 20000 - (Date.now() - d.t)));
      return n;
    }

    /* Форма: необязательные оценки (ползунки, выпадающий блок), потом комментарий */
    function drawForm() {
      clear(form);
      if (!state.ready) return;
      if (!state.user) {
        form.append(signInPrompt("Хотите оценить номер или написать комментарий?"));
        return;
      }
      var uid = state.user.uid;
      var thanks = thanksNode();
      if (thanks) form.append(thanks);
      var prev = ratingBy[uid] || null;                // уже сохранённая оценка этого человека
      var draft = {}; RATE.forEach(function (k) { if (prev && prev[k[0]]) draft[k[0]] = prev[k[0]]; });
      var cleared = false;                              // человек нажал «Убрать оценку»
      var ctxv = (prev && prev.ctx) || "";              // откуда человек знает работу направления (только вне сцены)

      var ta = el("textarea", { class: "c-input", rows: "3", maxlength: "2000", placeholder: canSeek ? "Ваш комментарий. Время вида 1:23:45 станет ссылкой на этот момент записи." : "Ваш комментарий", "aria-label": "Комментарий" });
      var send = el("button", { type: "submit", class: "btn", text: "Отправить" });

      function setCount() { return Object.keys(draft).length; }
      function same() { return RATE.every(function (k) { return (draft[k[0]] || 0) === ((prev && prev[k[0]]) || 0); }) && (!OFFSTAGE || ctxv === ((prev && prev.ctx) || "")); }
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
        grpVibe.append(el("p", { class: "rate-feel", text: OFFSTAGE ? "Общее впечатление: ощущение от работы направления в целом. В сумме оно весит больше остальных (×1,2). Своими словами расскажите об этом в комментарии ниже." : "Эмоциональный отклик: что вы почувствовали? Этот пункт про ощущение от номера в целом, и в сумме он весит больше остальных (×1,2). Своими словами расскажите об этом в комментарии ниже." }));
        var ctxSel = null, ctxBox = null;
        if (OFFSTAGE) {
          ctxSel = el.apply(null, ["select", { class: "rate-ctx-sel", "aria-label": "Откуда вы знаете работу направления" }, el("option", { value: "", text: "Выберите…" })]
            .concat(CTX.map(function (c) { return el("option", { value: c[0], text: c[1] }); })));
          ctxSel.value = ctxv;
          ctxSel.addEventListener("change", function () { ctxv = ctxSel.value; cleared = false; showState(); syncSend(); });
          ctxBox = el("label", { class: "rate-ctx" }, el("span", { text: "Откуда вы знаете работу направления?" }), ctxSel);
        }
        var reset = el("button", { type: "button", class: "linkbtn", text: prev ? "Убрать мою оценку" : "Сбросить", onclick: function () {
          draft = {}; cleared = !!prev; ctxv = "";
          if (ctxSel) ctxSel.value = "";
          painters.forEach(function (f) { f(); });
          showState(); syncSend();
        } });
        rateBox = el("details", { class: "rate-box" },
          el("summary", null, el("span", { text: prev ? "Ваша оценка" : "Оценить" }), " ", sumLine),
          el("p", { class: "c-hint", text: "От 1 до 5, ползунком. Нужны все пять пунктов, сумма считается по ним. Если оценка не нужна, оставьте блок закрытым." }),
          OFFSTAGE && rateNote ? el("p", { class: "c-hint rate-note", text: rateNote }) : null, ctxBox,
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
        if (OFFSTAGE && full && rateChanged() && !ctxv) { note(form, "Выберите, откуда вы знаете работу направления.", "err"); return; }
        var wantRate = full && rateChanged(), wantClear = cleared && !!prev && !wantRate;
        if (!text && !wantRate && !wantClear) { note(form, replyTo ? "Напишите текст ответа." : "Напишите комментарий или поставьте оценку.", "err"); return; }
        if (text) {
          var bad = findProfanity(text);
          if (bad) { note(form, "Мат не проходит: слово «" + bad + "». Уберите его и отправьте снова.", "err"); ta.focus(); return; }
        }
        var doneInfo = { rate: wantRate, clear: wantClear, text: !!text, tot: wantRate ? ratingTotal(draft) : null };
        justDone = null;
        send.disabled = true;
        (text ? readUsage("d") : Promise.resolve({})).then(function (cur) {
          var n = (cur.comments || 0) + 1;
          if (text && n > LIM.comments) throw new Error("Лимит: " + LIM.comments + " комментариев в день. Следующий можно оставить завтра.");
          var cdata = null, cref = null;
          if (text) {
            /* номер комментария за день входит в его ключ: так правила базы не дают обойти лимит */
            cref = fdoc("comments/" + dayStamp() + "_" + uid + "_" + n);
            cdata = { numberId: nid, uid: uid, authorName: myName(), text: text, createdAt: fb.f.serverTimestamp(), status: "visible" };
            if (replyTo) cdata.parentId = replyTo.id;
            var pid = myPersonForComment();
            if (pid) cdata.authorPersonId = pid;
          }
          var rref = fdoc("ratings/" + nid + "_" + uid);
          /* Один пакет: комментарий и оценка вместе. withCtx — с пометкой «откуда знаю работу» (для направлений вне сцены) */
          var go = function (withCtx) {
            var b = fb.f.writeBatch(fb.db);
            if (text) { b.set(cref, cdata); bumpUsage(b, "d", cur, "comments"); }
            if (wantRate) {
              var rd = { numberId: nid, uid: uid, updatedAt: fb.f.serverTimestamp() };
              RATE.forEach(function (k) { rd[k[0]] = draft[k[0]]; });
              if (withCtx && OFFSTAGE && ctxv) rd.ctx = ctxv;
              b.set(rref, rd);
            } else if (wantClear) b.delete(rref);
            return b.commit();
          };
          return go(true).catch(function (e) {
            /* пока правила базы не обновлены, поле ctx отклоняется: сохраняем оценку без него */
            if (wantRate && OFFSTAGE && e && e.code === "permission-denied") return go(false);
            throw e;
          });
        }).then(function () { replyTo = null; justDone = { k: 1, t: Date.now(), rate: doneInfo.rate, clear: doneInfo.clear, text: doneInfo.text, tot: doneInfo.tot }; dropComments(); return loadComments(true); }).then(draw, function (e) { send.disabled = false; note(form, errText(e), "err"); });
      } },
        replyTo && el("p", { class: "c-replyto" }, "Ответ для " + replyTo.authorName + " ",
          el("button", { type: "button", class: "linkbtn", text: "отменить", onclick: function () { replyTo = null; drawForm(); } })),
        rateBox, rules, ta, el("div", { class: "c-row" }, send,
          el("span", { class: "c-hint", text: "Вы пишете как " + fullName(myName(), myPersonForComment()) + (myDirectorPerson() ? ", постановщик" : "") + ". Не больше " + LIM.comments + " комментариев в день." })));
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
    catalogInfo().then(function () { draw(); });   // имена на страницах людей нужны для подписи «ник (имя)»
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
      var h1 = document.getElementById("p-name");
      if (h1) {
        var nk = approved() ? nicks[claim.uid] : "";
        h1.textContent = nk && nrm(nk) !== nrm(pname) ? nk + " (" + pname + ")" : pname;
      }
      if (profile && profile.bio && aboutEl) { aboutEl.textContent = profile.bio; aboutEl.hidden = false; }
      if (profile && profile.link && linkEl) {
        clear(linkEl).append(el("a", { href: profile.link, rel: "noopener ugc", text: profile.link.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") }));
        linkEl.hidden = false;
      }
      var av = profile && profile.avatar || (approved() && avatars[claim.uid]) || "";
      if (avatarEl) { if (av) { avatarEl.src = av; avatarEl.hidden = false; } else avatarEl.hidden = true; }
      var socEl = document.getElementById("p-social");
      if (socEl) {
        clear(socEl);
        var row = approved() ? socialRow(userLinks[claim.uid]) : null;
        if (row) socEl.append(row);
        socEl.hidden = !row;
      }
      var commEl = document.getElementById("p-st-comm");
      if (commEl) {
        if (!approved()) commEl.hidden = true;
        else commentCount(claim.uid).then(function (n) {
          clear(commEl).append(el("b", { text: String(n) }), " " + plural(n, "комментарий", "комментария", "комментариев"));
          commEl.hidden = false;
        }, function () { });
      }
    }

    function mine() { return !!(state.user && claim && claim.uid === state.user.uid && claim.status === "approved"); }
    function claimPerson() {
      var u = state.user;
      return submitClaim(pid, "").then(reloadPublic).then(draw, function (e) {
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
      var tabsHost = document.getElementById("p-tabs");
      if (tabsHost) { if (approved()) mountTabs(tabsHost, { uid: claim.uid, name: pname, self: mine() }); else unmountTabs(tabsHost); }
      if (approved()) box.append(el("p", { class: "c-hint", text: "Страница подтверждена владельцем." }));
      if (!u) {
        if (!claim) box.append(signInPrompt("Это ваша страница?", "Войдите, чтобы вести эту страницу: добавить фото и ссылки, писать комментарии под своим именем. Заявку проверит администратор."));
      } else if (!claim) {
        box.append(el("button", { type: "button", class: "btn", text: "Это моя страница", onclick: claimPerson }),
          el("p", { class: "c-hint", text: "Заявку проверит и подтвердит администратор." }));
      } else if (claim.uid === u.uid && claim.status === "pending") {
        box.append(el("p", { class: "msg", text: "Заявка отправлена. Администратор подтвердит её, и здесь появится редактирование." }),
          el("button", { type: "button", class: "linkbtn", text: "Отозвать заявку", onclick: function () { fb.f.deleteDoc(fdoc("claims/" + pid)).then(function () { return loadMe(u, true); }).then(reloadPublic).then(draw); } }));
      }
      if (mine()) {
        box.append(el("div", { class: "c-row" }, shareButton(pid, pname),
            el("a", { class: "btn btn-s btn-ghost", href: ROOT + "settings/", text: "Настройки профиля" })),
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

  /* ------------------------------------------------------------ вкладки профиля
     Номера (у людей со страницей), комментарии с оценками внутри, все оценки, плейлисты.
     Данные читаются лениво: вкладка загружается, когда её открыли. */
  var catP = null;
  function catalogInfo() {
    if (!catP) catP = Promise.all([
      fetch(ROOT + "catalog.json").then(function (r) { return r.json(); }).catch(function () { return {}; }),
      fetch(ROOT + "rate.json").then(function (r) { return r.json(); }).catch(function () { return {}; })
    ]).then(function (r) {
      var titles = {}; ((r[0] && r[0].numbers) || []).forEach(function (n) { titles[n.id] = n.title; });
      ((r[0] && r[0].people) || []).forEach(function (p) { peopleNames[p.id] = p.name; });
      return { titles: titles, rate: r[1] || {}, numbers: (r[0] && r[0].numbers) || [], people: (r[0] && r[0].people) || [] };
    });
    return catP;
  }
  /* Обложка номера, как на главной (card.webp), с отложенной загрузкой */
  function numCover(id) {
    var img = el("img", { src: ROOT + "img/" + encodeURIComponent(id) + "/card.webp", alt: "", width: "640", height: "480", loading: "lazy", decoding: "async" });
    img.addEventListener("error", function () { img.style.visibility = "hidden"; });
    return el("a", { class: "pcard-cover", href: ROOT + "n/" + encodeURIComponent(id) + "/", tabindex: "-1", "aria-hidden": "true" }, img);
  }
  function pcard(id, body) { return el("article", { class: "comment user-comment pcard" }, numCover(id), el.apply(null, ["div", { class: "pcard-body" }].concat(body))); }
  function numLink(info, id, cls) { return el("a", { class: cls || null, href: ROOT + "n/" + encodeURIComponent(id) + "/", text: info.titles[id] || "Номер" }); }
  function tsMs(t) { return t && t.toMillis ? t.toMillis() : 0; }
  function tsText(t) {
    return t && t.toDate ? t.toDate().toLocaleString("ru-RU", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
  }
  function critOf(info, nid) { var r = info.rate[nid]; return r && r.k && r.k.length === 5 ? r.k : RATE_DEFAULT; }
  function loadUserComments(uid, fresh) {
    return cached("user:comments2:" + uid, TTL.pub, fresh === true, function () {
      return fb.f.getDocs(fb.f.query(fcol("comments"), fb.f.where("uid", "==", uid), fb.f.where("status", "==", "visible"), fb.f.limit(200))).then(function (s) {
        return s.docs.map(function (d) {
          var x = d.data();
          return { id: d.id, numberId: x.numberId, text: x.text, authorName: x.authorName, createdAt: x.createdAt, likeCount: x.likeCount || 0, parentId: x.parentId || "" };
        });
      });
    });
  }
  function loadUserRatings(uid, fresh) {
    return cached("user:ratings:" + uid, TTL.pub, fresh === true, function () {
      return fb.f.getDocs(fb.f.query(fcol("ratings"), fb.f.where("uid", "==", uid), fb.f.limit(300))).then(function (s) {
        return s.docs.map(function (d) {
          var x = d.data(), o = { numberId: x.numberId, updatedAt: x.updatedAt };
          if (x.ctx) o.ctx = x.ctx;
          RATE_DEFAULT.forEach(function (k) { if (typeof x[k[0]] === "number") o[k[0]] = x[k[0]]; });
          return o;
        });
      });
    });
  }
  function loadUserPlaylists(uid, fresh) {
    return cached("user:pl:" + uid, TTL.comments, fresh === true, function () {
      return fb.f.getDocs(fb.f.query(fcol("playlists"), fb.f.where("uid", "==", uid), fb.f.limit(60))).then(function (s) {
        return s.docs.map(function (d) { var x = d.data(); return { id: d.id, name: x.name, numberIds: x.numberIds || [], createdAt: x.createdAt }; });
      });
    });
  }
  function dropPlaylists() { cdrop("user:pl:"); }
  var PL_MAX = 30, PL_ITEMS = 200;
  function plCreate(name, ids) {
    return fb.f.addDoc(fcol("playlists"), {
      uid: state.user.uid, ownerName: state.user.displayName || "Без имени", name: name, numberIds: ids || [],
      createdAt: fb.f.serverTimestamp(), updatedAt: fb.f.serverTimestamp()
    }).then(function (r) { dropPlaylists(); return r; });
  }
  function plSetItems(p, ids) {
    return fb.f.updateDoc(fdoc("playlists/" + p.id), { numberIds: ids, updatedAt: fb.f.serverTimestamp() }).then(function () { dropPlaylists(); p.numberIds = ids; });
  }
  function plNameError(v) {
    v = (v || "").trim();
    if (!v) return "Введите название плейлиста.";
    var bad = findProfanity(v);
    return bad ? "Мат не проходит: слово «" + bad + "»." : "";
  }

  function panelComments(panel, uid, info, self) {
    return Promise.all([loadUserComments(uid), loadUserRatings(uid).catch(function () { return []; })]).then(function (r) {
      var list = (r[0] || []).slice().sort(function (a, b) { return tsMs(b.createdAt) - tsMs(a.createdAt); });
      var rbn = {}; (r[1] || []).forEach(function (x) { rbn[x.numberId] = x; });
      var first = {};   // оценка показывается под самым первым комментарием человека к номеру
      list.slice().sort(function (a, b) { return tsMs(a.createdAt) - tsMs(b.createdAt); }).forEach(function (c) { if (!c.parentId && !first[c.numberId]) first[c.numberId] = c.id; });
      clear(panel);
      if (!list.length) { panel.append(self ? emptyState("Вы пока ничего не писали", "Откройте номер и напишите первый комментарий.", el("a", { class: "btn btn-s", href: ROOT || "./", text: "Выбрать номер" })) : emptyState("Комментариев пока нет")); return; }
      var ul = el("div", { class: "c-list" });
      list.forEach(function (c) {
        var rt = first[c.numberId] === c.id && rbn[c.numberId];
        ul.append(pcard(c.numberId, [
          el("p", { class: "c-head" }, numLink(info, c.numberId),
            el("a", { class: "c-date", href: ROOT + "n/" + encodeURIComponent(c.numberId) + "/#c-" + c.id, text: tsText(c.createdAt) }),
            c.likeCount ? el("span", { class: "c-date", text: "♥ " + c.likeCount }) : null),
          el("p", { class: "c-text", text: c.text }),
          rt ? ratingNode(rt, critOf(info, c.numberId)) : null]));
      });
      panel.append(ul);
    });
  }
  function panelRatings(panel, uid, info, self) {
    return loadUserRatings(uid).then(function (arr) {
      var list = (arr || []).slice().sort(function (a, b) { return tsMs(b.updatedAt) - tsMs(a.updatedAt); });
      clear(panel);
      if (!list.length) { panel.append(self ? emptyState("Вы пока ничего не оценили", "Откройте номер и нажмите «Оценить».", el("a", { class: "btn btn-s", href: ROOT || "./", text: "Выбрать номер" })) : emptyState("Оценок пока нет")); return; }
      var ul = el("div", { class: "c-list" });
      list.forEach(function (x) {
        ul.append(pcard(x.numberId, [
          el("p", { class: "c-head" }, numLink(info, x.numberId), el("span", { class: "c-date", text: tsText(x.updatedAt) })),
          ratingNode(x, critOf(info, x.numberId))]));
      });
      panel.append(ul);
    }, function (e) { clear(panel).append(el("p", { class: "msg msg-err", text: "Оценки не загрузились: " + errText(e) })); });
  }
  function panelPlaylists(panel, uid, self, info) {
    function draw(list) {
      clear(panel);
      list = (list || []).slice().sort(function (a, b) { return tsMs(b.createdAt) - tsMs(a.createdAt); });
      if (self) {
        var inp = el("input", { class: "c-input", type: "text", maxlength: "80", placeholder: "Название нового плейлиста", "aria-label": "Название плейлиста" });
        var msg = el("p", { class: "msg msg-err", hidden: true });
        var go = el("button", { type: "submit", class: "btn btn-s", text: "Создать" });
        panel.append(el("form", { class: "pl-new", onsubmit: function (ev) {
          ev.preventDefault();
          var er = plNameError(inp.value);
          if (!er && list.length >= PL_MAX) er = "Можно создать до " + PL_MAX + " плейлистов.";
          if (er) { msg.textContent = er; msg.hidden = false; return; }
          go.disabled = true;
          plCreate(inp.value.trim(), []).then(function () { return loadUserPlaylists(uid, true); }).then(draw, function (e) { go.disabled = false; msg.textContent = errText(e); msg.hidden = false; });
        } }, el("div", { class: "c-row" }, inp, go), msg));
      }
      if (!list.length) { panel.append(self ? emptyState("Плейлистов пока нет", "Создайте первый, а номера добавляйте кнопкой «В плейлист» на странице номера.") : emptyState("Плейлистов пока нет")); return; }
      list.forEach(function (p) {
        var items = el("ol", { class: "pl-items" });
        (p.numberIds || []).forEach(function (id) {
          items.append(el("li", null, numLink(info, id),
            self ? el("button", { type: "button", class: "linkbtn", text: "убрать", "aria-label": "Убрать из плейлиста", onclick: function () {
              plSetItems(p, p.numberIds.filter(function (x) { return x !== id; })).then(function () { draw(list); }, function (e) { toast(errText(e)); });
            } }) : null));
        });
        panel.append(el("details", { class: "pl" },
          el("summary", null, el("span", { class: "pl-name", text: p.name }), " ", el("span", { class: "people-n", text: String((p.numberIds || []).length) })),
          (p.numberIds || []).length ? items : el("p", { class: "c-hint", text: "В плейлисте пока нет номеров." }),
          self ? el("button", { type: "button", class: "linkbtn", text: "Удалить плейлист", onclick: function () {
            if (!confirm("Удалить плейлист «" + p.name + "»?")) return;
            fb.f.deleteDoc(fdoc("playlists/" + p.id)).then(function () { dropPlaylists(); return loadUserPlaylists(uid, true); }).then(draw, function (e) { toast(errText(e)); });
          } }) : null));
      });
    }
    return loadUserPlaylists(uid).then(draw, function (e) { clear(panel).append(el("p", { class: "msg msg-err", text: "Плейлисты не загрузились: " + errText(e) })); });
  }

  /* host — блок страницы. Если внутри уже лежит панель «Номера» (#p-nums), она становится первой вкладкой. */
  function unmountTabs(host) {
    if (!host._st) return;
    host._st.nodes.forEach(function (n) { n.remove(); });
    var nums = host.querySelector("#p-nums"); if (nums) nums.hidden = false;
    host._st = null;
  }
  function mountTabs(host, o) {
    var st = host._st;
    if (st && st.uid === o.uid) {
      var was = st.self; st.self = !!o.self;
      /* человек вошёл уже после открытия страницы: уже загруженные вкладки перерисовываем с подсказками для владельца */
      ["comments", "ratings", "playlists"].forEach(function (id) { if (st.loaded[id] && (was !== st.self || id === "playlists")) st.show(id, true); });
      return;
    }
    unmountTabs(host);
    var nums = host.querySelector("#p-nums");
    st = host._st = { uid: o.uid, self: !!o.self, loaded: {}, nodes: [], cur: "" };
    var defs = [];
    if (nums) defs.push({ id: "nums", label: "Номера", panel: nums });
    defs.push({ id: "comments", label: "Комментарии" }, { id: "ratings", label: "Оценки" }, { id: "playlists", label: "Плейлисты" });
    var bar = el("div", { class: "ptabs-bar", role: "tablist" });
    host.insertBefore(bar, host.firstChild); st.nodes.push(bar);
    defs.forEach(function (d) {
      if (!d.panel) { d.panel = el("div", { class: "ptabs-panel", id: "pt-" + d.id, role: "tabpanel", hidden: true }); host.append(d.panel); st.nodes.push(d.panel); }
      d.btn = el("button", { type: "button", class: "ptab", role: "tab", "aria-selected": "false", text: d.label, onclick: function () { st.show(d.id); } });
      bar.append(d.btn);
    });
    st.show = function (id, force) {
      if (!force) st.cur = id;
      defs.forEach(function (d) {
        var on = d.id === st.cur;
        d.btn.setAttribute("aria-selected", on ? "true" : "false");
        d.btn.classList.toggle("is-on", on);
        d.panel.hidden = !on;
      });
      var d = defs.filter(function (x) { return x.id === id; })[0];
      if (!d || d.id === "nums" || (st.loaded[id] && !force)) return;
      st.loaded[id] = true;
      clear(d.panel).append(el("p", { class: "c-hint", text: "Загрузка…" }));
      catalogInfo().then(function (info) {
        if (id === "comments") return panelComments(d.panel, st.uid, info, st.self);
        if (id === "ratings") return panelRatings(d.panel, st.uid, info, st.self);
        return panelPlaylists(d.panel, st.uid, st.self, info);
      }).catch(function (e) { st.loaded[id] = false; clear(d.panel).append(errorState(errText(e), function () { st.show(id, true); })); });
    };
    var h = (location.hash || "").replace("#", ""), start = defs[0].id;
    defs.forEach(function (d) { if (d.id === h) start = d.id; });
    st.show(start);
  }

  /* Кнопка «В плейлист» на странице номера */
  function initPlaylistAdd() {
    var host = document.getElementById("pl-add");
    if (!host) return;
    var nid = host.dataset.number, open = false, lists = null, busy = false;
    function draw() {
      clear(host);
      var btn = el("button", { type: "button", class: "add-btn add-btn-s", "aria-expanded": open ? "true" : "false", text: "В плейлист", onclick: function () {
        if (!state.user) { toast("Войдите, чтобы собирать плейлисты."); return; }
        open = !open;
        if (open && !lists) { loadUserPlaylists(state.user.uid, true).then(function (l) { lists = l; draw(); }, function (e) { open = false; toast(errText(e)); draw(); }); }
        draw();
      } });
      host.append(btn);
      if (!open || !state.user) return;
      var box = el("div", { class: "pl-pop" });
      if (!lists) { box.append(el("p", { class: "c-hint", text: "Загрузка…" })); host.append(box); return; }
      lists.forEach(function (p) {
        var has = (p.numberIds || []).indexOf(nid) !== -1;
        var cb = el("input", { type: "checkbox" }); cb.checked = has;
        cb.addEventListener("change", function () {
          if (busy) { cb.checked = !cb.checked; return; }
          var ids = (p.numberIds || []).filter(function (x) { return x !== nid; });
          if (cb.checked) { if (ids.length >= PL_ITEMS) { cb.checked = false; toast("В плейлисте может быть до " + PL_ITEMS + " номеров."); return; } ids.push(nid); }
          busy = true;
          plSetItems(p, ids).then(function () { busy = false; draw(); }, function (e) { busy = false; cb.checked = !cb.checked; toast(errText(e)); });
        });
        box.append(el("label", { class: "pl-row" }, cb, el("span", { text: p.name })));
      });
      if (!lists.length) box.append(el("p", { class: "c-hint", text: "У вас пока нет плейлистов. Создайте первый:" }));
      var inp = el("input", { class: "c-input", type: "text", maxlength: "80", placeholder: "Новый плейлист", "aria-label": "Название нового плейлиста" });
      var msg = el("p", { class: "msg msg-err", hidden: true });
      var go = el("button", { type: "submit", class: "btn btn-s", text: "Создать и добавить" });
      box.append(el("form", { class: "pl-new", onsubmit: function (ev) {
        ev.preventDefault();
        var er = plNameError(inp.value);
        if (!er && lists.length >= PL_MAX) er = "Можно создать до " + PL_MAX + " плейлистов.";
        if (er) { msg.textContent = er; msg.hidden = false; return; }
        go.disabled = true;
        plCreate(inp.value.trim(), [nid]).then(function () { return loadUserPlaylists(state.user.uid, true); }).then(function (l) { lists = l; draw(); },
          function (e) { go.disabled = false; msg.textContent = errText(e); msg.hidden = false; });
      } }, el("div", { class: "c-row" }, inp, go), msg),
        el("p", { class: "c-hint" }, "Плейлисты видны всем на вашей странице."));
      host.append(box);
    }
    views.push(function () { if (!state.user) { open = false; lists = null; } draw(); });
    draw();
  }

  /* ------------------------------------------------------------ страница пользователя
     Создаётся сама для каждого, кто оставил комментарий: имя, фото и его комментарии.
     Если аккаунт подтверждён владельцем страницы человека, ссылка ведёт сразу на ту страницу. */
  function initUserPage() {
    var box = document.getElementById("user-page");
    if (!box) return;
    var uid = new URLSearchParams(location.search).get("id") || "";
    var data = null, info = null, claimsOf = {}, done = false, moved = false;
    var tabsHost = el("div", { class: "ptabs" });

    function load(fresh) {
      if (!uid) { done = true; return Promise.resolve(); }
      return Promise.all([
        cached("user:claims:" + uid, TTL.pub, fresh === true, function () {
          return fb.f.getDocs(fb.f.query(fcol("claims"), fb.f.where("uid", "==", uid))).then(function (s) {
            var o = {}; s.forEach(function (d) { o[d.id] = d.data(); }); return o;
          });
        }).catch(function () { return {}; }),
        loadUserComments(uid).catch(function () { return null; }),
        loadAvatars([uid]),
        catalogInfo()
      ]).then(function (r) {
        claimsOf = r[0] || {}; data = r[1]; info = r[3];
        var pids = Object.keys(claimsOf).filter(function (p) { return claimsOf[p].status === "approved"; });
        if (pids.length) { moved = true; location.replace(ROOT + "p/" + pids[0] + "/"); return; }
        done = true;
      });
    }
    function dismissed(pid) { try { return window.localStorage.getItem("sg:nomatch:" + uid + ":" + pid) === "1"; } catch (e) { return false; } }
    function dismiss(pid) { try { window.localStorage.setItem("sg:nomatch:" + uid + ":" + pid, "1"); } catch (e) { } }
    function refresh() { cdrop("user:claims:" + uid); return load(true).then(draw); }

    /* «Это ваша страница?»: в каталоге нашёлся человек с таким же именем */
    function matchCard(p, taken, ambiguous) {
      var nums = numbersOfPerson(info, p.name);
      var patr = el("input", { class: "c-input", type: "text", maxlength: "40", "aria-label": "Отчество", placeholder: ambiguous ? "Отчество (в каталоге есть тёзки)" : "Отчество (по желанию)" });
      var card = el("section", { class: "match-card" },
        el("h2", { text: "Это ваша страница?" }),
        el("p", { class: "match-name" }, el("a", { href: ROOT + "p/" + p.id + "/", text: p.name }),
          el("span", { class: "c-hint", text: nums.length ? " · номеров: " + nums.length : "" })));
      var ul = el("div", { class: "c-list match-nums" });
      nums.slice(0, 4).forEach(function (n) { ul.append(pcard(n.id, [el("p", { class: "c-head" }, numLink(info, n.id)), el("p", { class: "c-hint", text: n.concert || "" })])); });
      card.append(ul);
      if (nums.length > 4) card.append(el("p", { class: "c-hint" }, el("a", { href: ROOT + "p/" + p.id + "/", text: "Все номера на странице" })));
      if (taken) {
        card.append(el("p", { class: "msg", text: "На эту страницу уже подана заявка с другого аккаунта. Если вы не тот человек, нажмите «Нет, не моя»." }));
      } else {
        card.append(patr);
      }
      var row = el("div", { class: "c-row" });
      if (!taken) row.append(el("button", { type: "button", class: "btn", text: "Да, это моя страница", onclick: function (ev) {
        var pt = patr.value.trim().replace(/\s+/g, " ");
        if (ambiguous && !pt) { note(card, "Впишите отчество: в каталоге есть человек с таким же именем и фамилией.", "err"); patr.focus(); return; }
        ev.target.disabled = true;
        submitClaim(p.id, pt).then(function () { toast("Заявка отправлена администратору."); return refresh(); },
          function (e) { ev.target.disabled = false; note(card, e && e.code === "permission-denied" ? "Страница ещё не передана сервису. Попробуйте позже." : errText(e), "err"); });
      } }));
      row.append(el("button", { type: "button", class: "btn btn-ghost", text: "Нет, не моя", onclick: function () { dismiss(p.id); card.remove(); } }));
      card.append(row);
      if (!taken) card.append(el("p", { class: "c-hint", text: "После заявки страница будет «не подтверждена», пока её не проверит администратор." }));
      return card;
    }
    function drawMatches(host) {
      var ms = matchPeople(info, state.user.displayName || "").filter(function (p) { return !dismissed(p.id); });
      if (!ms.length) return;
      Promise.all(ms.map(function (p) {
        return fb.f.getDoc(fdoc("claims/" + p.id)).then(function (d) { return d.exists() ? d.data() : null; }, function () { return null; });
      })).then(function (taken) {
        ms.forEach(function (p, i) { host.append(matchCard(p, taken[i], ms.length > 1)); });
      });
    }
    function searchBox() {
      var inp = el("input", { class: "c-input", type: "text", list: "pu-people", placeholder: "Фамилия и имя", "aria-label": "Найти свою страницу", autocomplete: "off" });
      var dl = el("datalist", { id: "pu-people" });
      (info.people || []).forEach(function (p) { dl.append(el("option", { value: p.name })); });
      var msg = el("p", { class: "msg msg-err", hidden: true });
      var go = function () {
        var v = nrm(inp.value), hit = (info.people || []).filter(function (p) { return nrm(p.name) === v; })[0] || matchPeople(info, inp.value)[0];
        if (hit) { location.href = ROOT + "p/" + hit.id + "/"; return; }
        msg.textContent = "Такой страницы нет. Выберите имя из подсказки."; msg.hidden = false;
      };
      return el("details", { class: "edit-box" }, el("summary", { text: "Найти свою страницу среди участников" }),
        el("p", { class: "c-hint", text: "Выступали под другой фамилией? Найдите страницу по прежнему имени и нажмите «Это моя страница»." }),
        el("div", { class: "c-row" }, inp, dl, el("button", { type: "button", class: "btn btn-s", text: "Открыть", onclick: go })), msg);
    }

    function draw() {
      clear(box);
      if (!uid) { box.append(el("p", { class: "c-hint", text: "Не указан пользователь." })); return; }
      if (!done || moved) { box.append(el("p", { class: "c-hint", text: "Загрузка…" })); return; }
      var self = !!(state.user && state.user.uid === uid);
      if (self && !state.ready) { box.append(el("p", { class: "c-hint", text: "Загрузка…" })); return; }
      if (self && approvedPids().length) { location.replace(ownPageUrl()); return; }
      var cl = self ? state.claims : claimsOf;
      var pend = Object.keys(cl || {}).filter(function (p) { return cl[p].status === "pending"; });
      var list = (data || []).slice().sort(function (a, b) { return tsMs(b.createdAt) - tsMs(a.createdAt); });
      var name = nicks[uid] || realNames[uid] || (list.length && list[0].authorName) || (self && myName()) || "Пользователь";
      document.title = document.title.replace(/^[^:]*:/, name + ":");
      var ttl = el("div", null, el("h1", { text: name }));
      if (pend.length) {
        ttl.append(el("p", { class: "user-pend" }, el("span", { class: "badge badge-off", text: "Не подтверждено" }), " ",
          el("a", { href: ROOT + "p/" + pend[0] + "/", text: "страница «" + (peopleNames[pend[0]] || pend[0]) + "»" })));
      } else if (self) ttl.append(el("p", { class: "c-hint", text: "Это ваша страница. Её видят все, кто нажмёт на ваше имя." }));
      var stats = el("ul", { class: "pstats" }), commLi = el("li", { hidden: true });
      stats.append(commLi); ttl.append(stats);
      commentCount(uid).then(function (n) {
        clear(commLi).append(el("b", { text: String(n) }), " " + plural(n, "комментарий", "комментария", "комментариев"));
        commLi.hidden = false;
      }, function () { });
      var soc = socialRow(userLinks[uid]); if (soc) ttl.append(soc);
      box.append(el("div", { class: "user-head" }, avatarNode(uid, name, "l"), ttl));

      if (self) {
        if (pend.length) {
          box.append(el("p", { class: "msg", text: "Заявка на страницу «" + (peopleNames[pend[0]] || pend[0]) + "» отправлена администратору. Пока она не подтверждена, у вас эта временная страница. После подтверждения они объединятся." }),
            el("button", { type: "button", class: "linkbtn", text: "Отозвать заявку", onclick: function () { withdrawClaim(pend[0]).then(refresh, function (e) { toast(errText(e)); }); } }));
        } else {
          var mh = el("div", { class: "match-host" });
          box.append(mh); drawMatches(mh);
          box.append(searchBox());
        }
        box.append(el("div", { class: "c-row" }, shareButton("", name, location.href),
          el("a", { class: "btn btn-s btn-ghost", href: ROOT + "settings/", text: "Настройки профиля" })));
      }
      box.append(tabsHost);
      mountTabs(tabsHost, { uid: uid, name: name, self: self });
    }
    views.push(draw);
    load().then(draw);
  }

  /* ------------------------------------------------------------ страница пользователя: общие части */
  /* Имя и фамилия сравниваются по первым двум словам, в любом порядке («Белоусова Виктория» = «Виктория Белоусова») */
  function nameKeys(full) {
    var t = nrm(full).split(" ").filter(Boolean);
    if (t.length < 2) return [nrm(full)];
    var a = t.slice(0, 2);
    return [a.join(" "), a.slice().reverse().join(" ")];
  }
  function matchPeople(info, name) {
    if (nrm(name).split(" ").filter(Boolean).length < 2) return [];
    var keys = nameKeys(name);
    return (info.people || []).filter(function (p) { return nameKeys(p.name).some(function (k) { return keys.indexOf(k) !== -1; }); });
  }
  function numbersOfPerson(info, name) {
    var key = nrm(name);
    return (info.numbers || []).filter(function (n) {
      return (n.performers || []).concat(n.choreographers || []).some(function (x) { return nrm(x) === key; });
    });
  }
  /* Заявка «это моя страница»: отчество (если нужно) дописывается к имени заявки, чтобы администратор мог отличить тёзок */
  function submitClaim(pid, patronymic) {
    var u = state.user, nm = (u.displayName || "Без имени") + (patronymic ? " " + patronymic : "");
    return fb.f.setDoc(fdoc("claims/" + pid), { uid: u.uid, name: nm.slice(0, 100), status: "pending", createdAt: fb.f.serverTimestamp() })
      .then(function () { cdrop("admin:"); return loadMe(u, true); }).then(function () { drawAuth(); });
  }
  function withdrawClaim(pid) {
    return fb.f.deleteDoc(fdoc("claims/" + pid)).then(function () { cdrop("admin:"); return loadMe(state.user, true); }).then(function () { drawAuth(); });
  }
  /* Окно обрезки фото: двигать пальцем или мышью, менять размер ползунком, колесом или щипком. Результат — квадрат 512 px. */
  function cropDialog(file) {
    return new Promise(function (ok, bad) {
      var url = URL.createObjectURL(file), img = new Image();
      var cancel = function () { var e = new Error("cancel"); e.cancelled = true; bad(e); };
      img.onerror = function () { URL.revokeObjectURL(url); bad(new Error("Не удалось открыть изображение.")); };
      img.onload = function () {
        var W = img.naturalWidth, H = img.naturalHeight;
        var S = Math.max(220, Math.min(320, Math.floor(Math.min(window.innerWidth, window.innerHeight) * 0.78)));
        var base = S / Math.min(W, H), zoom = 1, x = 0, y = 0;
        var pic = el("img", { class: "crop-img", alt: "", draggable: "false", src: url, style: "width:" + W + "px;height:" + H + "px" });
        var frame = el("div", { class: "crop-frame" });
        var stage = el("div", { class: "crop-stage", style: "width:" + S + "px;height:" + S + "px", tabindex: "0", "aria-label": "Область фото: перетащите, чтобы сдвинуть" }, pic, frame);
        var range = el("input", { type: "range", class: "crop-zoom", min: "1", max: "4", step: "0.01", value: "1", "aria-label": "Масштаб" });
        var okBtn = el("button", { type: "button", class: "btn", text: "Готово" });
        var noBtn = el("button", { type: "button", class: "btn btn-ghost", text: "Отмена" });
        var ov = el("div", { class: "crop-ov", role: "dialog", "aria-modal": "true", "aria-label": "Настройка фото" },
          el("div", { class: "crop-box" }, el("h2", { text: "Фото профиля" }),
            el("p", { class: "c-hint", text: "Подвиньте фото и выберите размер. В круге останется то, что будет видно." }),
            stage, el("div", { class: "crop-zoom-row" }, el("span", { "aria-hidden": "true", text: "−" }), range, el("span", { "aria-hidden": "true", text: "+" })),
            el("div", { class: "c-row" }, okBtn, noBtn)));
        function clamp() {
          var sc = base * zoom;
          x = Math.min(0, Math.max(S - W * sc, x));
          y = Math.min(0, Math.max(S - H * sc, y));
        }
        function paint() { clamp(); pic.style.transform = "translate(" + x + "px," + y + "px) scale(" + (base * zoom) + ")"; range.value = String(zoom); }
        function setZoom(z, px, py) {   // масштаб вокруг точки (px, py) внутри окна
          z = Math.min(4, Math.max(1, z));
          var o = base * zoom, n = base * z;
          x = px - (px - x) * n / o; y = py - (py - y) * n / o;
          zoom = z; paint();
        }
        x = (S - W * base) / 2; y = (S - H * base) / 2; paint();
        var ptr = {}, last = null;
        function dist() { var k = Object.keys(ptr); return Math.hypot(ptr[k[0]].x - ptr[k[1]].x, ptr[k[0]].y - ptr[k[1]].y); }
        stage.addEventListener("pointerdown", function (e) {
          try { stage.setPointerCapture(e.pointerId); } catch (er) { }
          ptr[e.pointerId] = { x: e.clientX, y: e.clientY };
          last = Object.keys(ptr).length === 2 ? { d: dist(), z: zoom } : null;
          stage.classList.add("is-drag");
        });
        stage.addEventListener("pointermove", function (e) {
          var p = ptr[e.pointerId]; if (!p) return;
          var n = Object.keys(ptr).length;
          if (n === 1) { x += e.clientX - p.x; y += e.clientY - p.y; p.x = e.clientX; p.y = e.clientY; paint(); }
          else if (n === 2) {
            p.x = e.clientX; p.y = e.clientY;
            if (last && last.d > 0) setZoom(last.z * dist() / last.d, S / 2, S / 2);
          }
        });
        function up(e) { delete ptr[e.pointerId]; last = null; if (!Object.keys(ptr).length) stage.classList.remove("is-drag"); }
        stage.addEventListener("pointerup", up); stage.addEventListener("pointercancel", up);
        stage.addEventListener("wheel", function (e) { e.preventDefault(); setZoom(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08), S / 2, S / 2); }, { passive: false });
        stage.addEventListener("keydown", function (e) {
          var st = 12, k = e.key;
          if (k === "ArrowLeft") x += st; else if (k === "ArrowRight") x -= st; else if (k === "ArrowUp") y += st; else if (k === "ArrowDown") y -= st;
          else if (k === "+" || k === "=") { setZoom(zoom * 1.1, S / 2, S / 2); e.preventDefault(); return; }
          else if (k === "-") { setZoom(zoom / 1.1, S / 2, S / 2); e.preventDefault(); return; }
          else return;
          e.preventDefault(); paint();
        });
        range.addEventListener("input", function () { setZoom(Number(range.value), S / 2, S / 2); });
        var prevFocus = document.activeElement, prevOverflow = document.body.style.overflow;
        function close() { document.removeEventListener("keydown", onKey, true); ov.remove(); document.body.style.overflow = prevOverflow; URL.revokeObjectURL(url); try { prevFocus && prevFocus.focus(); } catch (er) { } }
        function onKey(e) { if (e.key === "Escape") { e.stopPropagation(); close(); cancel(); } }
        noBtn.addEventListener("click", function () { close(); cancel(); });
        ov.addEventListener("pointerdown", function (e) { if (e.target === ov) { close(); cancel(); } });
        okBtn.addEventListener("click", function () {
          var sc = base * zoom, c = document.createElement("canvas"); c.width = c.height = 512;
          var g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 512, 512);
          g.drawImage(img, -x / sc, -y / sc, S / sc, S / sc, 0, 0, 512, 512);
          c.toBlob(function (b) {
            close();
            if (b) ok(b); else bad(new Error("Не удалось обработать фото."));
          }, "image/jpeg", 0.92);
        });
        document.addEventListener("keydown", onKey, true);
        document.body.style.overflow = "hidden";
        document.body.append(ov);
        okBtn.focus();
      };
      img.src = url;
    });
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
        file.value = "";
        avatarLimitLeft().then(function () { return cropDialog(f); }).then(function (blob) {
          note(wrap, "Загружаем…");
          return setMyAvatar(blob).then(function () { note(wrap, "Фото сохранено.", "ok"); return loadMine(); }).then(draw);
        }).catch(function (e) {
          if (e && e.cancelled) return;
          note(wrap, e && e.code ? errText(e) : (e && e.message) || "Не удалось загрузить фото.", "err");
        });
      } });
      var on = approvedPids().length ? " и на вашей странице" : "";
      wrap.append(avatarNode(u.uid, myName(), "l"),
        el("div", null,
          el("button", { type: "button", class: "btn btn-s", text: avatars[u.uid] ? "Заменить фото" : "Загрузить фото", onclick: function () { file.click(); } }),
          avatars[u.uid] && el("button", { type: "button", class: "linkbtn", text: "Убрать фото", onclick: function () { clearMyAvatar().then(loadMine).then(draw, function (e) { note(wrap, errText(e), "err"); }); } }),
          el("p", { class: "c-hint", text: "Фото видно рядом с вашими комментариями" + on + ". Менять фото можно до " + LIM.avatars + " раз в месяц. Подойдёт любая картинка, она сожмётся и обрежется до квадрата." })),
        file);
      return wrap;
    }

    function draw() {
      clear(box);
      if (!state.ready) { box.append(el("p", { class: "c-hint", text: "Загрузка…" })); return; }
      if (!state.user) {
        box.append(signInPrompt("Войдите, чтобы вести свою страницу"));
        return;
      }
      box.append(el("p", { class: "lead", text: myName() + (state.admin ? ". Вы администратор." : "") }));
      box.append(avatarBox());
      var nameIn = el("input", { class: "c-input", type: "text", maxlength: "40", "aria-label": "Имя в комментариях" });
      nameIn.value = myName();
      var nameBox = el("details", { class: "edit-box" }, el("summary", { text: "Изменить имя" }),
        el("label", null, "Имя или ник в комментариях", nameIn),
        el("p", { class: "c-hint", text: "Имя на вашей странице не меняется. Если оно отличается от ника, в комментариях оно появится в скобках после ника. Менять можно до " + LIM.renames + " раз в месяц." }),
        el("button", { type: "button", class: "btn btn-s", text: "Сохранить имя", onclick: function () {
          var nm = nameIn.value.trim().replace(/\s+/g, " ");
          if (nm.length < 2) { note(nameBox, "Имя слишком короткое.", "err"); return; }
          var bad = findProfanity(nm);
          if (bad) { note(nameBox, "Мат не проходит: слово «" + bad + "».", "err"); return; }
          setMyNick(nm).then(function () { note(nameBox, "Имя сохранено.", "ok"); draw(); }, function (e) { note(nameBox, errText(e), "err"); });
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
      if (state.ready && state.user && !state.admin) { location.replace(ownPageUrl()); return; }   // у обычных пользователей кабинет заменила собственная страница
      draw();
      loadMine().then(draw);
      loadCatalog().then(function () {
        if (!state.admin) return draw();
        return sync(false).then(function (m) { syncMsg = /обновлён/.test(m) ? m : ""; }, function (e) { syncMsg = errText(e); }).then(loadAdmin).then(draw);
      });
    });
  }

  /* ------------------------------------------------------------ настройки профиля
     Здесь всё личное: фото, ник, соцсети, «о себе», лимиты и выход. Публичное (номера, комментарии, оценки) лежит на странице человека. */
  function initSettings() {
    var box = document.getElementById("settings");
    if (!box) return;
    var tab = location.hash === "#limits" ? "limits" : "main";
    var usage = null, usageErr = false, prof = null, started = false;

    function loadUsage() {
      usageErr = false;
      return Promise.all([readUsage("d"), readUsage("m")]).then(function (r) { usage = { d: r[0], m: r[1] }; },
        function () { usage = null; usageErr = true; });
    }
    function loadProf() {
      var ids = approvedPids();
      if (!ids.length) { prof = null; return Promise.resolve(); }
      return ownProfile(ids[0]).then(function (p) { prof = p || {}; }, function () { prof = {}; });
    }
    function left(kind, field, max) { return usage ? Math.max(0, max - ((usage[kind] && usage[kind][field]) || 0)) : null; }
    function card(title, hint) {
      return el("section", { class: "set-card" }, el("h2", { text: title }), hint ? el("p", { class: "c-hint", text: hint }) : null);
    }
    function reloadAll() { usage = null; return Promise.all([loadUsage(), loadProf()]).then(draw); }

    function avatarCard() {
      var u = state.user, c = card("Фото", "Фото можно менять " + LIM.avatars + " раза в месяц. Оно сразу появится рядом с вашими комментариями и на вашей странице. Подойдёт любая картинка: окно поможет выбрать, что войдёт в круг.");
      var l = left("m", "avatars", LIM.avatars);
      if (l !== null) c.append(el("p", { class: "c-hint", text: "Осталось смен в этом месяце: " + l + " из " + LIM.avatars + "." }));
      c.append(el("p", { class: "c-hint", text: "На другом устройстве фото в вашем аккаунте может поменяться не сразу, а через какое-то время (до двух недель). Чтобы увидеть новое фото быстрее, выйдите из профиля и войдите снова." }));
      var file = el("input", { type: "file", accept: "image/*", "aria-label": "Выбрать фото", hidden: true, onchange: function () {
        var f = file.files[0]; if (!f) return;
        file.value = "";
        avatarLimitLeft().then(function () { return cropDialog(f); }).then(function (blob) {
          note(c, "Загружаем…");
          return setMyAvatar(blob).then(function () { return reloadAll(); });
        }).catch(function (e) {
          if (e && e.cancelled) return;
          note(c, e && e.code ? errText(e) : (e && e.message) || "Не удалось загрузить фото.", "err");
        });
      } });
      c.append(el("div", { class: "set-photo" }, avatarNode(u.uid, myName(), "xl"),
        el("div", { class: "set-photo-btns" },
          el("button", { type: "button", class: "btn", text: avatars[u.uid] ? "Заменить фото" : "Выбрать изображение", onclick: function () { file.click(); } }),
          avatars[u.uid] && el("button", { type: "button", class: "linkbtn", text: "Убрать фото", onclick: function () {
            clearMyAvatar().then(function () { draw(); }, function (e) { note(c, errText(e), "err"); }); } }))), file);
      return c;
    }
    function nameCard() {
      var u = state.user, ids = approvedPids(), shown = (ids.length && peopleNames[ids[0]]) || u.displayName || "Без имени";
      var c = card("Имя", "Имя нельзя изменить: оно остаётся таким же на вашей странице и в каталоге. Менять можно только ник.");
      c.append(el("input", { class: "c-input", type: "text", value: shown, readonly: true, "aria-label": "Имя" }));
      return c;
    }
    function nickCard() {
      var c = card("Ник", "Ник виден в комментариях и на вашей странице. Если он отличается от имени, имя стоит рядом в скобках. Менять можно до " + LIM.renames + " раз в месяц.");
      var l = left("m", "renames", LIM.renames);
      if (l !== null) c.append(el("p", { class: "c-hint", text: "Осталось смен в этом месяце: " + l + " из " + LIM.renames + "." }));
      var inp = el("input", { class: "c-input", type: "text", maxlength: "40", "aria-label": "Ник" });
      inp.value = myName();
      c.append(inp, el("div", { class: "c-row" }, el("button", { type: "button", class: "btn", text: "Сохранить ник", onclick: function () {
        var nm = inp.value.trim().replace(/\s+/g, " ");
        if (nm.length < 2) { note(c, "Ник слишком короткий.", "err"); return; }
        var bad = findProfanity(nm);
        if (bad) { note(c, "Мат не проходит: слово «" + bad + "».", "err"); return; }
        setMyNick(nm).then(function () { return reloadAll(); }, function (e) { note(c, errText(e), "err"); });
      } })));
      return c;
    }
    function socialCard() {
      var u = state.user, cur = userLinks[u.uid] || {}, c = card("Соцсети", "Ссылки покажутся на вашей странице. Оставьте поле пустым, если ссылка не нужна.");
      var ins = {};
      SOC.forEach(function (sc) {
        ins[sc.k] = el("input", { class: "c-input", type: "url", inputmode: "url", maxlength: "200", placeholder: sc.ph, "aria-label": sc.label });
        ins[sc.k].value = cur[sc.k] || "";
        c.append(el("label", { class: "soc-field" }, el("span", { class: "soc-field-name soc" }, socIcon(sc.k), el("span", { text: sc.label })), ins[sc.k]));
      });
      c.append(el("div", { class: "c-row" }, el("button", { type: "button", class: "btn", text: "Сохранить ссылки", onclick: function () {
        var out = {}, bad = "";
        SOC.forEach(function (sc) { var v = cleanUrl(ins[sc.k].value); if (v === null) bad = bad || sc.label; else out[sc.k] = v; });
        if (bad) { note(c, "Ссылка «" + bad + "» не похожа на адрес сайта.", "err"); return; }
        fb.f.setDoc(fdoc("users/" + u.uid), { links: out, updatedAt: fb.f.serverTimestamp() }, { merge: true }).then(function () {
          userLinks[u.uid] = out; putUA(u.uid);
          SOC.forEach(function (sc) { ins[sc.k].value = out[sc.k]; });
          note(c, "Сохранено.", "ok");
        }, function (e) { note(c, e && e.code === "permission-denied" ? "Сервис пока не принимает ссылки. Попробуйте позже." : errText(e), "err"); });
      } })));
      return c;
    }
    function bioCard() {
      var ids = approvedPids();
      if (!ids.length) return null;
      var c = card("О себе", "Текст на вашей странице в каталоге.");
      var ta = el("textarea", { class: "c-input", rows: "5", maxlength: "2000", "aria-label": "О себе", placeholder: "Коротко о себе" });
      ta.value = (prof && prof.bio) || "";
      c.append(ta, el("div", { class: "c-row" }, el("button", { type: "button", class: "btn", text: "Сохранить", onclick: function () {
        writeProfile(ids[0], { bio: ta.value.trim() }).then(function () { return loadProf(); }).then(function () { note(c, "Сохранено.", "ok"); }, function (e) { note(c, errText(e), "err"); });
      } })));
      return c;
    }
    function footer() {
      var u = state.user, out = el("div", { class: "set-foot" });
      var viaPass = u.providerData && u.providerData.some(function (p) { return p.providerId === "password"; });
      if (viaPass && !u.emailVerified) {
        out.append(el("p", { class: "c-hint", text: "E-mail " + u.email + " пока не подтверждён." }),
          el("button", { type: "button", class: "linkbtn", text: "Отправить письмо ещё раз", onclick: function (ev) {
            fb.a.sendEmailVerification(u).then(function () { ev.target.textContent = "Письмо отправлено"; }, function (e) { toast(errText(e)); }); } }));
      }
      if (state.admin) out.append(el("a", { class: "btn btn-ghost", href: ROOT + "account/", text: "Кабинет администратора" }));
      out.append(el("button", { type: "button", class: "btn btn-out", text: "Выйти из профиля", onclick: function () { signOut().then(function () { location.href = ROOT || "./"; }); } }));
      return out;
    }

    function limitRow(label, used, max, reset) {
      var rest = Math.max(0, max - used), full = rest === 0;
      return el("div", { class: "lim-row" + (full ? " is-full" : "") },
        el("div", { class: "lim-top" }, el("span", { class: "lim-name", text: label }), el("span", { class: "lim-num", text: used + " из " + max })),
        el("div", { class: "lim-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(max), "aria-valuenow": String(Math.min(used, max)), "aria-label": label },
          el("span", { style: "width:" + Math.min(100, Math.round(used / max * 100)) + "%" })),
        el("p", { class: "c-hint", text: (full ? "Лимит исчерпан. " : "Осталось: " + rest + ". ") + reset }));
    }
    function limitsPanel() {
      var wrap = el("div", { class: "set-panel" });
      if (usageErr) { wrap.append(card("Лимиты", "Не удалось загрузить лимиты. Обновите страницу чуть позже.")); return wrap; }
      if (!usage) { wrap.append(el("p", { class: "c-hint", text: "Загрузка…" })); return wrap; }
      var day = card("Сегодня", "Счётчики дня обнуляются в полночь по времени Самары (UTC+4).");
      day.append(limitRow("Комментарии", usage.d.comments || 0, LIM.comments, "Новые комментарии и ответы."),
        limitRow("Лайки комментариям", usage.d.likes || 0, LIM.likes, "Лайки комментариям других людей."));
      var mon = card("В этом месяце", "Счётчики месяца обнуляются первого числа.");
      mon.append(limitRow("Смена фото", usage.m.avatars || 0, LIM.avatars, "Загрузка нового фото."),
        limitRow("Смена ника", usage.m.renames || 0, LIM.renames, "Имя на странице не меняется."));
      wrap.append(day, mon);
      return wrap;
    }

    function tabBtn(id, label) {
      return el("button", { type: "button", class: "set-tab" + (tab === id ? " is-on" : ""), "aria-current": tab === id ? "page" : null, text: label, onclick: function () {
        tab = id;
        try { history.replaceState(null, "", id === "limits" ? "#limits" : location.pathname + location.search); } catch (e) { }
        if (id === "limits") { usage = null; loadUsage().then(draw); }
        draw();
      } });
    }
    function draw() {
      clear(box);
      if (!state.ready) { box.append(el("p", { class: "c-hint", text: "Загрузка…" })); return; }
      if (!state.user) {
        box.append(signInPrompt("Войдите, чтобы открыть настройки профиля", "Здесь фото, ник, соцсети и лимиты вашего профиля. Войти можно через Google или по e-mail."));
        return;
      }
      if (!started) { started = true; catalogInfo().then(draw, function () { }); reloadAll(); }
      var arrow = el("span", { class: "set-tab-ic" }); arrow.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      box.append(el("nav", { class: "set-tabs", "aria-label": "Разделы настроек" }, tabBtn("main", "Основные"), tabBtn("limits", "Лимиты"),
        el("a", { class: "set-tab set-tab-link", href: ownPageUrl() }, "Моя страница", arrow)));
      if (tab === "limits") { box.append(limitsPanel()); return; }
      var main = el("div", { class: "set-panel" }, avatarCard(), nameCard(), nickCard(), socialCard(), bioCard(), footer());
      box.append(main);
    }
    views.push(draw);
    draw();
  }

  /* ------------------------------------------------------------ запуск */
  var slot = document.getElementById("auth-slot");
  load().then(function () {
    initNumber(); initPlaylistAdd(); initPerson(); initAccount(); initUserPage(); initSettings();
    views.unshift(drawAuth);
    fb.a.onAuthStateChanged(fb.auth, function (user) { loadMe(user).then(refreshViews); });
  }, function (e) {
    console.error(e);
    if (slot) slot.textContent = "";
    var acc = document.getElementById("account");
    if (acc) acc.textContent = "Сервис входа сейчас недоступен. Попробуйте позже.";
    var cm = document.getElementById("comments");
    if (cm) cm.append(errorState("Сервис комментариев сейчас недоступен.", function () { location.reload(); }));
  });
})();
