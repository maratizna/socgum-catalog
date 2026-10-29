/* Сервис-воркер каталога: страницы и картинки открываются без сети.
   Собирается вместе с сайтом (версия __V__). Запросы к сервису комментариев и чужим сайтам он не трогает. */
const V = "__V__";
const STATIC = "sg-static-" + V;      // скрипты, стили, шрифты, значки этой версии
const RUNTIME = "sg-runtime";         // страницы, картинки, списки: обновляются при каждом заходе
const CORE = __CORE__;
const SCOPE = self.registration.scope;
const abs = (u) => new URL(u, SCOPE).href;
const MAX_RUNTIME = 900;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(STATIC).then((c) => Promise.allSettled(CORE.map((u) => c.add(abs(u))))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("sg-static-") && k !== STATIC).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_RUNTIME) await Promise.all(keys.slice(0, keys.length - MAX_RUNTIME).map((k) => cache.delete(k)));
}
async function put(cache, req, res) {
  if (res && res.ok && res.type === "basic" && !res.redirected) { await cache.put(req, res.clone()); trim(cache); }
  return res;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* страницы: сначала сеть; если она медленная (больше 3,5 с) или пропала, показываем сохранённую копию */
async function page(req) {
  const cache = await caches.open(RUNTIME);
  const saved = async () => (await caches.match(req)) || (await caches.match(req, { ignoreSearch: true }));
  const have = await saved();
  const net = fetch(req).then((res) => put(cache, req, res));
  if (!have) {
    try { return await net; } catch (_) { return (await caches.match(abs("offline.html"))) || Response.error(); }
  }
  return Promise.race([net.catch(() => have), wait(3500).then(() => have)]);
}
/* версионные файлы: из памяти, сеть только если файла нет */
async function firstCache(req, name) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res && res.ok) (await caches.open(name)).put(req, res.clone());
  return res;
}
/* списки (catalog.json): сеть, при её отсутствии сохранённое */
async function netFirst(req) {
  const cache = await caches.open(RUNTIME);
  try { return await put(cache, req, await fetch(req)); } catch (_) { const hit = await caches.match(req); if (hit) return hit; throw _; }
}
/* картинки: сразу из памяти, в фоне обновляются */
async function stale(req) {
  const cache = await caches.open(RUNTIME);
  const hit = await caches.match(req);
  const net = fetch(req).then((res) => put(cache, req, res)).catch(() => null);
  return hit || (await net) || Response.error();
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || !url.href.startsWith(SCOPE)) return;
  const rel = url.href.slice(SCOPE.length);
  if (req.mode === "navigate") { e.respondWith(page(req)); return; }
  if (/^assets\//.test(rel)) { e.respondWith(firstCache(req, STATIC)); return; }
  if (/^(catalog|rate)\.json$/.test(rel)) { e.respondWith(netFirst(req)); return; }
  if (/^img\//.test(rel) || rel === "manifest.webmanifest") { e.respondWith(stale(req)); return; }
});

/* «Сохранить каталог»: все страницы номеров и людей и маленькие обложки */
async function warm(withImages) {
  const cache = await caches.open(RUNTIME);
  const res = await fetch(abs("catalog.json"), { cache: "no-store" });
  await put(cache, abs("catalog.json"), res.clone());
  const cat = await res.json();
  const pages = ["", "u/", "settings/", "account/"].concat((cat.numbers || []).map((n) => "n/" + n.id + "/"), (cat.people || []).map((p) => "p/" + p.id + "/"));
  const imgs = withImages ? (cat.numbers || []).map((n) => "img/" + n.id + "/card.webp") : [];
  const jobs = pages.map((u) => [u, true]).concat(imgs.map((u) => [u, false]));
  let done = 0, i = 0;
  async function worker() {
    while (i < jobs.length) {
      const [u, refresh] = jobs[i++];
      const req = new Request(abs(u));
      try {
        if (!refresh && (await caches.match(req))) { done++; continue; }
        const r = await fetch(req, refresh ? { cache: "reload" } : undefined);
        await put(cache, req, r); done++;
      } catch (_) { }
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  const all = await self.clients.matchAll();
  all.forEach((c) => c.postMessage({ type: "warm-done", pages: pages.length, done }));
}
self.addEventListener("message", (e) => {
  if (e.data && e.data.type === "warm") e.waitUntil(warm(!!e.data.images).catch(() => { }));
});
