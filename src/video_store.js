/***********************************************************************
 *          video_store.js
 *
 *      The domain of yunovídeo: the library, the deck, the temporary
 *      list and THE video element.
 *
 *      1. The library is metadata. A folder is walked when it is added
 *         or rescanned, and what the walk learned (a name, a series
 *         pattern, the subtitles beside each video) is stored; a launch
 *         rebuilds the library from that without opening a single file.
 *         A video carries a PATH; its File is fetched when it is about
 *         to be played, which is the only moment the permission really
 *         has to be there.
 *
 *      2. Two lists, as in yunomúsica. The DECK is the official one:
 *         curated, saved, persistent. What the library shows — a
 *         season, a folder, everything — is the other kind: temporary,
 *         as long as the screen it came from. Pressing play on a row
 *         starts the temporary one; the deck pauses where it was and
 *         nothing of it is lost or asked about.
 *
 *      3. ONE <video> element for the whole app. A second one would be
 *         a second decoder and a second buffer of a film, on a phone.
 *         It is never thrown away; it MOVES — into the deck's stage on
 *         the player screen, into the mini-player everywhere else —
 *         and a moved media element goes on playing: the spec pauses
 *         one that leaves the document, and an appendChild elsewhere
 *         never leaves it.
 *
 *      4. Every video remembers where it was left. Not here: the place
 *         is stats_store's (it is a number about the video, like its
 *         counts), and this store asks for it through a hook when it
 *         loads one. A film is two hours long; coming back to it at
 *         0:00 is the one thing a video player must not do.
 *
 *      Pub/sub channels:
 *          "library"   the set of videos changed (or a notice)
 *          "loading"   a folder read made progress
 *          "queue"     the deck changed
 *          "playing"   play / pause / load
 *          "time"      the clock moved (while playing, four a second)
 *          "temp"      the temporary list started, moved, or ended
 *          "said"      what the last add to the deck did
 *          "subs"      the subtitles of the loaded video changed
 *
 *      And what the ELEMENT says, which the app's root turns into an
 *      event and answers by calling back here (on_metadata, on_canplay,
 *      on_ended, on_media_error): the browser is the operating system,
 *      and what it notifies enters the machine before anything is done
 *      about it.
 *          "metadata"  the loaded video's length and size are known
 *          "canplay"   it can be played
 *          "ended"     it played to its end
 *          "error"     the element could not read or decode it
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {log_warning} from "@yuneta/gobj-js";

import {pref_get, pref_set} from "./idb.js";
import {diag} from "./diag.js";
import {is_video, is_subtitle, parse_name, pair_subtitles, code} from "./names.js";
import {srt_to_vtt, decode_text} from "./subtitles.js";


/***************************************************************
 *      1. Pub/sub
 ***************************************************************/
const listeners = new Set();

function subscribe(fn)
{
    listeners.add(fn);
    return function unsubscribe() {
        listeners.delete(fn);
    };
}

function emit(channel)
{
    for(const fn of listeners) {
        try {
            fn(channel);
        } catch(e) {
            console.error("video_store listener failed", e);
        }
    }
}


/*  The keys a notice can carry: said in place by the deck, so they
    are handed to t() by variable and published here for the locale
    check. */
export const NOTICE_I18N_KEYS = [
    "no videos here",
    "that file could not be read",
    "this browser cannot play this video",
];


/***************************************************************
 *      2. State
 ***************************************************************/
const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
const collator = new Intl.Collator(undefined, {sensitivity: "base", numeric: true});

const S = {
    videos:  [],
    uid_seq: 1,

    /*  ingest progress */
    loading: false,
    loaded:  0,
    total:   0,
    load_name: "",
    load_started: 0,
    load_source: "",
    cancel:  false,
    seen:    0,
    notice:  "",        // i18n key of a message the views say in place

    /*  the element */
    el:      null,
    $park:   null,      // where it waits when no screen is showing it
    url:     null,
    loaded_uid: 0,      // uid of the video whose file is ON the element
    autoplay_intent: false,
    retry_for: 0,
    el_error: 0,        // MediaError code of the element's last "error"
    resolve_denied: false,
    ac:      null,
    rate:    1,

    /*  what the element is playing for */
    mode:    "deck",    // "deck" | "temp"

    /*  the deck */
    queue:   [],
    qi:      -1,
    origin:  null,      // {list_id, name} while it is a saved list
    edited:  false,
    places:  {},        // list_id -> {source_id, path}: where a list was left
    deck_ready: false,
    said:    null,

    /*  the temporary list */
    temp:    null,
    temp_list: [],
    temp_i:  -1,
    temp_resume: false,

    /*  where a loaded video was resumed, so the deck can offer to
        start it over */
    resumed: null,      // {uid, at}

    /*  subtitles of the loaded video */
    subs:    [],        // [{label, lang, url, $track}]
    subs_gen: 0,        // which read of the subtitles is the live one
    sub_on:  -1,
    sub_pref: null,     // "off" | a label | null (never chosen)
};


/***************************************************************
 *      3. Ingest
 ***************************************************************/
function has_library()
{
    return S.videos.length > 0;
}

function video_count()
{
    return S.videos.length;
}

function key_of(v)
{
    if(!v || !v.source_id || !v.path) {
        return "";
    }
    return v.source_id + "|" + v.path;
}

/*  A read is starting, with nothing to count yet: the tree is still
    being walked. The counters must not carry the last folder's
    numbers under this folder's name. */
function begin_read(source_id)
{
    S.loading = true;
    S.loaded  = 0;
    S.total   = 0;
    S.load_name = "";
    S.load_source = source_id || "";
    S.load_started = Date.now();
    emit("loading");
}

