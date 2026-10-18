/***********************************************************************
 *          stats_store.js
 *
 *      What the app knows about each video beyond its name: how often it
 *      was watched, how many hearts it was given, and WHERE IT WAS LEFT.
 *
 *        views   how many times it was WATCHED — a video counts once it
 *                has really played for a while (thirty seconds, or half
 *                of it when it is shorter than a minute), so skipping
 *                past it does not count and neither does dragging the
 *                scrub bar across it.
 *        full    how many of those reached the end.
 *        hearts  a number, not a flag, as in yunomúsica.
 *        pos     the second it was left at. A film is two hours long:
 *                coming back to it at 0:00 is the one thing a video
 *                player must not do. Written every ten seconds while it
 *                plays and at every pause, so a phone that kills the
 *                app costs ten seconds at most.
 *        dur     how long it is, learned the first time it was opened,
 *                so a row can draw how much of it has been watched.
 *
 *      WHAT THIS IS NOT. There are no timestamps and no order — nothing
 *      that reconstructs an evening. "Continue watching" is therefore
 *      sorted by NAME, not by when: that would take a record of when
 *      each thing was watched, and this app does not keep one. Every
 *      number is shown on the video it belongs to, and erasable from the
 *      same card that shows it.
 *
 *      Keyed by source and path, the identity that survives a reload.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {STORE_STATS, idb_all, idb_put, idb_del} from "./idb.js";
import {
    subscribe, progress, sounding, key_of, set_resume_lookup, is_sounding,
} from "./video_store.js";


/***************************************************************
 *              Constants
 ***************************************************************/
/*  How long a video must really have played to count as watched. */
const COUNT_AFTER_S = 30;

/*  A jump bigger than this between two readings of the clock is a seek,
    not watching. */
const TICK_MAX_S = 1.5;

/*  How often the place is written while a video plays. */
const PLACE_EVERY_MS = 10000;

/*  Places this close to the start are not worth resuming from. */
const RESUME_MIN_S = 10;

/*  Writes are coalesced: a heart tapped four times is one record. */
const WRITE_MS = 400;


/***************************************************************
 *      Pub/sub — one channel, "stats".
 ***************************************************************/
const listeners = new Set();

function subscribe_stats(fn)
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
            fn("stats");
        } catch(e) {
            console.error("stats_store listener failed", e);
        }
    }
}


const S = {
    by_key:  new Map(),     // key -> {key, views, full, hearts, pos, dur}
    dirty:   new Set(),
    timer:   0,
    /*  the watch in progress */
    key:     "",
    dur:     0,
    heard:   0,
    at:      0,
    counted: false,
    placed_at: 0,
    watching: null,
};

const ZERO = {views: 0, full: 0, hearts: 0, pos: 0, dur: 0};

function row_of(key, make)
{
    let row = S.by_key.get(key);
    if(!row && make) {
        row = {key: key, views: 0, full: 0, hearts: 0, pos: 0, dur: 0};
        S.by_key.set(key, row);
    }
    return row || null;
}

function empty(row)
{
    return !row.views && !row.full && !row.hearts && !row.pos && !row.dur;
}


/***************************************************************
 *              Reading
 ***************************************************************/
function stats_of(video)
{
    const key = key_of(video);
    return (key && S.by_key.get(key)) || ZERO;
}

/*  Where it ends: the credits of a film are a minute or more, and a
    video stopped there was watched. Five percent, at least twenty
    seconds and at most three minutes. */
function tail(dur)
{
    return Math.min(180, Math.max(20, dur * 0.05));
}

/*  0..1 of it watched, for the bar on a row. A finished video with
    no place reads as 1 when it was ever watched to the end. */
function watched_fraction(video)
{
    const row = stats_of(video);
    if(row.pos && row.dur) {
        return Math.max(0, Math.min(1, row.pos / row.dur));
    }
    return row.full ? 1 : 0;
}

/*  The second to start this video at, or 0. */
function resume_point(video)
{
    const row = stats_of(video);
    if(!row.pos || row.pos < RESUME_MIN_S) {
        return 0;
    }
    if(row.dur && row.pos >= row.dur - tail(row.dur)) {
        return 0;
    }
    return row.pos;
}

