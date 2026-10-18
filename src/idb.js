/***********************************************************************
 *          idb.js
 *
 *      A very small promise wrapper over IndexedDB — the only thing
 *      yunovídeo persists in.
 *
 *      The stores:
 *        - "sources"   the folders and file sets the user authorised.
 *        - "playlists" the lists the user saved.
 *        - "prefs"     small app preferences (the deck, "don't show the
 *                      welcome again", the subtitle language).
 *        - "thumbs"    one frame per video, made the first time it shows.
 *        - "stats"     per video: how often it was watched, its hearts,
 *                      and the second it was left at.
 *
 *      Why IndexedDB and not localStorage: the two things worth keeping
 *      are NOT strings. A FileSystemDirectoryHandle and a File are
 *      structured-cloneable objects, and IndexedDB is the only web store
 *      that keeps them. That is what lets an authorised folder survive a
 *      reload — see sources_store.js.
 *
 *      Every call resolves to a benign value when IndexedDB is missing or
 *      blocked (private mode, an old engine): the app then runs exactly as
 *      it did before, remembering nothing.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {log_warning} from "@yuneta/gobj-js";


const DB_NAME = "yunovideo";
const DB_VERSION = 1;

const STORE_SOURCES   = "sources";
const STORE_PLAYLISTS = "playlists";
const STORE_PREFS     = "prefs";
/*  A source's File objects, in chunks. One record holding thousands of
    them exceeds the structured-clone limit and the write is refused —
    which is how a whole folder was silently lost on Firefox in
    yunomúsica. */
const STORE_FILES     = "source_files";
/*  What a scan learned about a source, by path: the names, the series
    pattern, the subtitles found beside each video. Walking a folder
    again on every reload is minutes of work to reach a result we
    already had. */
const STORE_TAGS      = "source_tags";
/*  One frame per video, and what reading it taught us: duration, size
    of the picture, whether this browser can decode it at all. Made
    once, the first time the video is on screen, and never again. */
const STORE_THUMBS    = "thumbs";
/*  Per video: how often it was watched, how many hearts it was given,
    and WHERE IT WAS LEFT. Not a history: no times, no order — see
    stats_store.js. */
const STORE_STATS     = "stats";

let db_promise = null;
/*  The last open was blocked by another tab, rather than failing. The
    difference matters to the user: one is "this browser stores
    nothing", the other is "close your other Yunovídeo tab". */
let blocked = false;

/*  Told when storage that was unavailable becomes available again, so a
    screen showing the bad news can stop showing it. */
const watchers = new Set();

function on_storage_change(fn)
{
    watchers.add(fn);
    return function unwatch() {
        watchers.delete(fn);
    };
}

function announce()
{
    for(const fn of watchers) {
        try {
            fn();
        } catch(e) {
            console.error("idb watcher failed", e);
        }
    }
}


/***************************************************************
 *  Open (once) and memoise. A failure resolves to null rather
 *  than rejecting, so no caller has to guard with try/catch.
 ***************************************************************/
function open_db()
{
    if(db_promise) {
        return db_promise;
    }
    db_promise = new Promise(function(resolve) {
        if(typeof indexedDB === "undefined") {
            resolve(null);
            return;
        }
        let req;
        try {
            req = indexedDB.open(DB_NAME, DB_VERSION);
        } catch(e) {
            log_warning(`idb: cannot open the database: ${(e && e.name) || e}`);
            resolve(null);
            return;
        }
        req.onupgradeneeded = function() {
            let db = req.result;
            for(const [name, key] of [
                [STORE_SOURCES, "id"],
                [STORE_PLAYLISTS, "id"],
                [STORE_PREFS, "key"],
                [STORE_FILES, "id"],
                [STORE_TAGS, "source_id"],
                [STORE_THUMBS, "key"],
                [STORE_STATS, "key"],
            ]) {
                if(!db.objectStoreNames.contains(name)) {
                    db.createObjectStore(name, {keyPath: key});
                }
            }
        };
        /*  Answered once. A blocked open is answered EARLY, with a
            null, and then answered again for real when the block
            clears — see below. */
        let answered = false;

        req.onsuccess = function() {
            let db = req.result;
            /*  Another tab wants to upgrade the schema. Step aside.
                Holding this connection open blocks THAT tab out of
                storage entirely — which is what a version bump costs
                anyone with two tabs open, and it is not a price the
                older tab gets to charge. */
            db.onversionchange = function() {
                db.close();
                db_promise = null;
            };
            blocked = false;
            if(answered) {
                /*  We already told the app "no database", because
                    another tab was holding the old schema. That tab has
                    gone and the open finished on its own: adopt it, and
                    tell whoever is showing the bad news that it is over.
                    Without this the app stays storage-less until a
                    reload, for a problem that fixed itself. */
                db_promise = Promise.resolve(db);
                announce();
                return;
            }
            answered = true;
            resolve(db);
        };
        req.onerror = function() {
            log_warning(`idb: the database refused to open: ${(req.error && req.error.name) || "?"}`);
            answered = true;
            resolve(null);
        };
        req.onblocked = function() {
            /*  A tab running an OLDER bundle is sitting on the previous
                version, so our upgrade cannot start. This is not the
                browser refusing to store anything — it is one tab too
                many, and it is fixed by closing the other one.

                Answer null NOW so that nothing waits on it: this request
                stays queued until the other tab closes, and a caller
                that awaited it would hang for as long as that took. The
                request itself is kept — it is what repairs us. */
            log_warning("idb: blocked by another tab on an older version");
            blocked = true;
            answered = true;
            resolve(null);
        };
    });
    return db_promise;
}