function make_video(source_id, path, meta, file)
{
    const v = {
        uid: S.uid_seq++,
        source_id: source_id || "",
        path: path,
        file: file || null,
        name: path.split("/").pop() || path,
        size: meta.size || 0,
        title: meta.title,
        show: meta.show || "",
        season: meta.season || 0,
        episode: meta.episode || 0,
        ep_title: meta.ep_title || "",
        year: meta.year || "",
        subs: meta.subs || [],
    };
    v.key = key_of(v);
    v.show_id = v.show ? norm(v.show) : "";
    return v;
}

/*  The guess, made from the path alone — and made again on every
    launch from the stored path, so a better guess in a later build
    reaches a library nobody rescanned. */
function meta_of(path, size, subs)
{
    const p = parse_name(path);
    return {
        title: p.title, show: p.show, season: p.season, episode: p.episode,
        ep_title: p.ep_title, year: p.year, size: size || 0, subs: subs || [],
    };
}

/*  Read `files` into the library. A video file is not opened here —
    there is nothing in it this needs — so the read is a loop over
    names, fast enough that the bar is mostly about the walk. The
    subtitles in the same pick are paired with their videos. */
async function ingest(files, source_id)
{
    const all = [...files];
    S.seen = all.length;
    const list = all.filter(is_video);
    if(!list.length) {
        S.notice = "no videos here";
        emit("library");
        return {ok: false, count: 0};
    }
    const path_of = (f) => f.webkitRelativePath || f.name;
    const subs = pair_subtitles(
        list.map(path_of),
        all.filter(is_subtitle).map(path_of)
    );

    S.notice = "";
    S.loading = true;
    S.loaded = 0;
    S.total = list.length;
    S.load_name = "";
    S.load_started = Date.now();
    S.load_source = source_id || "";
    S.cancel = false;
    emit("loading");

    let last_emit = 0;
    let added = 0;
    for(let i = 0; i < list.length; i++) {
        if(S.cancel) {
            break;
        }
        const f = list[i];
        const path = path_of(f);
        S.videos.push(make_video(source_id, path, meta_of(path, f.size, subs.get(path)), f));
        added++;
        S.loaded = i + 1;
        S.load_name = f.name;
        const now = Date.now();
        if(now - last_emit > 120 || i === list.length - 1) {
            last_emit = now;
            emit("loading");
            await new Promise((r) => setTimeout(r));
        }
    }

    const cancelled = S.cancel;
    S.loading = false;
    S.cancel = false;
    S.load_source = "";
    emit("loading");
    emit("library");
    return {ok: true, count: added, cancelled: cancelled};
}

function cancel_ingest(source_id)
{
    if(!S.loading) {
        return false;
    }
    if(source_id && S.load_source !== source_id) {
        return false;
    }
    S.cancel = true;
    return true;
}

/*  What a scan produced, in a shape that can be stored: the path, the
    size and the subtitles. The rest is a guess, made again on the way
    back in. */
function tags_of_source(source_id)
{
    const out = [];
    for(const v of S.videos) {
        if(v.source_id !== source_id) {
            continue;
        }
        out.push([v.path, {size: v.size, subs: v.subs}]);
    }
    return out;
}

/*  Put a source's videos back WITHOUT touching the disk. */
function restore_tracks(source_id, entries, file_of)
{
    for(const [path, stored] of (entries || [])) {
        const st = stored || {};
        S.videos.push(make_video(source_id, path,
            meta_of(path, st.size, st.subs), file_of ? (file_of(path) || null) : null));
    }
    emit("library");
    return (entries || []).length;
}


/***************************************************************
 *  How a video (or a subtitle) without a File in hand gets one.
 *  sources_store registers this: only it knows how to walk a
 *  directory handle or where a snapshot keeps its files.
 ***************************************************************/
let file_resolver = null;

function set_file_resolver(fn)
{
    file_resolver = fn;
}

async function resolve_path(source_id, path)
{
    if(!file_resolver) {
        return null;
    }
    try {
        return await file_resolver({source_id: source_id, path: path});
    } catch(e) {
        S.resolve_denied = !!e && e.name === "NotAllowedError";
        log_warning(`video_store: cannot reach ${path}: ${(e && e.name) || e}`);
        return null;
    }
}

async function resolve_file(v)
{
    if(v.file) {
        return v.file;
    }
    S.resolve_denied = false;
    v.file = await resolve_path(v.source_id, v.path);
    return v.file;
}

function drop_source_tracks(source_id)
{
    if(!source_id) {
        return;
    }
    /*  The deck is looked at even when the library had none of it: a
        source removed during a rescan has already left the library
        (unlist_source_tracks) but not the deck. */
    const before = S.videos.length;
    S.videos = S.videos.filter((v) => v.source_id !== source_id);
    const cur = S.queue[S.qi] || null;
    const kept = S.queue.filter((v) => v.source_id !== source_id);
    if(kept.length !== S.queue.length) {
        S.queue = kept;
        S.qi = cur ? kept.indexOf(cur) : -1;
        if(S.mode === "deck" && S.qi < 0) {
            stop_playback();
        }
        emit("queue");
    }
    if(S.temp && S.temp.source_id === source_id) {
        back_to_deck();
    }
    if(S.videos.length !== before) {
        emit("library");
    }
}

/***************************************************************
 *  A rescan: the source's videos leave the LIBRARY, and come back
 *  as new objects when the walk is read in. The deck, the
 *  temporary list and the element keep theirs meanwhile, and
 *  relink_source() puts them back on the new ones, by path — a
 *  rescan used to strip the deck of that source's videos, stop
 *  the one playing and, the deck left empty, refill it with the
 *  whole folder in walk order.
 ***************************************************************/
function unlist_source_tracks(source_id)
{
    if(!source_id) {
        return;
    }
    S.videos = S.videos.filter((v) => v.source_id !== source_id);
}

