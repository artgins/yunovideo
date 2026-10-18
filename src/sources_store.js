/***********************************************************************
 *          sources_store.js
 *
 *      The authorised sources: the folders and file sets the user let
 *      yunovídeo read, kept BETWEEN sessions.
 *
 *      Nothing is ever copied. A source holds a reference to what is on
 *      the disk, and the reference is what gets stored:
 *
 *        - kind "dir"   — a FileSystemDirectoryHandle (File System Access
 *          API). It survives in IndexedDB, so the folder is still listed
 *          after a reload; the browser only asks to re-confirm the read
 *          permission, one click, no navigating the tree again. A rescan
 *          picks up files added to the folder since. Chromium only.
 *
 *        - kind "files" — the File objects themselves, which are also
 *          structured-cloneable and so also survive in IndexedDB. This is
 *          what every other engine (and the loose-files picker) gets: the
 *          list is remembered, but it is a SNAPSHOT — files added to the
 *          folder afterwards are not seen, and a file that moved is
 *          reported as missing when it is read.
 *
 *      A folder is always taken WHOLE: the walk recurses into every
 *      subfolder below the one that was chosen.
 *
 *      Carried over from yunomúsica nearly whole, comments included: the
 *      incidents they tell (8847 files lost on Firefox, a prompt that
 *      never answered, the same folder added twice) happened there, with
 *      music, and are why each guard exists here, with video.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    STORE_SOURCES, STORE_FILES, STORE_TAGS,
    idb_all, idb_get, idb_put, idb_del, idb_del_prefix, idb_get_prefix,
    idb_available, idb_blocked, on_storage_change,
    request_persistence, storage_persisted,
} from "./idb.js";
import {diag} from "./diag.js";
import {
    ingest, begin_read, drop_source_tracks, cancel_ingest,
    tags_of_source, restore_tracks, set_file_resolver,
    queue_length, queue_add, videos_of_source, reload_current,
} from "./video_store.js";
import {is_video, is_subtitle} from "./names.js";
import {
    is_stale as update_stale, latest_version as update_latest,
} from "./update_check.js";
import {drop_source_stats} from "./stats_store.js";
import {drop_source_thumbs, forget_bad, thumbs_held} from "./thumbs.js";

/*  Files are stored in batches. One record holding every File of a big
    folder exceeds the structured-clone limit and the write is refused,
    which is exactly how 8847 files went missing on Firefox. */
const FILES_PER_CHUNK = 250;


/***************************************************************
 *      Pub/sub — one channel, "sources".
 ***************************************************************/
const listeners = new Set();

function subscribe_sources(fn)
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
            fn("sources");
        } catch(e) {
            console.error("sources_store listener failed", e);
        }
    }
}


/***************************************************************
 *      State
 *
 *  `sources` holds what is persisted; `runtime` holds what is
 *  not worth persisting and would be stale anyway (the current
 *  permission, whether a scan is running, the last error).
 ***************************************************************/
const S = {
    sources: [],
    runtime: new Map(),     // id -> {permission, scanning, error}
    loaded:  false,
    persistent: false,      // IndexedDB actually works here
    blocked:    false,      // ...or it is only another tab holding it open
    preparing: false,       // the browser is still handing over a folder
    stopping: false,        // Stop pressed, waiting for the loop to break
    write_failed: new Set(),  // ids of sources whose store attempt did not land
    durable: null,          // storage is exempt from eviction (null = unknown)
    notice: null,           // what the last pick ran into, for the screen to say
    pending: null,          // a folder waiting on the user's answer to that notice
};

/*  Put the relative path back on a File that came out of store, so it
    reads the same as one straight from the picker. */
function with_path(f, path)
{
    if(f && path && !f.webkitRelativePath) {
        try {
            Object.defineProperty(f, "webkitRelativePath", {value: path});
        } catch(e) {
            /*  Frozen File: the path lookup will miss for this one and it
                gets read again, which is correct, just slower. */
        }
    }
    return f;
}

function rt(id)
{
    let r = S.runtime.get(id);
    if(!r) {
        r = {permission: "granted", scanning: false, queued: false, error: ""};
        S.runtime.set(id, r);
    }
    return r;
}

function fsa_supported()
{
    return typeof window !== "undefined" && !!window.showDirectoryPicker;
}

function is_persistent()
{
    return S.persistent;
}

/*  True between the picker closing and the browser handing the files
    over. Nothing of ours runs in that gap, and on a phone's whole music
    folder it is the longest part of the whole operation. */
function is_preparing()
{
    return S.preparing;
}

/*  Stop the read that is running, from wherever the user pressed it.
    Acknowledged immediately (see is_stopping) because the loop can only
    break between files, and a button that takes a moment to visibly do
    anything reads as a button that does nothing. */
function stop_scan()
{
    S.stopping = true;
    cancel_ingest();
    emit();
}

function is_stopping()
{
    return S.stopping;
}

