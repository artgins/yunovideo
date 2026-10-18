/***********************************************************************
 *          sw_template.js
 *
 *      The service worker, as text. `vite.config.js` reads this file,
 *      substitutes the three placeholders with what the build actually
 *      emitted, and writes the result to dist/sw.js.
 *
 *      It is a template and not a module on purpose: the shell's file
 *      names carry a content hash, so the list of what to precache does
 *      not exist until the bundle does. Nothing imports this file.
 *
 *      What it is for: "offline" has to mean the plane, not only "your
 *      videos never leave the device" (the lesson of yunomúsica, which
 *      claimed the first and was read as the second). Without a service
 *      worker, opening the app is an ordinary HTTP request for
 *      index.html, and with no network there is no app to open the
 *      videos on the device with.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
"use strict";

const CACHE = "__CACHE_NAME__";

/*  The shell, without which there is no app. If any of these cannot be
    stored the install FAILS, on purpose: half a shell in the cache is
    worse than none, because it boots to a broken screen instead of
    falling back to the network. A failed install is retried on the next
    visit. */
const CORE = __CORE__;

/*  Icons and the manifest. Wanted, but an app that boots without its
    favicon is still an app, so these must never cost us the install. */
const EXTRA = __EXTRA__;


/*  How a stored response is looked up, and `ignoreVary` is the whole
 *  point of it.
 *
 *  Matching by Request — not by URL — compares the headers named in the
 *  stored response's `Vary`. Vite's preview server and plenty of real
 *  ones answer with `Vary: Origin`, and the request the worker made with
 *  cache.add() carries no Origin while the browser's own request for a
 *  module script does. Same URL, same file, and the lookup MISSES: the
 *  shell is precached correctly and then not found, which reads exactly
 *  like no worker at all. Cost an afternoon to see.
 *
 *  Ignoring it is right here and would not be everywhere: these entries
 *  are content-hashed, so the URL alone identifies the bytes. There is
 *  no second variant of index-<hash>.js to confuse it with. */
const MATCH = {ignoreSearch: true, ignoreVary: true};


self.addEventListener("install", function(ev) {
    ev.waitUntil((async function() {
        const cache = await caches.open(CACHE);
        /*  `reload`: from the server, never from the HTTP cache. A shell
            precached out of a stale HTTP cache is an old index.html
            stored as the new one, and served from here for good. */
        const fresh = (u) => new Request(u, {cache: "reload"});
        await cache.addAll(CORE.map(fresh));
        await Promise.allSettled(EXTRA.map((u) => cache.add(fresh(u))));
        /*  Take over as soon as the shell is stored, or a deploy takes
            two launches to arrive. The one lazy chunk (the developer
            sheet's traces panel) can be missing for a tab still on the
            old bundle: that tab is told a new version is out, and the
            panel says why it did not load. */
        await self.skipWaiting();
    })());
});


self.addEventListener("activate", function(ev) {
    ev.waitUntil((async function() {
        const names = await caches.keys();
        await Promise.all(names
            .filter((n) => n !== CACHE && n.indexOf("yunovideo-") === 0)
            .map((n) => caches.delete(n)));
        await self.clients.claim();
    })());
});


/***************************************************************
 *  Cache first, for the shell and nothing else.
 *
 *  Cache first and not network first because the case this
 *  exists for is the one with no network: a network-first
 *  worker on a plane spends its timeout on every asset before
 *  falling back, which is a slow boot instead of no boot.
 *  The shell is content-hashed, so a stale answer is not a
 *  risk — a new build has new file names.
 ***************************************************************/
self.addEventListener("fetch", function(ev) {
    const req = ev.request;

    if(req.method !== "GET") {
        return;
    }

    let url;
    try {
        url = new URL(req.url);
    } catch(e) {
        return;
    }

    /*  Anything not ours goes straight out: someone else's server is
        never answered from here. */
    if(url.origin !== self.location.origin) {
        return;
    }

    /*  version.json is the app asking "is a newer build deployed?".
        Answering that from a cache is answering "no" forever. */
    if(url.pathname.endsWith("/version.json")) {
        return;
    }

    /*  Every route in this app is a hash, so any navigation at all is
        the same document. */
    if(req.mode === "navigate") {
        ev.respondWith((async function() {
            const cached = await caches.match("./index.html", MATCH);
            if(cached) {
                return cached;
            }
            return fetch(req);
        })());
        return;
    }

    ev.respondWith((async function() {
        const cached = await caches.match(req, MATCH);
        if(cached) {
            return cached;
        }
        return fetch(req);
    })());
});