function relink_source(source_id)
{
    const fresh = (v) => (v && v.source_id === source_id) ? find_video(source_id, v.path) : v;
    const playing = sounding();
    const was_loaded = !!playing && S.loaded_uid === playing.uid;

    /*  What is on the element is carried over to its new object: the
        same file, already loaded, and the same place in it. */
    const now = fresh(playing);
    if(playing && now && now !== playing) {
        now.file = now.file || playing.file;
        if(was_loaded) {
            S.loaded_uid = now.uid;
        }
        if(S.resumed && S.resumed.uid === playing.uid) {
            S.resumed.uid = now.uid;
        }
        if(pending_resume && pending_resume.uid === playing.uid) {
            pending_resume.uid = now.uid;
        }
    }

    const cur = S.queue[S.qi] || null;
    const cur_now = fresh(cur);
    const queue = S.queue.map(fresh).filter(Boolean);
    if(queue.length !== S.queue.length || queue.some((v, i) => v !== S.queue[i])) {
        if(queue.length !== S.queue.length) {
            mark_edited();
        }
        S.queue = queue;
        if(cur_now) {
            S.qi = queue.indexOf(cur_now);
        } else if(cur) {
            /*  The video the deck was on is not in the folder any more. */
            S.qi = queue.length ? Math.min(S.qi, queue.length - 1) : -1;
            if(S.mode === "deck") {
                if(S.qi >= 0) {
                    load_current(false);
                } else {
                    stop_playback();
                }
            }
        }
        emit("queue");
    }

    if(S.mode === "temp") {
        S.temp_list = S.temp_list.map(fresh).filter(Boolean);
        const t_now = fresh(S.temp);
        if(!t_now) {
            back_to_deck();
        } else {
            S.temp = t_now;
            S.temp_i = S.temp_list.indexOf(t_now);
            emit("temp");
        }
    }
    emit("library");
}

function store_state()
{
    return {
        loading: S.loading, loaded: S.loaded, total: S.total,
        load_name: S.load_name, notice: S.notice,
    };
}

function clear_notice()
{
    if(S.notice) {
        S.notice = "";
        emit("library");
    }
}

function say_notice(key)
{
    S.notice = key;
    emit("library");
}


/***************************************************************
 *      4. Groupings and search
 ***************************************************************/
const by_episode = (a, b) =>
    (a.season - b.season) || (a.episode - b.episode) || collator.compare(a.path, b.path);

const by_title = (a, b) =>
    collator.compare(a.show || a.title, b.show || b.title) || by_episode(a, b);

/*  The spelling most of these videos carry. */
function most_common(videos, of)
{
    const n = new Map();
    let best = "";
    let best_n = 0;
    for(const v of videos) {
        const s = of(v);
        const c = (n.get(s) || 0) + 1;
        n.set(s, c);
        if(c > best_n) {
            best = s;
            best_n = c;
        }
    }
    return best;
}

/***************************************************************
 *  The series in the library: every video whose name says it is
 *  an episode, grouped on the NORMALISED show name (so "The
 *  Expanse" and "the expanse" are one show) and labelled with
 *  the spelling most of its episodes carry.
 *
 *  `id` is the normalised name, and it is what a drill-down
 *  holds — never the label.
 ***************************************************************/
function series()
{
    const m = new Map();
    for(const v of S.videos) {
        if(!v.show_id) {
            continue;
        }
        let g = m.get(v.show_id);
        if(!g) {
            g = {id: v.show_id, videos: []};
            m.set(v.show_id, g);
        }
        g.videos.push(v);
    }
    const out = [];
    for(const g of m.values()) {
        g.videos.sort(by_episode);
        g.name = most_common(g.videos, (v) => v.show);
        g.seasons = [...new Set(g.videos.map((v) => v.season))].sort((a, b) => a - b);
        out.push(g);
    }
    return out.sort((a, b) => collator.compare(a.name, b.name));
}

function series_by_id(id)
{
    return series().find((g) => g.id === id) || null;
}

/*  Everything that is not an episode: films, clips, recordings. */
function others()
{
    return S.videos.filter((v) => !v.show_id).sort(by_title);
}

function all_sorted()
{
    return [...S.videos].sort(by_title);
}

function search(query)
{
    const q = norm(query);
    if(!q) {
        return [];
    }
    return S.videos.filter((v) =>
        norm(v.title).includes(q) || norm(v.show).includes(q) ||
        norm(v.name).includes(q) || norm(v.path).includes(q)).sort(by_title);
}

/*  The directory a video lives in, from its PATH — what the file is
    fetched by, so it cannot be wrong without the video being
    unplayable. */
function dir_of(v)
{
    const p = v.path || "";
    const i = p.lastIndexOf("/");
    return i < 0 ? "" : p.slice(0, i);
}

/*  Where a walk of a source starts: its own head segment, so the
    first screen is not a single row named after the source. */
function source_root_path(source_id)
{
    let first = null;
    for(const v of S.videos) {
        if(v.source_id !== source_id) {
            continue;
        }
        const d = dir_of(v);
        const head = d ? d.split("/")[0] : "";
        if(first === null) {
            first = head;
        } else if(first !== head) {
            return "";
        }
    }
    return first || "";
}

/***************************************************************
 *  One level of one source's tree, as it is on the disk: the
 *  directories directly inside `path`, each with everything
 *  below it, and the videos that live in it. Scoped to ONE
 *  source: two sources can each hold a "videos" folder, and one
 *  merged row would be a folder nobody has.
 ***************************************************************/
function folder_level(source_id, path)
{
    const prefix = path ? path + "/" : "";
    const dirs = new Map();
    const here = [];
    for(const v of S.videos) {
        if(v.source_id !== source_id) {
            continue;
        }
        const f = dir_of(v);
        if(f === path) {
            here.push(v);
            continue;
        }
        if(path && !f.startsWith(prefix)) {
            continue;
        }
        const name = f.slice(prefix.length).split("/")[0];
        if(!name) {
            continue;
        }
        const child = prefix + name;
        let d = dirs.get(child);
        if(!d) {
            d = {name: name, path: child, videos: []};
            dirs.set(child, d);
        }
        d.videos.push(v);
    }
    for(const d of dirs.values()) {
        d.videos.sort(by_path);
    }
    return {
        dirs: [...dirs.values()].sort((a, b) => collator.compare(a.name, b.name)),
        videos: here.sort(by_path),
    };
}

