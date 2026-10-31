// Service worker: caches the whole app (including the Python runtime) so it opens with no network.
const CACHE = "nolimit-f4632c6582";
const FILES = ['index.html', 'app.js', 'pages.js', 'db.js', 'style.css', 'engine.js', 'engine-worker.js', 'py.zip', 'manifest.json', 'icon.svg', 'pyodide/pyodide.js', 'pyodide/pyodide.asm.js', 'pyodide/pyodide.asm.wasm', 'pyodide/python_stdlib.zip', 'pyodide/pyodide-lock.json', './'];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then((res) => {
    if (res.ok && new URL(e.request.url).origin === location.origin) {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
    }
    return res;
  })));
});