/***************************************************************
 *  One request in its own transaction. A read answers when its
 *  request succeeds. A WRITE answers when its transaction is
 *  complete, and not before: a quota refusal aborts the
 *  transaction AFTER the request said success, and answering
 *  then reported a write that never landed as one that did.
 *  Every failure is logged, with the store and the reason.
 ***************************************************************/
function run(store_name, mode, fn)
{
    return open_db().then(function(db) {
        if(!db) {
            /*  No database (refused, or blocked by an older tab): said
                once where it is opened. */
            return null;
        }
        return new Promise(function(resolve) {
            const fail = (what, e) => {
                log_warning(`idb: ${what} on ${store_name} failed: ${(e && (e.name || e.message)) || e}`);
                resolve(null);
            };
            let tx;
            try {
                tx = db.transaction(store_name, mode);
            } catch(e) {
                fail("transaction", e);
                return;
            }
            let req;
            try {
                req = fn(tx.objectStore(store_name));
            } catch(e) {
                fail("request", e);
                return;
            }
            if(mode === "readwrite") {
                tx.oncomplete = function() {
                    resolve((req && req.result !== undefined) ? req.result : true);
                };
                /*  A failed request aborts its transaction (its error is
                    not cancelled here, on purpose): the abort answers. */
                tx.onabort = () => fail("write (aborted)", tx.error);
                return;
            }
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => fail("read", req.error);
        });
    });
}


/***************************************************************
 *  Public API. `store` is one of the STORE_* names below.
 ***************************************************************/
function idb_all(store)
{
    return run(store, "readonly", (os) => os.getAll()).then((r) => r || []);
}

function idb_get(store, key)
{
    return run(store, "readonly", (os) => os.get(key)).then((r) => r || null);
}

/*  Resolves to true only if the write really landed. Callers used to
    ignore this, so a failed write — a quota refusal, a browser with
    storage switched off — looked exactly like a successful one until the
    user restarted and found their folders gone. */
function idb_put(store, value)
{
    return run(store, "readwrite", (os) => os.put(value)).then((r) => r !== null);
}

function idb_del(store, key)
{
    return run(store, "readwrite", (os) => os.delete(key));
}

/*  Every record whose key starts with `prefix` — how a source's file
    chunks are removed, since they are keyed "<source id>:<n>". */
function idb_del_prefix(store, prefix)
{
    return run(store, "readwrite", function(os) {
        return os.delete(IDBKeyRange.bound(prefix, prefix + "￿"));
    });
}

/*  Read back every record under that prefix, in key order. */
function idb_get_prefix(store, prefix)
{
    return run(store, "readonly", function(os) {
        return os.getAll(IDBKeyRange.bound(prefix, prefix + "￿"));
    }).then((r) => r || []);
}


/***************************************************************
 *  Preferences: a key/value pair each, so a bad value in one
 *  cannot take the others down with it.
 ***************************************************************/
function pref_get(key, dflt)
{
    return idb_get(STORE_PREFS, key).then(function(row) {
        return (row && row.value !== undefined) ? row.value : dflt;
    });
}

function pref_set(key, value)
{
    return idb_put(STORE_PREFS, {key: key, value: value});
}


/***************************************************************
 *  Is anything at all going to be remembered? The Sources view
 *  says so out loud rather than letting the user find out by
 *  losing their folders.
 ***************************************************************/
function idb_available()
{
    return open_db().then((db) => !!db);
}

/*  Was the last failure a schema upgrade held up by another tab? */
function idb_blocked()
{
    return blocked;
}


/***************************************************************
 *  Ask the browser NOT to evict what we store.
 *
 *  Without this the origin is "best-effort": the browser may
 *  throw the data away whenever it feels like it, and Firefox
 *  in particular clears it on exit when the user has "delete
 *  cookies and site data when Firefox is closed" on. That is
 *  the difference between "your folders are remembered" and
 *  "your folders were remembered until you closed the browser".
 *
 *  Chromium decides silently from site engagement; Firefox
 *  asks the user. So this is called when a source is ADDED —
 *  a moment when the request makes obvious sense — never on
 *  page load.
 ***************************************************************/
function request_persistence()
{
    if(typeof navigator === "undefined" || !navigator.storage ||
            !navigator.storage.persist) {
        return Promise.resolve(false);
    }
    return navigator.storage.persisted()
        .then((already) => already ? true : navigator.storage.persist())
        .catch(function(e) {
            log_warning(`idb: persistent storage could not be asked for: ${(e && e.name) || e}`);
            return false;
        });
}

function storage_persisted()
{
    if(typeof navigator === "undefined" || !navigator.storage ||
            !navigator.storage.persisted) {
        return Promise.resolve(null);       // the browser will not say
    }
    return navigator.storage.persisted().catch(function(e) {
        log_warning(`idb: persisted() failed: ${(e && e.name) || e}`);
        return null;
    });
}


export {
    STORE_SOURCES,
    STORE_PLAYLISTS,
    STORE_PREFS,
    STORE_FILES,
    STORE_TAGS,
    STORE_THUMBS,
    STORE_STATS,
    idb_all,
    idb_get,
    idb_put,
    idb_del,
    idb_del_prefix,
    idb_get_prefix,
    pref_get,
    pref_set,
    idb_available,
    idb_blocked,
    on_storage_change,
    request_persistence,
    storage_persisted,
};