function by_path(a, b)
{
    return collator.compare(a.path, b.path);
}

/*  In the order a folder reads. */
function videos_of_source(source_id)
{
    return S.videos.filter((v) => v.source_id === source_id).sort(by_path);
}

function find_video(source_id, path)
{
    return S.videos.find((v) => v.source_id === source_id && v.path === path) || null;
}

function find_uid(uid)
{
    return S.videos.find((v) => v.uid === uid) || null;
}

/*  The line under a title: the show and the episode code when it is
    one, the year when the name had one. Never the whole path: that is
    on the card. */
function facts_of(v)
{
    const out = [];
    if(v.show) {
        out.push(v.show);
        out.push(code(v.season, v.episode));
    }
    if(v.year) {
        out.push(v.year);
    }
    return out;
}

/*  A door from Sources into the library tree, read once. The source id
    is internal and has no business in the address bar. */
let pending_open = null;

function open_in_library(what)
{
    pending_open = what || null;
}

function take_open_request()
{
    const w = pending_open;
    pending_open = null;
    return w;
}


/***************************************************************
 *      5. The deck
 ***************************************************************/
function queue_tracks()
{
    return S.queue;
}

function queue_origin()
{
    return S.origin ? {list_id: S.origin.list_id, name: S.origin.name, edited: S.edited} : null;
}

function set_queue_origin(list_id, name)
{
    S.origin = (list_id && name) ? {list_id: list_id, name: name} : null;
    S.edited = false;
    emit("queue");
}

function mark_edited()
{
    if(S.origin && !S.edited) {
        S.edited = true;
    }
}

function queue_index()
{
    return S.qi;
}

function queue_length()
{
    return S.queue.length;
}

/*  The same FILE twice on the deck is never what anybody asked for. */
function dedupe(list, against)
{
    const seen = new Set();
    for(const v of (against || [])) {
        seen.add(v.uid);
    }
    const out = [];
    for(const v of list) {
        if(!v || seen.has(v.uid)) {
            continue;
        }
        seen.add(v.uid);
        out.push(v);
    }
    return out;
}

/*  What just happened to the deck, counted and never phrased: the
    shell says it, in the language in force. */
function say_added(added, already)
{
    S.said = {added: added, already: already, at: Date.now()};
    emit("said");
}

function last_said()
{
    return S.said;
}

function clear_said()
{
    if(S.said) {
        S.said = null;
        emit("said");
    }
}

/*  mode: "append" (default) | "replace" */
function queue_add(list, mode)
{
    if(!list || !list.length) {
        return 0;
    }
    const offered = list.length;
    if(mode === "replace") {
        note_place();
        S.queue = dedupe([...list], null);
        S.qi = -1;
        S.origin = null;
        S.edited = false;
        emit("queue");
        queue_play_at(0);
        return S.queue.length;
    }

    list = dedupe(list, S.queue);
    if(!list.length) {
        /*  All of it was there already: touch nothing — marking the
            deck edited would un-save a saved list for a no-op — but SAY
            it, or the button looks dead. */
        say_added(0, offered);
        return 0;
    }
    mark_edited();
    const at = S.queue.length;
    S.queue.push(...list);
    emit("queue");
    /*  An idle deck is ARMED, not started: the first video is cued and
        waits for play. */
    if(S.qi < 0) {
        S.qi = at;
        if(S.mode === "deck") {
            load_current(false);
        }
    }
    say_added(list.length, offered - list.length);
    return list.length;
}

function queue_remove_at(i)
{
    if(i < 0 || i >= S.queue.length) {
        return;
    }
    mark_edited();
    const was_current = (i === S.qi);
    S.queue.splice(i, 1);
    if(was_current) {
        if(!S.queue.length) {
            S.qi = -1;
            if(S.mode === "deck") {
                stop_playback();
            }
        } else {
            S.qi = Math.min(i, S.queue.length - 1);
            if(S.mode === "deck") {
                load_current(is_playing());
            }
        }
    } else if(i < S.qi) {
        S.qi--;
    }
    emit("queue");
}

function queue_move(from, to)
{
    if(from === to || from < 0 || from >= S.queue.length || to < 0 || to >= S.queue.length) {
        return;
    }
    mark_edited();
    const cur = S.queue[S.qi] || null;
    const [item] = S.queue.splice(from, 1);
    S.queue.splice(to, 0, item);
    if(cur) {
        S.qi = S.queue.indexOf(cur);
    }
    emit("queue");
}

function queue_clear()
{
    note_place();
    S.queue = [];
    S.qi = -1;
    S.origin = null;
    S.edited = false;
    if(S.mode === "deck") {
        stop_playback();
    }
    emit("queue");
}

function queue_play_at(i)
{
    if(i < 0 || i >= S.queue.length) {
        return;
    }
    S.qi = i;
    if(S.mode === "temp") {
        S.temp_resume = false;
        temp_forget();
    }
    load_current(true);
}

/*  Which video a saved list was on when it was left. WHERE in that
    video is the video's own business (its remembered position), so a
    list comes back on the right video at the right second. */
const MAX_PLACES = 50;

function note_place()
{
    if(!S.origin) {
        return;
    }
    let v = S.queue[S.qi];
    if(!v) {
        return;
    }
    if(S.el && S.loaded_uid === v.uid && S.el.ended) {
        v = S.queue[S.qi + 1];
        if(!v) {
            delete S.places[S.origin.list_id];
            return;
        }
    }
    S.places[S.origin.list_id] = {source_id: v.source_id, path: v.path, at: Date.now()};
    const ids = Object.keys(S.places);
    if(ids.length > MAX_PLACES) {
        ids.sort((a, b) => S.places[a].at - S.places[b].at);
        for(const id of ids.slice(0, ids.length - MAX_PLACES)) {
            delete S.places[id];
        }
    }
}