function in_progress()
{
    const out = [];
    for(const row of S.by_key.values()) {
        if(row.pos >= RESUME_MIN_S && (!row.dur || row.pos < row.dur - tail(row.dur))) {
            out.push(row);
        }
    }
    return out;
}

function ranked(by)
{
    const hearts = (by === "hearts");
    const out = [];
    for(const row of S.by_key.values()) {
        if((hearts ? row.hearts : row.views) > 0) {
            out.push(row);
        }
    }
    out.sort(function(a, b) {
        return hearts
            ? (b.hearts - a.hearts) || (b.views - a.views)
            : (b.views - a.views) || (b.hearts - a.hearts);
    });
    return out;
}

/*  Split on the FIRST separator: a source id never contains one, a
    path may. */
function split_key(key)
{
    const i = key.indexOf("|");
    return i < 0
        ? {source_id: key, path: ""}
        : {source_id: key.slice(0, i), path: key.slice(i + 1)};
}


/***************************************************************
 *              Writing
 ***************************************************************/
function touch(key)
{
    S.dirty.add(key);
    if(S.timer) {
        return;
    }
    S.timer = setTimeout(flush, WRITE_MS);
}

function flush()
{
    if(S.timer) {
        clearTimeout(S.timer);
        S.timer = 0;
    }
    const keys = Array.from(S.dirty);
    S.dirty.clear();
    for(const k of keys) {
        const row = S.by_key.get(k);
        if(!row || empty(row)) {
            S.by_key.delete(k);
            idb_del(STORE_STATS, k);
            continue;
        }
        idb_put(STORE_STATS, row);
    }
}

function heart(video, delta)
{
    const key = key_of(video);
    if(!key) {
        return 0;
    }
    const row = row_of(key, true);
    row.hearts = Math.max(0, row.hearts + delta);
    touch(key);
    emit();
    return row.hearts;
}

/*  Everything this app remembers about one video, gone — except its
    length, which is a fact about the file and not about anybody. */
function stats_reset(video)
{
    const key = key_of(video);
    const row = key ? row_of(key, false) : null;
    if(!row) {
        return;
    }
    row.views = 0;
    row.full = 0;
    row.hearts = 0;
    row.pos = 0;
    if(S.key === key) {
        S.counted = true;
        S.at = 0;
    }
    touch(key);
    emit();
}

/*  "Watched it, or never mind": the place goes, nothing else. */
function forget_place(video)
{
    const key = key_of(video);
    const row = key ? row_of(key, false) : null;
    if(!row || !row.pos) {
        return;
    }
    row.pos = 0;
    touch(key);
    emit();
}

/*  One kind of count, everywhere: "views" or "hearts". */
function clear_counts(kind)
{
    const views = (kind !== "hearts");
    let touched = false;
    for(const row of S.by_key.values()) {
        if(views ? (row.views || row.full) : row.hearts) {
            if(views) {
                row.views = 0;
                row.full = 0;
            } else {
                row.hearts = 0;
            }
            touch(row.key);
            touched = true;
        }
    }
    if(views) {
        S.counted = true;
    }
    if(touched) {
        emit();
    }
}

/*  Every place, everywhere: "Continue watching" emptied. */
function clear_places()
{
    let touched = false;
    for(const row of S.by_key.values()) {
        if(row.pos) {
            row.pos = 0;
            touch(row.key);
            touched = true;
        }
    }
    S.at = 0;
    if(touched) {
        emit();
    }
}

function drop_source_stats(source_id)
{
    const prefix = source_id + "|";
    let gone = false;
    for(const key of Array.from(S.by_key.keys())) {
        if(key.indexOf(prefix) === 0) {
            S.by_key.delete(key);
            idb_del(STORE_STATS, key);
            gone = true;
        }
    }
    if(gone) {
        emit();
    }
}

/*  The length of a video, learned from the element or from its first
    frame. Written once; a length does not change. */
function note_duration(video, dur)
{
    const key = key_of(video);
    if(!key || !isFinite(dur) || dur <= 0) {
        return;
    }
    const row = row_of(key, true);
    if(Math.abs((row.dur || 0) - dur) < 0.5) {
        return;
    }
    row.dur = dur;
    touch(key);
    emit();
}