function all_sources()
{
    return S.sources.map(function(s) {
        let r = rt(s.id);
        return {
            id: s.id,
            name: s.name,
            kind: s.kind,
            added: s.added,
            count: s.count || 0,
            rescannable: s.kind === "dir",
            seen: s.seen || 0,
            permission: r.permission,
            scanning: r.scanning,
            queued: r.queued,
            error: r.error,
        };
    });
}

function find(id)
{
    return S.sources.find((s) => s.id === id) || null;
}

function new_id()
{
    if(typeof crypto !== "undefined" && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return "s" + Date.now() + "_" + Math.floor(Math.random() * 1e9);
}


/***************************************************************
 *      Permission (only "dir" sources have one)
 ***************************************************************/
async function query_permission(source)
{
    if(source.kind !== "dir" || !source.handle) {
        return "granted";           // a File snapshot needs no permission
    }
    if(typeof source.handle.queryPermission !== "function") {
        return "granted";
    }
    try {
        return await source.handle.queryPermission({mode: "read"});
    } catch(e) {
        return "denied";
    }
}

/*  Folders whose handle survived but whose permission did not.
 *
 *  A directory handle persists; the permission attached to it does not,
 *  and no API asks for that to change — Chrome decides, and on Android
 *  it decides "ask again next launch". So the app cannot remove the
 *  step; it can only stop making the user go looking for it. */
function pending_authorisation()
{
    return S.sources
        .filter((s) => s.kind === "dir" && rt(s.id).permission !== "granted")
        .map((s) => ({id: s.id, name: s.name}));
}

/*  One gesture, every pending folder. The browser may refuse the second
 *  and later prompts of a single gesture; whatever stays pending simply
 *  stays on the banner for another tap, which is still better than one
 *  trip to Sources per folder. */
async function authorize_all()
{
    let n = 0;
    for(const p of pending_authorisation()) {
        if(await authorize(p.id)) {
            n++;
        }
    }
    return n;
}

/*  Must be called from a user gesture, or the browser refuses. */
async function authorize(id)
{
    let source = find(id);
    if(!source) {
        return false;
    }
    if(source.kind !== "dir" || typeof source.handle.requestPermission !== "function") {
        return true;
    }
    let state;
    try {
        state = await source.handle.requestPermission({mode: "read"});
    } catch(e) {
        state = "denied";
    }
    rt(id).permission = state;
    emit();
    /*  The deck was restored before this permission existed, so the track
        it is sitting on could not be read and the player was left empty.
        Now it can be read: load it, and the position it was left at comes
        back with it. */
    if(state === "granted") {
        reload_current();
    }
    /*  No rescan here. The library was restored from store at start up;
        granting the permission only makes the files reachable again, and
        walking eight thousand entries to learn what we already know is
        exactly the wait this design removes. Rescan stays available for
        when the folder itself has changed. */
    return state === "granted";
}


/***************************************************************
 *      Loading what was remembered
 ***************************************************************/
async function load_sources()
{
    S.persistent = await idb_available();
    S.blocked = idb_blocked();
    /*  Storage the app could not reach can come back on its own — the
        other tab is closed and the upgrade goes through. Say so on the
        screen instead of leaving a warning up about a problem that is
        over. */
    on_storage_change(async function() {
        S.persistent = await idb_available();
        S.blocked = idb_blocked();
        emit();
    });
    S.durable = await storage_persisted();
    let rows = await idb_all(STORE_SOURCES);
    S.sources = (rows || []).sort((a, b) => (a.added || 0) - (b.added || 0));
    for(const s of S.sources) {
        rt(s.id).permission = await query_permission(s);
        if(s.kind === "files" && !s.files) {
            let chunks = await idb_get_prefix(STORE_FILES, s.id + ":");
            s.files = [];
            for(const c of chunks) {
                for(const it of (c.items || [])) {
                    s.files.push(with_path(it.file, it.path));
                }
            }
        }
    }
    S.loaded = true;
    emit();

    /*  RESTORE, do not scan.
     *
     *  The library is metadata and the metadata is stored, so starting up
     *  costs a read of what we already knew — no folder walk, no file
     *  reads, no progress bar. A folder is walked only when it is ADDED
     *  or when Rescan is pressed; that is the only time the tree can have
     *  changed in a way we care about.
     *
     *  A track therefore starts life without a File. It gets one at play
     *  time, resolved from the source (below), which is also the only
     *  moment the permission actually has to be there. */
    for(const s of S.sources) {
        let row = await idb_get(STORE_TAGS, s.id);
        if(row && row.tags && row.tags.length) {
            let by_path = null;
            if(s.kind === "files" && s.files) {
                by_path = new Map(s.files.map((f) => [f.webkitRelativePath || f.name, f]));
            }
            restore_tracks(s.id, row.tags, by_path ? ((p) => by_path.get(p)) : null);
        } else if(rt(s.id).permission === "granted") {
            /*  Nothing stored for it — added before this was kept, or a
                scan that never finished. Read it once, now. */
            await scan(s.id);
        }
    }
    emit();

    /*  The line that ties a restart to what the user actually SAW.
     *
     *  "The app asked for my folders again" and "the app restarted" are
     *  the same sentence said from two sides, and only one of them is
     *  visible from inside. Written here, the journal reads: boot, then
     *  three folders pending — which is the prompt, dated. */
    diag("sources", {
        total: S.sources.length,
        /*  Which KIND they are, because the two behave nothing alike on
            a launch: a "dir" is a handle whose permission has to be
            granted again, a "files" set is thousands of File snapshots
            read back out of IndexedDB. Only one of them can produce the
            prompt the user reported, and the log should not leave that
            to be guessed. */
        dirs: S.sources.filter((x) => x.kind === "dir").length,
        filesets: S.sources.filter((x) => x.kind === "files").length,
        pending: pending_authorisation().length,
        idb: !!S.persistent,
        durable: S.durable === null ? "unknown" : S.durable
    });

    return S.sources.length;
}


/***************************************************************
 *      Getting the actual File for a track, on demand
 *
 *  A snapshot source is holding its files already. A folder
 *  source walks its handle down the stored path — a handful of
 *  lookups, done once per track and only when it is played.
 ***************************************************************/
/*  `track` is anything with a source_id and a path: a video, or a
    subtitle file beside one. */
async function resolve_track_file(track)
{
    let source = find(track.source_id);
    if(!source) {
        return null;
    }

    if(source.kind === "files") {
        if(!source.by_path && source.files) {
            source.by_path = new Map(
                source.files.map((f) => [f.webkitRelativePath || f.name, f]));
        }
        return (source.by_path && source.by_path.get(track.path)) || null;
    }

    if(!source.handle) {
        return null;
    }
    /*  The stored path starts with the chosen folder's own name, which
        IS the handle, so it is not walked. */
    let segs = String(track.path || "").split("/").filter(Boolean);
    if(segs.length && segs[0] === source.handle.name) {
        segs = segs.slice(1);
    }
    if(!segs.length) {
        return null;
    }
    let dir = source.handle;
    for(let i = 0; i < segs.length - 1; i++) {
        dir = await dir.getDirectoryHandle(segs[i]);
    }
    let fh = await dir.getFileHandle(segs[segs.length - 1]);
    return await fh.getFile();
}

set_file_resolver(resolve_track_file);


/***************************************************************
 *      Adding sources
 ***************************************************************/
async function persist(source)
{
    /*  Store the reference, never the runtime state. The File objects go
        in their own chunked records; keeping them here made this one
        write too big to succeed. */
    let ok = await idb_put(STORE_SOURCES, {
        id:     source.id,
        name:   source.name,
        kind:   source.kind,
        handle: source.handle || null,
        files:  null,
        added:  source.added,
        count:  source.count || 0,
        seen:   source.seen || 0,
        walk:   source.walk || null,
    });

    if(ok && source.kind === "files" && source.files) {
        await idb_del_prefix(STORE_FILES, source.id + ":");
        for(let i = 0; i < source.files.length; i += FILES_PER_CHUNK) {
            let n = String(Math.floor(i / FILES_PER_CHUNK)).padStart(6, "0");
            /*  The path is carried BESIDE the File. `webkitRelativePath`
                is not part of what structured clone keeps, so a restored
                File knows only its bare name — and the tag cache, which
                is keyed by path, would miss on every single file and
                read the whole library again. */
            let wrote = await idb_put(STORE_FILES, {
                id: source.id + ":" + n,
                items: source.files.slice(i, i + FILES_PER_CHUNK).map((f) => ({
                    path: f.webkitRelativePath || f.name,
                    file: f,
                })),
            });
            if(!wrote) {
                ok = false;
                break;
            }
        }
    }
    /*  A write that did not land must not pass for one that did: the
        user would only find out on the next restart, when the folder is
        not there any more.

        Recorded PER SOURCE. A single global flag was cleared by the next
        unrelated successful write, so the Sources screen and the
        diagnostics could disagree about the very same failure — which
        is exactly what happened when Firefox refused a folder of 8847
        files and then a small preference write reset the flag. */
    if(ok) {
        S.write_failed.delete(source.id);
    } else {
        S.write_failed.add(source.id);
        /*  Ask again WHY it failed. A blocked upgrade is not a browser
            that stores nothing, and the other tab may have been closed
            since — in which case the database is working again and the
            screen should stop saying otherwise. */
        S.persistent = await idb_available();
        S.blocked = idb_blocked();
        console.error("yunovídeo: could not store the source", source.name);
    }
    return ok;
}

function write_failed()
{
    return S.write_failed.size > 0;
}

/*  Storage is unreachable only because another tab is holding the
    database at an older schema. Worth telling apart: the user can fix
    this one in two seconds. */
function is_blocked()
{
    return S.blocked;
}

/*  Adding a source is the moment to ask the browser to keep what we
    store. Chromium decides silently; Firefox asks the USER — and there
    is the trap: navigator.storage.persist() in Firefox returns a promise
    that does not settle until somebody answers the doorhanger, and a
    doorhanger nobody notices is never answered. Awaiting it outright
    meant the folder was never read at all: no walk, no tags, no tracks,
    a scan bar up for ever. On Chromium the same await costs a
    millisecond, which is why it went unseen.

    So the request is still made — durable storage is worth having, it is
    what stops the browser evicting the folders when it wants room — but
    it is only waited on for as long as an engine that answers by itself
    would take. Nobody's music waits on a prompt they have not seen. The
    real answer, whenever it arrives, updates the state on its own. */
const DURABLE_WAIT = 2000;

function make_durable()
{
    if(S.durable) {
        return Promise.resolve(true);
    }
    let asked = request_persistence().then(function(ok) {
        S.durable = ok;
        emit();
        return ok;
    });
    return Promise.race([
        asked,
        new Promise((resolve) => setTimeout(() => resolve(S.durable), DURABLE_WAIT)),
    ]);
}

function is_durable()
{
    return S.durable;
}


/***************************************************************
 *      Diagnostics
 *
 *  What the browser actually does with file access varies by
 *  engine, by platform and by whether the app is installed, and
 *  none of it is visible from the outside. Rather than guess
 *  from a description of the symptom, ask the environment and
 *  show the answers.
 *
 *  The decisive line is `readable`: it takes one real byte out
 *  of a stored file. A source that is listed but whose files
 *  can no longer be opened looks exactly like a permission
 *  problem, and is not one.
 ***************************************************************/
async function diagnose()
{
    let lines = [];
    const add = (k, v) => lines.push({k: k, v: String(v)});

    add("version", __APP_VERSION__ + "  built " + __BUILD_STAMP__ +
        (update_stale() ? "   *** OUTDATED, deployed: " + update_latest() + " ***" : ""));

    let mode = "browser";
    if(typeof matchMedia === "function") {
        for(const m of ["standalone", "fullscreen", "minimal-ui", "window-controls-overlay"]) {
            if(matchMedia(`(display-mode: ${m})`).matches) {
                mode = m;
                break;
            }
        }
    }
    add("display-mode", mode);
    add("showDirectoryPicker", fsa_supported() ? "yes" : "NO");
    add("indexedDB", S.persistent ? "yes" : (S.blocked ? "NO (blocked by another tab)" : "NO"));
    add("storage.persisted", S.durable === null ? "unknown" : S.durable);
    add("last write", S.write_failed.size
        ? ("FAILED for " + S.write_failed.size + " source(s)") : "ok");
    if(typeof navigator !== "undefined" && navigator.storage && navigator.storage.estimate) {
        try {
            let e = await navigator.storage.estimate();
            add("storage used", Math.round((e.usage || 0) / 1048576) + " MiB / " +
                Math.round((e.quota || 0) / 1048576) + " MiB");
        } catch(err) {
            /*  Not every engine answers; the line is simply omitted. */
        }
    }
    /*  The pictures: how many are held and how heavy, and how many
        files this browser refused to decode. */
    let th = thumbs_held();
    add("thumbnails", th.count + " (" + th.kb + " KiB), cannot play=" + th.bad +
        ", made now=" + th.made + ", waiting=" + th.waiting);
    if(typeof getComputedStyle === "function") {
        add("accent", getComputedStyle(document.documentElement)
            .getPropertyValue("--vid-accent").trim() || "(palette default)");
    }

    add("userAgent", (typeof navigator !== "undefined" ? navigator.userAgent : "?").slice(0, 90));

    for(const s of S.sources) {
        let r = rt(s.id);
        let perm = await query_permission(s);
        let n = (s.files && s.files.length) || 0;
        add(`source "${s.name}"`,
            `kind=${s.kind} permission=${perm} walked=${s.seen || "?"} ` +
            `videos=${s.count || 0} stored=${n}` +
            (r.error ? ` error=${r.error}` : ""));

        /*  For a folder walk: what the tree contained versus what came
            back. A gap here means files the browser would not hand over,
            not files we chose to ignore. */
        if(s.walk) {
            let w = s.walk;
            let errs = Object.keys(w.errors || {})
                .map((k) => k + "×" + w.errors[k]).join(" ");
            add("   walk", `entries=${w.entries} subdirs=${w.dirs} ` +
                `unreadable=${w.skipped} bad-dirs=${w.dir_errors}` +
                (errs ? "  " + errs : ""));
        }

        /*  Of the files that were NOT taken, what were they? A handful of
            extensions explains a count gap far better than the gap does. */
        if(s.kind === "files" && s.files && s.files.length) {
            let rejected = new Map();
            for(const f of s.files) {
                if(is_video(f) || is_subtitle(f)) {
                    continue;
                }
                let ext = (f.name.match(/\.[^.]{1,5}$/) || ["(none)"])[0].toLowerCase();
                rejected.set(ext, (rejected.get(ext) || 0) + 1);
            }
            let top = [...rejected.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
            add("   not video", top.length
                ? top.map(([e, n2]) => e + "×" + n2).join(" ")
                : "none");
        }

        /*  The real question: can a stored reference still be READ? */
        let probe = "n/a";
        try {
            let f = null;
            if(s.kind === "dir") {
                if(perm === "granted") {
                    for await (const entry of s.handle.values()) {
                        if(entry.kind === "file") {
                            f = await entry.getFile();
                            break;
                        }
                    }
                } else {
                    probe = "not authorised";
                }
            } else if(s.files && s.files.length) {
                f = s.files[0];
            }
            if(f) {
                await f.slice(0, 1).arrayBuffer();
                probe = "YES";
            }
        } catch(err) {
            probe = "NO (" + ((err && err.name) || err) + ")";
        }
        add("   readable", probe);
    }
    return lines;
}

/***************************************************************
 *      Nothing is added twice
 *
 *  Picking the same folder again is the easiest mistake in the
 *  whole app to make: the picker reopens where it was left, the
 *  folder is under the cursor, and nothing on the screen says it
 *  is already in. What came of it was every track twice — twice
 *  in the library, twice in its album, twice in the folder tree,
 *  and twice in any list saved from them. By then there is
 *  nothing left to tell the copies apart, so the answer has to
 *  be given BEFORE the source exists.
 *
 *  It is decided on what the browser can actually prove, and the
 *  two kinds of source can prove different things:
 *
 *    - a FOLDER handle knows whether it is the same entry as
 *      another (isSameEntry) and whether it lies inside it
 *      (resolve). Exact, and it survives a restart.
 *
 *    - a FILE snapshot has no path above the folder that was
 *      picked, so "Bach" chosen on its own and "Bach" reached
 *      through "music" do not compare. The files themselves do:
 *      name, size and modification time. So the pick is trimmed
 *      to what is genuinely new instead of being refused.
 ***************************************************************/

/*  Not the path: the same file reached through two different
    picks carries two different paths and is still one file. */
function fingerprint(f)
{
    return (f.name || "") + "|" + f.size + "|" + f.lastModified;
}

/*  fingerprint -> the id of the source that already holds it. */
function files_index()
{
    let idx = new Map();
    for(const s of S.sources) {
        if(s.kind !== "files" || !s.files) {
            continue;
        }
        for(const f of s.files) {
            let k = fingerprint(f);
            if(!idx.has(k)) {
                idx.set(k, s.id);
            }
        }
    }
    return idx;
}

/*  `resolve` reads downwards: a.resolve(b) is the path from a
    down to b, or null when b is not below a. It returns the
    empty array for the same entry — which is truthy — so
    isSameEntry has to be asked first. */
async function is_inside(parent, child)
{
    if(!parent || !child || typeof parent.resolve !== "function") {
        return false;
    }
    try {
        return !!(await parent.resolve(child));
    } catch(e) {
        return false;               // an engine without it: no opinion
    }
}

async function same_entry(a, b)
{
    if(!a || !b || typeof a.isSameEntry !== "function") {
        return false;
    }
    try {
        return !!(await a.isSameEntry(b));
    } catch(e) {
        return false;
    }
}

/*  What this folder collides with, or null. */
async function dir_clash(handle)
{
    for(const s of S.sources) {
        if(s.kind !== "dir" || !s.handle) {
            continue;
        }
        if(await same_entry(s.handle, handle)) {
            return {how: "same", sources: [s]};
        }
        if(await is_inside(s.handle, handle)) {
            return {how: "inside", sources: [s]};
        }
    }

    /*  The other way round: the folder just picked holds folders
        that are already sources. Adding it over them would double
        their tracks, and dropping them costs their play counts —
        so that one is asked, not decided here. */
    let contained = [];
    for(const s of S.sources) {
        if(s.kind === "dir" && s.handle && await is_inside(handle, s.handle)) {
            contained.push(s);
        }
    }
    if(contained.length) {
        return {how: "contains", sources: contained};
    }
    return null;
}

function names_of(sources)
{
    return sources.map((s) => s.name).join(", ");
}

/*  What the last pick ran into, for the screen to say in words.
    `kind` is the i18n key; `pending` is true while a folder is
    waiting on an answer. */
function source_notice()
{
    return S.notice;
}

function dismiss_notice()
{
    if(!S.notice && !S.pending) {
        return;
    }
    S.notice = null;
    S.pending = null;
    emit();
}

/*  The user said yes to replacing the folders the new one holds. */
async function accept_notice()
{
    let p = S.pending;
    S.notice = null;
    S.pending = null;
    if(!p) {
        emit();
        return "";
    }
    for(const id of p.replace) {
        await remove_source(id);
    }
    return await add_dir_handle(p.handle);
}


/*  A whole folder, recursively. Returns the new source id, or "". */
async function add_dir()
{
    if(!fsa_supported()) {
        return add_dir_via_input();
    }
    let handle;
    try {
        handle = await window.showDirectoryPicker({id: "videos", mode: "read", startIn: "videos"});
    } catch(e) {
        return "";                  // the user closed the picker
    }
    return await add_dir_handle(handle);
}

async function add_dir_handle(handle)
{
    S.notice = null;
    S.pending = null;

    let clash = await dir_clash(handle);
    if(clash && clash.how !== "contains") {
        S.notice = {
            kind: clash.how === "same" ? "folder already added" : "folder inside another",
            name: handle.name || "—",
            other: names_of(clash.sources),
            pending: false,
        };
        emit();
        return "";
    }
    if(clash) {
        S.notice = {
            kind: "folder contains others",
            name: handle.name || "—",
            other: names_of(clash.sources),
            pending: true,
        };
        S.pending = {handle: handle, replace: clash.sources.map((s) => s.id)};
        emit();
        return "";
    }

    let source = {
        id: new_id(),
        name: handle.name || "—",
        kind: "dir",
        handle: handle,
        added: Date.now(),
        count: 0,
    };
    S.sources.push(source);
    rt(source.id).permission = "granted";
    await make_durable();
    await persist(source);
    emit();
    await scan(source.id);
    return source.id;
}

/*  Fallback folder picker for engines without the File System Access
    API: a <input webkitdirectory>. What comes back is a flat File list
    of the whole tree, which becomes a "files" snapshot. */
function add_dir_via_input()
{
    return pick_with_input(true);
}

function add_files()
{
    return pick_with_input(false);
}

let $inputs = null;

function ensure_inputs()
{
    if($inputs) {
        return $inputs;
    }
    const mk = (dir) => {
        let el = document.createElement("input");
        el.type = "file";
        el.multiple = true;
        el.hidden = true;
        if(dir) {
            el.setAttribute("webkitdirectory", "");
            el.setAttribute("directory", "");
        } else {
            el.accept = "video/*,.mp4,.m4v,.webm,.mkv,.mov,.ogv,.avi,.srt,.vtt";
        }
        document.body.appendChild(el);
        return el;
    };
    $inputs = {dir: mk(true), files: mk(false)};
    return $inputs;
}

function pick_with_input(as_dir)
{
    let inputs = ensure_inputs();
    let el = as_dir ? inputs.dir : inputs.files;

    return new Promise(function(resolve) {
        /*  Between the user closing the picker and `change` firing, the
            BROWSER is enumerating the folder and building the FileList.
            For a phone's whole Music folder that is a long, silent gap
            in which our code has not run yet — the app looked dead
            through all of it.
            There is no event for "the dialog closed", but the page gets
            its focus back when it does. So: focus returns and no files
            have arrived => the browser is still handing them over. Say
            so. */
        /*  Armed from the click, not from the focus event. Firefox does
            not always take focus away for the dialog, so waiting for it
            back meant the message never appeared — and that gap is
            precisely where the app looked dead. While the picker is
            still open the bar is behind it anyway. */
        let armed = setTimeout(function() {
            if(S.preparing !== true) {
                S.preparing = true;
                emit();
            }
        }, 400);
        const on_focus = function() {};
        const cancelled = function() {
            cleanup();
            resolve("");
        };
        const cleanup = function() {
            clearTimeout(armed);
            window.removeEventListener("focus", on_focus);
            if(S.preparing) {
                S.preparing = false;
                emit();
            }
            el.removeEventListener("change", done);
            el.removeEventListener("cancel", cancelled);
        };
        const done = async function() {
            cleanup();
            let picked = [...el.files];
            el.value = "";                          // let the same pick fire again
            /*  A snapshot keeps the Files it was handed, and a phone's
                folder is mostly photos. Only what this app reads is
                kept: the videos, and the subtitles beside them. */
            let files = picked.filter((f) => is_video(f) || is_subtitle(f));
            if(picked.length && !files.length) {
                S.notice = {kind: "no videos here", name: as_dir ? top_folder_of(picked) : "",
                            other: "", pending: false};
                emit();
                resolve("");
                return;
            }
            if(!files.length) {
                resolve("");
                return;
            }

            /*  Whatever another source already holds is dropped here
                and now. A snapshot has no folder above the one that
                was picked to compare, so the files are compared: the
                same folder picked twice, or picked after one of its
                albums, otherwise arrives as a second copy of every
                track. What is genuinely new is still added — refusing
                the whole pick would make the parent folder of an album
                already in impossible to add. */
            let all = files.length;
            let idx = files_index();
            let owners = new Set();
            let kept = [];
            for(const f of files) {
                let owner = idx.get(fingerprint(f));
                if(owner) {
                    owners.add(owner);
                } else {
                    kept.push(f);
                }
            }
            let others = names_of(
                Array.from(owners).map(find).filter(Boolean));
            if(!kept.length) {
                S.notice = {
                    kind: as_dir ? "folder already added" : "files already added",
                    name: as_dir ? top_folder_of(files) : label_for_files(files),
                    other: others,
                    pending: false,
                };
                emit();
                resolve("");
                return;
            }
            S.notice = (kept.length < all)
                ? {kind: "some were already in", name: "",
                   other: others, skipped: all - kept.length, pending: false}
                : null;
            files = kept;

            let name = as_dir ? top_folder_of(files) : label_for_files(files);
            let source = {
                id: new_id(),
                name: name,
                kind: "files",
                files: files,
                added: Date.now(),
                count: 0,
                seen: picked.length,
            };
            S.sources.push(source);
            rt(source.id).permission = "granted";
            await make_durable();
            emit();
            /*  No persist() before the scan: a "files" source carries
                every File it was given, and writing thousands of them to
                IndexedDB twice for one pick is a stall the user sees.
                scan() persists once, at the end, with the count filled
                in. */
            await scan(source.id);
            resolve(source.id);
        };
        el.addEventListener("change", done);
        /*  Not every engine fires `cancel`; where it does not, the promise
            simply never settles and nothing happens — which is what
            closing the dialog should look like anyway. */
        el.addEventListener("cancel", cancelled);
        el.click();
    });
}

function top_folder_of(files)
{
    let rel = files[0].webkitRelativePath || "";
    let head = rel.split("/")[0];
    return head || files[0].name;
}

/*  Loose files have no folder to be named after. Naming the source after
    the first file (and how many more came with it) at least says what is
    in it; a bare count would just repeat what the row already shows. */
function label_for_files(files)
{
    if(files.length === 1) {
        return files[0].name;
    }
    return files[0].name + " +" + (files.length - 1);
}


/***************************************************************
 *      Scanning — always recursive
 ***************************************************************/
function note_error(stats, e)
{
    let name = (e && e.name) || String(e);
    stats.errors[name] = (stats.errors[name] || 0) + 1;
}

/*  `stats` records what the walk met and what it could not take. Files
    that fail getFile() used to be dropped in silence, which is exactly
    how a folder can hand back fewer files in one browser than in another
    with nothing to show for it. Now the count and the reasons are kept
    and reported in the diagnostics. */
async function walk_dir(handle, path, out, stats)
{
    let it;
    try {
        it = handle.values();
    } catch(e) {
        stats.dir_errors++;
        return;
    }
    for(;;) {
        let step;
        try {
            step = await it.next();
        } catch(e) {
            /*  One unreadable directory must not cost us the rest of the
                tree, which is what letting this throw used to do. */
            stats.dir_errors++;
            note_error(stats, e);
            return;
        }
        if(step.done) {
            return;
        }
        const entry = step.value;
        stats.entries++;

        if(entry.kind === "file") {
            let f;
            try {
                f = await entry.getFile();
            } catch(e) {
                stats.skipped++;
                note_error(stats, e);
                continue;               // vanished between listing and reading
            }
            try {
                Object.defineProperty(f, "webkitRelativePath", {value: path + f.name});
            } catch(e) {
                /*  Some engines freeze File; video_store falls back to
                    the plain name for its path guess. */
            }
            out.push(f);
        } else {
            /*  Recursive on purpose: choosing a folder means that folder
                and everything below it. */
            stats.dirs++;
            await walk_dir(entry, path + entry.name + "/", out, stats);
        }
    }
}

/*  ONE READ AT A TIME.
 *
 *  The buttons stay live while a folder is being read — queueing a
 *  second one is a reasonable thing to do, and a picker that goes dead
 *  for two minutes is worse than the wait. What could not be shared was
 *  the READING: there is one progress counter, one elapsed clock and
 *  one Stop, and two reads fighting over them made the counter jump
 *  (98, then 0, then 175) and reach "300 / 300" while the other folder
 *  was still half way through. A bar that fills up and stays up is
 *  exactly how a working app gets read as a stuck one.
 *
 *  So a scan asked for while another is running waits its turn, and the
 *  source waiting says so on its row rather than sitting at 0 tracks
 *  with nothing to explain it. */
let scan_queue = Promise.resolve();

function scan(id, force)
{
    let r = rt(id);
    r.queued = true;
    emit();
    const run_it = () => scan_now(id, force);
    let next = scan_queue.then(run_it, run_it);
    /*  The chain must survive a scan that threw, or every folder picked
        after it would be dropped on the floor. */
    scan_queue = next.catch(() => 0);
    return next;
}

async function scan_now(id, force)
{
    let source = find(id);
    if(!source) {
        /*  Removed while it was waiting its turn. Nothing to read, and
            nothing to remember about it either. */
        S.runtime.delete(id);
        emit();
        return 0;
    }
    let r = rt(id);
    r.queued = false;
    r.scanning = true;
    r.error = "";
    /*  The bar is about to carry THIS folder's name; it must not carry
        the last one's numbers with it. The walk below produces none of
        its own until the first file is read. */
    begin_read(id);
    emit();

    let files = [];
    let stats = {entries: 0, dirs: 0, skipped: 0, dir_errors: 0, errors: {}};
    try {
        if(source.kind === "dir") {
            await walk_dir(source.handle, source.handle.name + "/", files, stats);
            source.walk = stats;
        } else {
            files = source.files || [];
        }
    } catch(e) {
        r.error = (e && e.name === "NotAllowedError") ? "permission denied" : "could not be read";
        r.scanning = false;
        /*  Store it even though the read failed. The source is real —
            the user chose it — and a folder that vanishes on restart
            because one read went wrong is worse than a folder that
            comes back saying it could not be read. */
        await persist(source);
        emit();
        return 0;
    }

    /*  How many files the walk actually handed over, audio or not, and
        BEFORE anything below drops any of them. Two browsers reporting
        different track counts for the same folder is either a different
        WALK or a different idea of what counts as audio, and only this
        number tells them apart. */
    if(source.kind === "dir") {
        source.seen = files.length;
    }

    /*  A folder can also overlap a SNAPSHOT — loose files picked out of
        it earlier, which every browser offers and Chromium offers
        alongside the folder picker. Ancestry cannot see that: a
        snapshot has no folder to be inside of. So what the walk brought
        back is checked against what the snapshots hold, file by file,
        the same way a pick is. Only here: the tree has to be walked
        before there is anything to compare, so this cannot be answered
        at the picker like the folder cases are. */
    if(source.kind === "dir") {
        let idx = files_index();
        if(idx.size) {
            let owners = new Set();
            let kept = [];
            for(const f of files) {
                let owner = idx.get(fingerprint(f));
                if(owner) {
                    owners.add(owner);
                } else {
                    kept.push(f);
                }
            }
            if(kept.length < files.length) {
                S.notice = {
                    kind: "some were already in",
                    name: source.name,
                    other: names_of(Array.from(owners).map(find).filter(Boolean)),
                    skipped: files.length - kept.length,
                    pending: false,
                };
                files = kept;
            }
        }
    }

    source.by_path = null;      // rebuilt on demand from the new file list

    /*  A rescan replaces this source's tracks; it never doubles them. */
    drop_source_tracks(id);

    /*  A rescan asks again about the files this browser refused: it may
        have been updated since. The pictures already made stay. */
    if(force) {
        forget_bad(id);
    }
    let res = await ingest(files, id);

    /*  The source can be removed WHILE it is being read. Everything the
        read added since then belongs to a source that no longer exists,
        so throw it away: otherwise the library quietly repopulates
        itself after the user emptied it, with tracks that can never be
        removed because there is no source left to remove. */
    if(!find(id)) {
        drop_source_tracks(id);
        S.runtime.delete(id);
        emit();
        return 0;
    }

    source.count = (res && res.count) || 0;
    r.scanning = false;
    S.stopping = false;
    if(res && res.cancelled) {
        /*  Stopped on purpose: what was read stays, and the source says
            it is only part of the folder rather than pretending it is
            all of it. */
        r.error = "stopped";
    } else if(!source.count) {
        r.error = "no videos here";
    }

    /*  Tell the interface the read is over BEFORE writing to IndexedDB.
        A "files" source carries every File it was handed, and storing
        thousands of them takes real time — time during which the scan
        bar used to stay up with the Stop button still on it. Pressing
        Stop then looked like it did nothing, when in fact the reading
        had already stopped and the app was busy saving. */
    emit();
    await persist(source);

    /*  A folder just added with nothing on the deck: cue it. Adding
        music and landing on an empty player that points back at Sources
        is a loop, and there is nothing to interrupt when the queue is
        empty. It is CUED, not started — play stays explicit. */
    if(source.count && !queue_length()) {
        queue_add(videos_of_source(id), "append");
    }

    /*  Keep what this scan learned, so the next start does not have to
        learn it again. */
    if(!res || !res.cancelled) {
        await idb_put(STORE_TAGS, {source_id: id, tags: tags_of_source(id)});
    }

    emit();
    return source.count;
}

async function remove_source(id)
{
    let i = S.sources.findIndex((s) => s.id === id);
    if(i < 0) {
        return;
    }
    S.sources.splice(i, 1);

    /*  A notice names sources by name. Once one of them is gone the
        sentence is about something that is no longer there. */
    S.notice = null;
    S.pending = null;

    /*  Stop its read first. Removing a source while it is being read used
        to leave the read running: it went on adding tracks to the library
        for a folder the user had just deleted. scan() does the final
        clean-up when it notices the source is gone. */
    let r = S.runtime.get(id);
    if(r && r.scanning) {
        cancel_ingest(id);
    } else {
        /*  Not reading — either never started or still waiting its
            turn. scan_now() finds it gone and steps over it. */
        S.runtime.delete(id);
    }

    drop_source_tracks(id);
    /*  The counts go with the folder. Left behind they would be
        orphans: nothing on screen could show them and nothing could
        clear them, which is the one thing the counts must never be. */
    drop_source_stats(id);
    drop_source_thumbs(id);
    await idb_del(STORE_SOURCES, id);
    await idb_del(STORE_TAGS, id);
    await idb_del_prefix(STORE_FILES, id + ":");
    emit();
}

function source_name(id)
{
    let s = find(id);
    return s ? s.name : "";
}

/*  The source being read right now, if any. Scans are awaited one at a
    time, so there is at most one. The host paints a bar from this so a
    long read is visible from EVERY screen, not only from Sources. */
function scanning_source()
{
    for(const s of S.sources) {
        if(rt(s.id).scanning) {
            return {id: s.id, name: s.name};
        }
    }
    return null;
}


export {
    subscribe_sources,
    fsa_supported,
    is_persistent,
    is_durable,
    write_failed,
    is_blocked,
    diagnose,
    is_preparing,
    stop_scan,
    is_stopping,
    load_sources,
    all_sources,
    source_name,
    scanning_source,
    add_dir,
    add_files,
    source_notice,
    dismiss_notice,
    accept_notice,
    authorize,
    authorize_all,
    pending_authorisation,
    scan,
    remove_source,
};