/*  Put a saved list on the deck and play it from where it was left. */
function play_list(list, list_id, name)
{
    if(!list || !list.length) {
        return 0;
    }
    note_place();
    S.queue = dedupe([...list], null);
    S.origin = (list_id && name) ? {list_id: list_id, name: name} : null;
    S.edited = false;
    let i = 0;
    const p = list_id ? S.places[list_id] : null;
    if(p) {
        const k = S.queue.findIndex((v) => v.source_id === p.source_id && v.path === p.path);
        if(k >= 0) {
            i = k;
        }
    }
    S.qi = i;
    emit("queue");
    if(S.mode === "temp") {
        S.temp_resume = false;
        temp_forget();
    }
    load_current(true);
    return S.queue.length;
}


/***************************************************************
 *      6. The temporary list
 *
 *  Same element, other list. The deck's video is paused, and its
 *  place is safe because every video keeps its own; the way back
 *  loads it again and it comes back on that second.
 ***************************************************************/
async function play_temp(list, index)
{
    const items = (list || []).filter(Boolean);
    if(!items.length) {
        return;
    }
    if(S.mode !== "temp") {
        S.temp_resume = is_playing();
        if(S.el && !S.el.paused) {
            S.el.pause();
        }
    }
    S.temp_list = items;
    await temp_go(Math.max(0, Math.min(items.length - 1, index | 0)));
}

async function temp_go(i)
{
    const v = S.temp_list[i];
    if(!v) {
        back_to_deck();
        return;
    }
    S.mode = "temp";
    S.temp_i = i;
    S.temp = v;
    emit("temp");
    const ok = await load_into(v, true);
    if(!ok && S.temp === v) {
        /*  Do not sit on a video that cannot play. */
        if(i + 1 < S.temp_list.length) {
            await temp_go(i + 1);
        } else {
            back_to_deck();
        }
    }
}

function temp_next()
{
    if(S.mode !== "temp") {
        return;
    }
    if(S.temp_i + 1 >= S.temp_list.length) {
        back_to_deck();
        return;
    }
    temp_go(S.temp_i + 1);
}

function temp_prev()
{
    if(S.mode !== "temp") {
        return;
    }
    temp_go(Math.max(0, S.temp_i - 1));
}

function temp_forget()
{
    S.temp = null;
    S.temp_list = [];
    S.temp_i = -1;
    S.mode = "deck";
    emit("temp");
}

/*  The way back, and the only way back. The deck plays again only if
    it was playing when the temporary list took over. */
function back_to_deck()
{
    const resume = S.temp_resume;
    S.temp_resume = false;
    const was_temp = (S.mode === "temp");
    temp_forget();
    if(!was_temp) {
        return;
    }
    if(S.queue[S.qi]) {
        load_current(resume);
    } else {
        stop_playback();
    }
}

function temp_track()
{
    return S.mode === "temp" ? S.temp : null;
}

function temp_playing()
{
    return S.mode === "temp" && !!S.el && !S.el.paused;
}

function temp_position()
{
    return {index: S.temp_i, length: S.temp_list.length};
}

function temp_tracks()
{
    return [...S.temp_list];
}


/***************************************************************
 *      7. The deck across a reload
 ***************************************************************/
function queue_snapshot()
{
    note_place();
    return {
        origin: S.origin,
        edited: S.edited,
        index:  S.qi,
        items:  S.queue.map((v) => ({source_id: v.source_id, path: v.path})),
        places: S.places,
    };
}

/*  Nothing is written before boot has read the stored deck back:
    a "playing" emitted in between would store the EMPTY deck over the
    real one. */
function store_deck()
{
    if(!S.deck_ready) {
        return Promise.resolve();
    }
    return pref_set("queue", queue_snapshot());
}

function set_deck_ready()
{
    S.deck_ready = true;
}

/*  Restored PAUSED: a page that starts playing a film on its own is
    worse than one that restores nothing. */
function restore_queue(snap)
{
    if(snap && snap.places && typeof snap.places === "object") {
        S.places = snap.places;
    }
    if(!snap || !snap.items || !snap.items.length) {
        return 0;
    }
    const videos = [];
    for(const it of snap.items) {
        const v = find_video(it.source_id, it.path);
        if(v) {
            videos.push(v);
        }
    }
    if(!videos.length) {
        return 0;
    }
    S.queue = videos;
    S.origin = snap.origin || null;
    S.edited = !!snap.edited;
    S.qi = Math.max(0, Math.min(snap.index || 0, videos.length - 1));
    emit("queue");
    load_current(false);
    return videos.length;
}

/*  The folder was authorised AFTER the deck came back: load it now,
    and its place with it. */
function reload_current()
{
    const v = sounding();
    if(!v || (S.loaded_uid === v.uid && S.el && S.el.src)) {
        return;
    }
    load_into(v, false);
}


/***************************************************************
 *      8. The element
 ***************************************************************/
function get_video()
{
    if(!S.el) {
        const el = document.createElement("video");
        el.className = "VID_VIDEO";
        el.preload = "metadata";
        el.playsInline = true;
        el.setAttribute("playsinline", "");
        S.el = el;
        wire(el);
        park();
    }
    return S.el;
}

/*  Where the element waits when no screen is showing it. Still IN the
    document: a media element taken out of it is paused by the spec. */
function park()
{
    if(!S.$park) {
        S.$park = document.createElement("div");
        S.$park.className = "VID_PARK";
        S.$park.setAttribute("aria-hidden", "true");
        document.body.appendChild(S.$park);
    }
    if(S.el && S.el.parentNode !== S.$park) {
        S.$park.appendChild(S.el);
    }
}

