/***********************************************************************
 *          update_check.js
 *
 *      Is this tab still running the build that is deployed?
 *
 *      This is a hash-routed SPA: moving between the player, the library
 *      and the sources reloads nothing. A tab opened before a deploy
 *      goes on running the old bundle indefinitely, and the only sign is
 *      that a fix "did not work" — which is a bad way to find out.
 *
 *      So the build stamp is compiled in, the build also emits it as a
 *      small file, and the two are compared: on start, and whenever the
 *      tab is brought back to the front (throttled). A difference is
 *      reported, never acted on — reloading is the user's call, since
 *      they may be in the middle of listening to something.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/

const CHECK_EVERY = 60 * 1000;      // at most once a minute

const listeners = new Set();

const S = {
    stale:   false,     // a different build is deployed
    latest:  "",        // what that build calls itself
    checked: 0,         // when we last asked
};

function subscribe_update(fn)
{
    listeners.add(fn);
    return function unsubscribe() {
        listeners.delete(fn);
    };
}

function emit()
{
    for(const fn of listeners) {
        try {
            fn("update");
        } catch(e) {
            console.error("update_check listener failed", e);
        }
    }
}

function is_stale()
{
    return S.stale;
}

function latest_version()
{
    return S.latest;
}

function running_version()
{
    return __APP_VERSION__ + " · " + __BUILD_STAMP__;
}


/***************************************************************
 *  Ask the server what it is serving. Never throws, and a
 *  failure (offline, which is a normal state for this app)
 *  simply leaves the answer as it was.
 ***************************************************************/
async function check_for_update(force)
{
    if(S.stale) {
        return true;                // already known; nothing to re-check
    }
    const now = Date.now();
    if(!force && (now - S.checked) < CHECK_EVERY) {
        return false;
    }
    /*  A check that cannot succeed should not be made. `navigator.onLine`
        is only trustworthy in one direction — true does not promise a
        working internet — but false is definite, and this app is meant to
        be used exactly there. Skipping keeps a doomed request out of the
        console on a plane, where a red line reads like a fault. */
    if(navigator.onLine === false) {
        return false;
    }

    S.checked = now;

    let data;
    try {
        /*  no-store, or the check itself could be answered from the very
            cache it is meant to see past. */
        const r = await fetch("./version.json", {cache: "no-store"});
        if(!r.ok) {
            return false;
        }
        data = await r.json();
    } catch(e) {
        return false;               // offline: not an error here
    }

    if(!data || !data.stamp) {
        return false;
    }
    if(data.stamp !== __BUILD_STAMP__) {
        S.stale = true;
        S.latest = data.version + " · " + data.stamp;
        emit();
        return true;
    }
    return false;
}

function start_update_watch()
{
    check_for_update(true);
    /*  Coming back to the tab is the moment a stale build matters and
        the moment the user is about to act on it. */
    document.addEventListener("visibilitychange", function() {
        if(document.visibilityState === "visible") {
            check_for_update(false);
        }
    });
    window.addEventListener("focus", function() {
        check_for_update(false);
    });
}


export {
    subscribe_update,
    start_update_watch,
    check_for_update,
    is_stale,
    latest_version,
    running_version,
};
