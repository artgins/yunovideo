/***********************************************************************
 *          playlists_store.js
 *
 *      The lists the user saved, kept between sessions.
 *
 *      A saved list holds REFERENCES, never video: for each entry, the
 *      source it came from and its path inside that source, plus the
 *      title and show so the list can still be read when the source is
 *      not authorised yet. Resolving a list means looking those pairs up
 *      in the library that the authorised sources produced.
 *
 *      So a list can be partially resolvable — the folder it points at
 *      may be gone, or simply not authorised yet in this session. That is
 *      reported rather than hidden: the view says how many entries are
 *      missing instead of silently playing a shorter list.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {traced, trace_emit, store_trace} from "./trace.js";
import {STORE_PLAYLISTS, idb_all, idb_put, idb_del} from "./idb.js";
import {queue_tracks, find_video, set_queue_origin} from "./video_store.js";


/***************************************************************
 *      Pub/sub — one channel, "playlists".
 ***************************************************************/
const listeners = new Set();

function subscribe_playlists(fn)
{
    listeners.add(fn);
    return function unsubscribe() {
        listeners.delete(fn);
    };
}

function emit()
{
    trace_emit("playlists_store", "playlists");
    for(const fn of listeners) {
        try {
            fn("playlists");
        } catch(e) {
            console.error("playlists_store listener failed", e);
        }
    }
}


const S = {
    lists: [],
};

function new_id()
{
    if(typeof crypto !== "undefined" && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    return "p" + Date.now() + "_" + Math.floor(Math.random() * 1e9);
}

async function load_playlists()
{
    let rows = await idb_all(STORE_PLAYLISTS);
    S.lists = (rows || []).sort((a, b) => (b.created || 0) - (a.created || 0));
    emit();
    return S.lists.length;
}

function all_playlists()
{
    return S.lists.map((p) => ({
        id: p.id,
        name: p.name,
        created: p.created,
        count: (p.items || []).length,
    }));
}

function find(id)
{
    return S.lists.find((p) => p.id === id) || null;
}


/***************************************************************
 *      Saving
 ***************************************************************/
async function save_queue_as(name)
{
    let queue = queue_tracks();
    if(!queue.length) {
        return null;
    }
    let list = {
        id: new_id(),
        name: (name || "").trim() || "untitled list",
        created: Date.now(),
        items: queue.map((t) => ({
            source_id: t.source_id,
            path: t.path,
            title: t.title,
            show: t.show,
        })),
    };
    S.lists.unshift(list);
    await idb_put(STORE_PLAYLISTS, list);

    /*  THE QUEUE YOU JUST SAVED IS NOW THAT LIST, and the deck has to
        say so. Without this the deck went on calling itself a queue put
        together by hand the moment after it was given a name: it would
        offer to save it again, and take a second copy under a second
        name without a word.

        Here rather than at the one call site, so that no future caller
        can save a list and forget the half that makes it true. */
    set_queue_origin(list.id, list.name);

    emit();
    return list.id;
}

async function remove_playlist(id)
{
    let i = S.lists.findIndex((p) => p.id === id);
    if(i < 0) {
        return;
    }
    S.lists.splice(i, 1);
    await idb_del(STORE_PLAYLISTS, id);
    emit();
}

async function rename_playlist(id, name)
{
    let list = find(id);
    if(!list) {
        return;
    }
    list.name = (name || "").trim() || list.name;
    await idb_put(STORE_PLAYLISTS, list);
    emit();
}


/***************************************************************
 *      Resolving against the library that is loaded right now
 ***************************************************************/
function resolve(id)
{
    let list = find(id);
    if(!list) {
        return {tracks: [], missing: 0, total: 0};
    }
    let tracks = [];
    let missing = 0;
    for(const item of (list.items || [])) {
        let t = find_video(item.source_id, item.path);
        if(t) {
            tracks.push(t);
        } else {
            missing++;
        }
    }
    return {tracks, missing, total: (list.items || []).length};
}

/*  What a list looks like without any source authorised: the stored
    titles, so the user can read a list before deciding to authorise. */
function entries_of(id)
{
    let list = find(id);
    return list ? (list.items || []) : [];
}



/*  What the interface calls, traced (see trace.js): the store's own
    calls to these stay untraced. */
const __t_load_playlists = traced("playlists_store", "load_playlists", load_playlists);
const __t_save_queue_as = traced("playlists_store", "save_queue_as", save_queue_as);
const __t_remove_playlist = traced("playlists_store", "remove_playlist", remove_playlist);
const __t_rename_playlist = traced("playlists_store", "rename_playlist", rename_playlist);

export {
    subscribe_playlists,
    __t_load_playlists as load_playlists,
    all_playlists,
    __t_save_queue_as as save_queue_as,
    __t_remove_playlist as remove_playlist,
    __t_rename_playlist as rename_playlist,
    resolve,
    entries_of,
};