/***************************************************************
 *  Put the element into `$host` (the deck's stage, the mini-
 *  player's box) or, with null, back into the park. Moving it
 *  does not stop it.
 ***************************************************************/
function dock_video($host)
{
    const el = get_video();
    if(!$host) {
        park();
        return;
    }
    if(el.parentNode !== $host) {
        $host.appendChild(el);
    }
}

function wire(el)
{
    S.ac = new AbortController();
    const on = (ev, fn) => el.addEventListener(ev, fn, {signal: S.ac.signal});
    on("timeupdate", () => emit("time"));
    on("play", () => emit("playing"));
    on("pause", () => emit("playing"));
    on("loadedmetadata", () => emit("metadata"));
    on("durationchange", () => emit("time"));
    on("canplay", () => emit("canplay"));
    on("stalled", () => diag("stalled", {}));
    on("ended", () => emit("ended"));
    on("error", function() {
        const err = el.error;
        if(!el.getAttribute("src") || (err && err.code === 1)) {
            return;                             // an abort, not a failure
        }
        S.el_error = (err && err.code) || 0;
        emit("error");
    });
}

/*  The answers to what the element said, called from the root's
    actions (see the channels at the top). */
function on_metadata()
{
    apply_resume();
    emit("time");
    emit("playing");
}

function on_canplay()
{
    S.retry_for = 0;
}

function on_ended()
{
    if(S.mode === "temp") {
        temp_next();
    } else {
        step(1);
    }
}

function on_media_error()
{
    const code = S.el_error;
    diag("video", {code: code});
    log_warning(`video_store: the element failed, MediaError ${code}`);
    const v = sounding();
    /*  A File is a snapshot of the disk at the moment it was handed
        over; a file replaced since reads as a load failure. Fetch it
        again, once, before calling it unreadable. */
    if(v && S.retry_for !== v.uid && code !== 4) {
        S.retry_for = v.uid;
        v.file = null;
        load_into(v, S.autoplay_intent);
        return;
    }
    /*  4 is MEDIA_ERR_SRC_NOT_SUPPORTED: the file is there and fine,
        and this browser has no decoder for what is inside it. That
        is a different sentence from "could not be read", and the
        only one that tells the user what to do about it. */
    say_notice((code === 4) ? "this browser cannot play this video"
                            : "that file could not be read");
    if(S.mode === "temp") {
        temp_next();
    }
}

/*  play() answers with a promise, and its refusals are worth a line:
    NotAllowedError is a browser that wants a gesture first. AbortError
    is not a failure — a newer load took the element over. */
function play_el(el)
{
    el.play().catch(function(e) {
        if(e && e.name === "AbortError") {
            return;                     // superseded by a newer load
        }
        diag("play_refused", {name: (e && e.name) || ""});
        log_warning(`video_store: play() refused: ${(e && e.name) || e}`);
    });
}

/*  The video the element is playing, or is cued on: the temporary
    list's while it runs, the deck's otherwise. */
function sounding()
{
    if(S.mode === "temp") {
        return S.temp;
    }
    return S.queue[S.qi] || null;
}

function current_track()
{
    return S.queue[S.qi] || null;
}

function is_playing()
{
    return S.mode === "deck" && !!S.el && !S.el.paused;
}

function is_sounding()
{
    return !!S.el && !S.el.paused && !!S.el.getAttribute("src");
}

function stop_playback()
{
    if(S.el) {
        S.el.pause();
        S.el.removeAttribute("src");
        S.el.load();
    }
    clear_subs();
    S.loaded_uid = 0;
    S.resumed = null;
    if(S.url) {
        URL.revokeObjectURL(S.url);
        S.url = null;
    }
    emit("playing");
}

/***************************************************************
 *  Where a video should start: asked of whoever keeps the places
 *  (stats_store registers it). 0 when nobody does, or when the
 *  video was finished.
 ***************************************************************/
let resume_lookup = null;
let pending_resume = null;      // {uid, at}

function set_resume_lookup(fn)
{
    resume_lookup = fn;
}

function apply_resume()
{
    const v = sounding();
    const p = pending_resume;
    if(!p || !v || v.uid !== p.uid || !S.el) {
        return;
    }
    pending_resume = null;
    const dur = S.el.duration;
    if(!isFinite(dur) || dur <= 0) {
        return;
    }
    try {
        S.el.currentTime = Math.max(0, Math.min(p.at, dur - 1));
        S.resumed = {uid: v.uid, at: p.at};
    } catch(e) {
        /*  Not seekable: it starts at the start. */
        log_warning(`video_store: cannot resume at ${p.at}: ${(e && e.name) || e}`);
    }
}

/*  "Resumed at 12:34" — the deck offers to start it over. */
function resumed()
{
    const v = sounding();
    return (S.resumed && v && S.resumed.uid === v.uid) ? S.resumed : null;
}

function forget_resumed()
{
    if(S.resumed) {
        S.resumed = null;
        emit("playing");
    }
}

function start_over()
{
    if(!S.el) {
        return;
    }
    S.resumed = null;
    pending_resume = null;
    try {
        S.el.currentTime = 0;
    } catch(e) {
        /*  Not seekable yet: the load that follows starts at 0 anyway. */
        log_warning(`video_store: cannot seek to the start: ${(e && e.name) || e}`);
    }
    emit("playing");
}

/*  The deck's current video onto the element. */
function load_current(autoplay)
{
    const v = S.queue[S.qi];
    if(!v) {
        return Promise.resolve(false);
    }
    S.mode = "deck";
    return load_into(v, autoplay);
}

/***************************************************************
 *  Any video onto the element. Resolving can fail — the folder
 *  may be waiting to be authorised, the file may have moved —
 *  and that is said rather than left as a play button that does
 *  nothing.
 ***************************************************************/
