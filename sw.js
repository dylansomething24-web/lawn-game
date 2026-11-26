// Network-first: always try for the newest files, fall back to cache offline.
const CACHE = 'cutabove-v6';
const BASE = self.registration.scope;
const ASSETS = ['', 'index.html', 'manifest.json', 'phaser.min.js',
    'js/config.js', 'js/numbers.js', 'js/yards.js', 'js/yard.js', 'js/data.js', 'js/sound.js', 'js/ui.js',
    'js/game.js', 'js/trim.js', 'js/auto.js', 'js/scene.js', 'js/screens.js',
    'icons/icon-192.png', 'icons/icon-512.png'].map(p => BASE + p);

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(caches.keys().then(keys =>
        Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ));
    self.clients.claim();
});

self.addEventListener('fetch', e => {
    if (e.request.method !== 'GET') return;
    e.respondWith(
        fetch(e.request, { cache: 'no-cache' }).then(res => {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, copy));
            return res;
        }).catch(() => caches.match(e.request, { ignoreSearch: true }))
    );
});