/***************************************************************
 *              Watching
 *
 *  Off the store's own clock. What is added up is the time that
 *  REALLY PLAYED: a difference between two readings counts only
 *  when it is the size of a tick, so a seek adds nothing and
 *  neither does a pause.
 *
 *  The temporary list is watched like the deck: pressing play on
 *  an episode in the library is how most things are watched,
 *  and a count that ignored it would ignore most of the watching.
 ***************************************************************/
function start_counting()
{
    if(S.watching) {
        return;
    }
    set_resume_lookup(resume_point);
    S.watching = subscribe(function(channel) {
        if(channel === "time" || channel === "playing" || channel === "queue" ||
                channel === "temp") {
            tick(channel);
        }
    });
}

function tick(channel)
{
    const video = sounding();
    const key = key_of(video);
    const p = progress();

    if(key !== S.key) {
        place_now();
        S.key = key;
        S.dur = 0;
        S.heard = 0;
        S.at = 0;
        S.counted = false;
        S.placed_at = Date.now();
        return;
    }
    if(!key) {
        return;
    }
    if(p.duration && Math.abs(p.duration - S.dur) > 0.5) {
        S.dur = p.duration;
        note_duration(video, p.duration);
    }

    /*  The clock of an element still loading this video reads 0, and
        that is not where it was left. */
    if(!p.duration) {
        return;
    }
    const delta = p.current - S.at;
    S.at = p.current;
    if(delta > 0 && delta <= TICK_MAX_S) {
        S.heard += delta;
    }

    if(!S.counted && S.heard >= threshold(S.dur)) {
        S.counted = true;
        const row = row_of(key, true);
        row.views++;
        touch(key);
        emit();
    }

    /*  The place: every ten seconds while playing, and at once when it
        stops — a pause is the moment somebody puts the phone down. */
    const paused = !is_sounding();
    if((channel === "playing" && paused) || Date.now() - S.placed_at >= PLACE_EVERY_MS) {
        place_now();
    }
}

function threshold(duration)
{
    if(!duration || !isFinite(duration)) {
        return COUNT_AFTER_S;
    }
    return Math.min(COUNT_AFTER_S, Math.max(1, duration / 2));
}

function place_now()
{
    S.placed_at = Date.now();
    if(!S.key || !S.dur || !S.at) {
        return;
    }
    const row = row_of(S.key, true);
    const at = Math.round(S.at);
    if(row.pos === at) {
        return;
    }
    row.pos = at;
    touch(S.key);
    emit();
}

/*  Played to the end: one more full view, and no place — the next time
    it starts at the start. Called by the root's action for the
    element's "ended", BEFORE it moves on to the next video: heard as a
    store channel it could arrive after the next one was loaded, and be
    written onto that one. */
function note_ended()
{
    if(!S.key) {
        return;
    }
    const row = row_of(S.key, true);
    if(S.counted) {
        row.full++;
    }
    row.pos = 0;
    S.at = 0;
    touch(S.key);
    emit();
}

/*  The tab is going away: the place goes down NOW, not in 400 ms. */
function flush_places()
{
    const p = progress();
    if(S.key && p.duration) {
        S.at = p.current;
        S.dur = p.duration;
    }
    place_now();
    flush();
}


async function load_stats()
{
    const rows = await idb_all(STORE_STATS);
    S.by_key.clear();
    for(const r of rows) {
        if(r && r.key) {
            S.by_key.set(r.key, {
                key: r.key,
                views: r.views || 0,
                full: r.full || 0,
                hearts: r.hearts || 0,
                pos: r.pos || 0,
                dur: r.dur || 0,
            });
        }
    }
    start_counting();
    emit();
    return S.by_key.size;
}


export {
    load_stats,
    subscribe_stats,
    stats_of,
    watched_fraction,
    resume_point,
    in_progress,
    ranked,
    split_key,
    heart,
    stats_reset,
    forget_place,
    clear_counts,
    clear_places,
    drop_source_stats,
    note_duration,
    flush_places,
    note_ended,
};