async function load_into(v, autoplay)
{
    const file = await resolve_file(v);
    if(!file) {
        S.loaded_uid = 0;
        if(!S.resolve_denied) {
            say_notice("that file could not be read");
        }
        emit("playing");
        return false;
    }
    if(sounding() !== v) {
        return false;               // moved on while that was resolving
    }
    const el = get_video();
    S.autoplay_intent = !!autoplay;
    S.resumed = null;
    /*  What was said about the last video is not about this one. */
    S.notice = "";
    const at = resume_lookup ? (resume_lookup(v) || 0) : 0;
    pending_resume = at > 0 ? {uid: v.uid, at: at} : null;

    const stale = S.url;
    S.url = URL.createObjectURL(file);
    clear_subs();
    el.src = S.url;
    el.defaultPlaybackRate = S.rate;
    el.playbackRate = S.rate;
    S.loaded_uid = v.uid;
    if(stale) {
        /*  Revoked only once the new one is in place: pulling the old
            one out from under a load in flight reads as a broken file. */
        setTimeout(() => URL.revokeObjectURL(stale), 1000);
    }
    if(autoplay) {
        play_el(el);
    }
    update_media_session(v);
    emit("playing");
    load_subs(v);
    return true;
}

function toggle()
{
    const v = sounding();
    if(!v) {
        if(S.queue.length) {
            queue_play_at(Math.max(0, S.qi));
        }
        return;
    }
    const el = get_video();
    if(!el.getAttribute("src") || S.loaded_uid !== v.uid) {
        load_into(v, true);
        return;
    }
    if(el.paused) {
        play_el(el);
    } else {
        el.pause();
    }
}

function pause()
{
    if(S.el && !S.el.paused) {
        S.el.pause();
    }
}

/*  Next / previous in whichever list is playing. Past the end of the
    deck it stops: a queue of films that wraps round to the first one
    at 2 a.m. is not a feature. */
function step(n)
{
    if(S.mode === "temp") {
        if(n > 0) {
            temp_next();
        } else {
            temp_prev();
        }
        return;
    }
    if(!S.queue.length) {
        return;
    }
    const i = S.qi + n;
    if(i >= S.queue.length) {
        pause();
        return;
    }
    S.qi = Math.max(0, i);
    load_current(true);
}

function prev()
{
    const el = get_video();
    if(el.currentTime > 5) {
        el.currentTime = 0;
    } else {
        step(-1);
    }
}

function seek_by(seconds)
{
    const el = get_video();
    const dur = el.duration;
    if(!el.getAttribute("src") || !isFinite(dur) || dur <= 0) {
        return;
    }
    el.currentTime = Math.max(0, Math.min(dur - 0.25, el.currentTime + seconds));
}

function seek_fraction(fraction)
{
    const el = get_video();
    if(!el.duration || !isFinite(el.duration)) {
        return;
    }
    el.currentTime = Math.max(0, Math.min(1, fraction)) * el.duration;
}

function progress()
{
    const el = S.el;
    const dur = (el && isFinite(el.duration)) ? el.duration : 0;
    const cur = (el && el.currentTime) || 0;
    return {current: cur, duration: dur, fraction: dur ? (cur / dur) : 0};
}

const RATES = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];

function set_rate(r)
{
    const rate = RATES.indexOf(Number(r)) >= 0 ? Number(r) : 1;
    S.rate = rate;
    if(S.el) {
        S.el.defaultPlaybackRate = rate;
        S.el.playbackRate = rate;
    }
    emit("playing");
}

function get_rate()
{
    return S.rate;
}

function queue_position()
{
    return {index: S.qi, length: S.queue.length};
}


/***************************************************************
 *      9. Subtitles
 *
 *  The .srt or .vtt beside the file, read when the video is
 *  loaded and handed to the element as a <track>. An .srt is
 *  turned into WebVTT on the way (the browser reads only that),
 *  and decoded as UTF-8 or, failing that, as the Windows code
 *  page most of the world's .srt files were written in.
 ***************************************************************/
function clear_subs()
{
    S.subs_gen++;
    for(const s of S.subs) {
        if(s.$track && s.$track.parentNode) {
            s.$track.parentNode.removeChild(s.$track);
        }
        if(s.url) {
            URL.revokeObjectURL(s.url);
        }
    }
    S.subs = [];
    S.sub_on = -1;
    emit("subs");
}

function lang_of(label)
{
    const m = /^([a-z]{2,3})(?:[-_][a-z]{2,4})?(?:\.|$)/i.exec(label || "");
    return m ? m[1].toLowerCase() : "";
}

let ui_lang = "en";

function set_ui_language(code)
{
    ui_lang = code || "en";
}

async function load_subs(v)
{
    if(!v.subs || !v.subs.length) {
        return;
    }
    const uid = v.uid;
    /*  The uid is not enough to know this read is still wanted: the
        same video can be loaded twice while the first read is under
        way (a retry, the way back to the queue), and two reads of it
        would both add their tracks — the first set orphaned on the
        element, never removed, and maybe still showing. */
    const gen = ++S.subs_gen;
    const out = [];
    for(const s of v.subs) {
        const f = await resolve_path(v.source_id, s.path);
        if(!f) {
            continue;
        }
        let text;
        try {
            text = decode_text(await f.arrayBuffer());
        } catch(e) {
            log_warning(`video_store: cannot read the subtitles ${s.path}: ${(e && e.name) || e}`);
            continue;
        }
        const vtt = /\.vtt$/i.test(s.path) ? text : srt_to_vtt(text);
        out.push({
            label: s.label,
            lang: lang_of(s.label),
            url: URL.createObjectURL(new Blob([vtt], {type: "text/vtt"})),
        });
    }
    if(S.loaded_uid !== uid || S.subs_gen !== gen) {
        for(const s of out) {
            URL.revokeObjectURL(s.url);
        }
        return;
    }
    const el = get_video();
    for(const s of out) {
        const $t = document.createElement("track");
        $t.kind = "subtitles";
        $t.label = s.label || "subtitles";
        if(s.lang) {
            $t.srclang = s.lang;
        }
        $t.src = s.url;
        el.appendChild($t);
        s.$track = $t;
    }
    S.subs = out;
    if(S.sub_pref === null) {
        S.sub_pref = await pref_get("subs", null);
        if(S.subs_gen !== gen) {
            return;                 // cleared while the choice was read
        }
    }
    let pick = -1;
    if(S.sub_pref && S.sub_pref !== "off") {
        pick = out.findIndex((s) => s.label === S.sub_pref);
        if(pick < 0) {
            pick = out.findIndex((s) => s.lang && s.lang === lang_of(S.sub_pref));
        }
    } else if(S.sub_pref === null) {
        /*  Never chosen: the language of the app, if there is one. */
        pick = out.findIndex((s) => s.lang === ui_lang);
    }
    show_sub(pick);
}

