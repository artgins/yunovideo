/***********************************************************************
 *          offline.js
 *
 *      Register the service worker that makes the app open with no
 *      network.
 *
 *      This app reads videos from the device and plays them from the
 *      device. The one thing it would need the network for is the thing
 *      nobody thinks of as a download: itself. A manifest makes an app
 *      INSTALLABLE — icon, own window, folder permissions that survive —
 *      and that is all it does. It caches nothing. yunomúsica shipped
 *      with the manifest and no worker, and an installed app with a full
 *      library opened to a blank screen on a plane; this one starts with
 *      the worker.
 *
 *      Registration is deliberately quiet. It is an improvement to the
 *      launch, not a part of it: nothing here is awaited, and a browser
 *      that refuses (Firefox in private mode, an insecure origin, a user
 *      who blocked storage) simply goes on working the way it did
 *      before, online.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/

function start_offline()
{
    /*  Only the build emits sw.js. Registering in `vite dev` would ask
        for a file that is not there, and the worker would then serve a
        stale shell over the dev server's own hot reload. */
    if(!import.meta.env.PROD) {
        return;
    }
    if(!("serviceWorker" in navigator)) {
        return;
    }

    /*  Document-relative, which is right for this app and would not be
        for another: every route is a hash, so the document URL is always
        the deploy root, where sw.js sits. */
    navigator.serviceWorker.register("./sw.js", {scope: "./"}).then(
        function(reg) {
            /*  Ask once whether a newer worker is deployed. The browser
                does this on navigation anyway; doing it here too means a
                tab left open for days still picks up a deploy. */
            if(typeof reg.update === "function") {
                setTimeout(function() { reg.update(); }, 30 * 1000);
            }
        },
        function(err) {
            /*  Not fatal, and not silent either: "why is it not offline?"
                is a question that deserves an answer in the console. */
            console.warn("yunovídeo: no offline cache —", err && err.message);
        }
    );
}


export {
    start_offline,
};