function show_sub(i)
{
    S.sub_on = (i >= 0 && i < S.subs.length) ? i : -1;
    S.subs.forEach(function(s, k) {
        if(s.$track && s.$track.track) {
            s.$track.track.mode = (k === S.sub_on) ? "showing" : "disabled";
        }
    });
    emit("subs");
}

function subtitle_tracks()
{
    return S.subs.map((s, i) => ({index: i, label: s.label, lang: s.lang}));
}

function current_subtitle()
{
    return S.sub_on;
}

/*  Chosen by the user: remembered, by label, for the next video. */
function set_subtitle(i)
{
    show_sub(i);
    S.sub_pref = (S.sub_on >= 0) ? (S.subs[S.sub_on].label || "") : "off";
    pref_set("subs", S.sub_pref);
}


/***************************************************************
 *      10. System controls
 ***************************************************************/
let thumb_lookup = null;

function set_thumb_lookup(fn)
{
    thumb_lookup = fn;
}

function update_media_session(v)
{
    if(!("mediaSession" in navigator) || typeof MediaMetadata === "undefined") {
        return;
    }
    const url = thumb_lookup ? thumb_lookup(v) : null;
    try {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: v.title,
            artist: v.show ? (v.show + " · " + code(v.season, v.episode)) : (v.year || ""),
            artwork: url ? [{src: url, sizes: "320x180", type: "image/jpeg"}] : [],
        });
    } catch(e) {
        /*  An engine that refuses the metadata still plays the video. */
        log_warning(`video_store: MediaSession refused the metadata: ${(e && e.name) || e}`);
    }
}

/*  The keys of the system — a headset, the lock screen, a keyboard's
    media keys — are the operating system talking: `on_action(name)`
    is the root's, and turns each into an event; media_action() below
    is what its action does. */
const MEDIA_ACTIONS = ["play", "pause", "previoustrack", "nexttrack", "seekbackward", "seekforward"];

function setup_media_session(on_action)
{
    if(!("mediaSession" in navigator)) {
        return;
    }
    for(const name of MEDIA_ACTIONS) {
        try {
            navigator.mediaSession.setActionHandler(name, () => on_action(name));
        } catch(e) {
            /*  An action this engine does not know: feature detection,
                not a failure — the others are still set. */
        }
    }
}

function media_action(name)
{
    switch(name) {
        case "play":
            toggle();
            return true;
        case "pause":
            pause();
            return true;
        case "previoustrack":
            prev();
            return true;
        case "nexttrack":
            step(1);
            return true;
        case "seekbackward":
            seek_by(-10);
            return true;
        case "seekforward":
            seek_by(10);
            return true;
        default:
            return false;
    }
}


/***************************************************************
 *      11. Time
 ***************************************************************/
function fmt_time(s)
{
    if(!isFinite(s) || s < 0) {
        return "0:00";
    }
    s = Math.floor(s);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = String(s % 60).padStart(2, "0");
    return h ? (h + ":" + String(m).padStart(2, "0") + ":" + sec) : (m + ":" + sec);
}


export {
    subscribe,
    key_of,
    /*  library */
    has_library,
    video_count,
    begin_read,
    ingest,
    cancel_ingest,
    tags_of_source,
    restore_tracks,
    set_file_resolver,
    resolve_file,
    drop_source_tracks,
    unlist_source_tracks,
    relink_source,
    store_state,
    clear_notice,
    say_notice,
    series,
    series_by_id,
    others,
    all_sorted,
    search,
    source_root_path,
    folder_level,
    videos_of_source,
    find_video,
    find_uid,
    facts_of,
    open_in_library,
    take_open_request,
    /*  deck */
    queue_tracks,
    queue_origin,
    set_queue_origin,
    queue_index,
    queue_length,
    queue_add,
    last_said,
    clear_said,
    queue_remove_at,
    queue_move,
    queue_clear,
    queue_play_at,
    play_list,
    queue_position,
    /*  temporary list */
    play_temp,
    temp_next,
    temp_prev,
    back_to_deck,
    temp_track,
    temp_playing,
    temp_position,
    temp_tracks,
    /*  across a reload */
    queue_snapshot,
    store_deck,
    set_deck_ready,
    restore_queue,
    reload_current,
    /*  the element */
    get_video,
    dock_video,
    sounding,
    current_track,
    is_playing,
    is_sounding,
    toggle,
    pause,
    step,
    prev,
    seek_by,
    seek_fraction,
    progress,
    RATES,
    set_rate,
    get_rate,
    set_resume_lookup,
    resumed,
    forget_resumed,
    start_over,
    /*  subtitles */
    subtitle_tracks,
    current_subtitle,
    set_subtitle,
    set_ui_language,
    /*  system */
    set_thumb_lookup,
    setup_media_session,
    media_action,
    /*  what the element said */
    on_metadata,
    on_canplay,
    on_ended,
    on_media_error,
    fmt_time,
};
