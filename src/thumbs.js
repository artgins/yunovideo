/***********************************************************************
 *          thumbs.js
 *
 *      One frame per video — made when its row is first ON SCREEN, and
 *      never again.
 *
 *      A wall of grey rectangles is a poor way to find a film, and a
 *      video file has no cover inside it the way an mp3 has. What it has
 *      is pictures. So one is taken: the video is opened on a hidden
 *      element, muted, sought to a tenth of the way in (the first frame
 *      of most things is black, a logo or a title card), drawn onto a
 *      canvas and kept as a small JPEG.
 *
 *      That is not free — it opens the file and decodes a frame — so it
 *      is done the way yunomúsica reads a tag: only when it has to be.
 *
 *        - only for a row somebody can SEE: an IntersectionObserver
 *          asks, and a library of two thousand videos costs the twenty
 *          on screen;
 *        - one at a time, newest request first, so the rows just
 *          scrolled to are the ones that fill in;
 *        - once: the frame goes into IndexedDB with what reading it
 *          taught us — the duration, the size of the picture — and
 *          every later launch paints it from there without touching
 *          the file.
 *
 *      Reading a frame is also the first moment the app learns whether
 *      this browser can play the file at all. A container is not a
 *      codec: an .mkv of H.264 plays in Chrome and an .mkv of HEVC may
 *      not, and the name says nothing about which. A file the element
 *      refuses is remembered as such and its row says so, before
 *      anybody presses play and gets a black screen.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    STORE_THUMBS, idb_all, idb_put, idb_del, idb_del_prefix,
} from "./idb.js";
import {
    resolve_file, set_thumb_lookup, key_of, find_video, subscribe, sounding, progress,
    is_sounding,
} from "./video_store.js";
import {log_warning} from "@yuneta/gobj-js";

import {note_duration} from "./stats_store.js";
import {diag} from "./diag.js";


/***************************************************************
 *              Constants
 ***************************************************************/
const WIDTH = 320;
const QUALITY = 0.72;
/*  A file that will not give up a frame in this long is not going to:
    a broken file, or a codec the decoder chokes on without saying so. */
const GIVE_UP_MS = 12000;

/*  MEDIA_ERR_SRC_NOT_SUPPORTED: no decoder in this browser for what is
    in the file. The one failure that is a fact about the file. */
const NOT_SUPPORTED = 4;

/*  A read that failed for any other reason is tried again the next time
    its row shows, this many times in a session, and never stored. */
const TRIES = 2;

/*  Boxes registered since the last sweep of the ones no longer on the
    page. */
const SWEEP_EVERY = 200;


/***************************************************************
 *      Pub/sub — one channel, "thumbs".
 ***************************************************************/
const listeners = new Set();

function subscribe_thumbs(fn)
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
            fn("thumbs");
        } catch(e) {
            console.error("thumbs listener failed", e);
        }
    }
}


const S = {
    rows:    new Map(),     // key -> {key, blob, dur, w, h, bad}
    urls:    new Map(),     // key -> object URL, made when first painted
    waiting: [],            // videos asked for, newest last
    asked:   new Set(),     // keys in `waiting` or being read
    boxes:   new Map(),     // key -> Set of elements to paint when ready
    busy:    false,
    observer: null,
    tried:   new Map(),     // key -> failed reads this session (not stored)
    since_sweep: 0,
    made:    0,             // this session, for the diagnostics
    failed:  0,
};


/***************************************************************
 *  Read back at boot: the rows, not the pictures. A blob read
 *  out of IndexedDB is a handle on the disk; its object URL is
 *  made the first time a row asks for it, not for every video
 *  in the library at once.
 ***************************************************************/
async function load_thumbs()
{
    const rows = await idb_all(STORE_THUMBS);
    for(const r of rows) {
        if(r && r.key) {
            S.rows.set(r.key, r);
        }
    }
    set_thumb_lookup(thumb_url);
    /*  "Cannot play here" is a verdict, and the player can overturn it:
        a video that is seen playing is playable, whatever its frame
        read said. */
    subscribe(function(channel) {
        if(channel !== "time") {
            return;
        }
        const v = sounding();
        if(v && is_unplayable(v) && is_sounding() && progress().current > 0) {
            const key = key_of(v);
            S.rows.delete(key);
            idb_del(STORE_THUMBS, key);
            diag("thumb_unbad", {});
            emit();
        }
    });
    emit();
    return S.rows.size;
}

function thumb_url(video)
{
    const key = key_of(video);
    const row = key ? S.rows.get(key) : null;
    if(!row || !row.blob) {
        return null;
    }
    let url = S.urls.get(key);
    if(!url) {
        url = URL.createObjectURL(row.blob);
        S.urls.set(key, url);
    }
    return url;
}

/*  What reading the file taught us, or null if it was never read. */
function thumb_info(video)
{
    const key = key_of(video);
    return (key && S.rows.get(key)) || null;
}

/*  This browser refused the file. */
function is_unplayable(video)
{
    const row = thumb_info(video);
    return !!(row && row.bad);
}


/***************************************************************
 *  Paint a video's picture into `$box`, now if it is known,
 *  or as soon as it is made once the box is on screen.
 ***************************************************************/
function paint_thumb($box, video)
{
    if(!$box || !video) {
        return;
    }
    const url = thumb_url(video);
    if(url) {
        fill($box, url);
        return;
    }
    const key = key_of(video);
    const row = S.rows.get(key);
    if(row) {
        /*  Read before, and it gave no picture: an audio-only file, or
            one this browser cannot decode. Nothing to ask again. */
        $box.classList.toggle("is-bad", !!row.bad);
        return;
    }
    if(++S.since_sweep >= SWEEP_EVERY) {
        sweep();
    }
    let set = S.boxes.get(key);
    if(!set) {
        set = new Set();
        S.boxes.set(key, set);
    }
    set.add($box);
    $box.__vid_video = video;
    observe($box);
}

/***************************************************************
 *  Let go of the boxes that left the page. A box waits here for
 *  its picture, and a picture is made only for a row that came
 *  on screen: a list rebuilt with rows nobody scrolled to would
 *  otherwise keep every old row alive, observed, for good.
 ***************************************************************/
function sweep()
{
    S.since_sweep = 0;
    for(const [key, set] of S.boxes) {
        for(const $box of set) {
            if(!$box.isConnected) {
                set.delete($box);
                if(S.observer) {
                    S.observer.unobserve($box);
                }
            }
        }
        if(!set.size) {
            S.boxes.delete(key);
        }
    }
}

function fill($box, url)
{
    let $img = $box.querySelector("img");
    if(!$img) {
        $img = document.createElement("img");
        $img.alt = "";
        $img.decoding = "async";
        $box.appendChild($img);
    }
    if($img.getAttribute("src") !== url) {
        $img.src = url;
    }
    $box.classList.add("has-thumb");
}

function observe($box)
{
    if(typeof IntersectionObserver === "undefined") {
        want($box.__vid_video);
        return;
    }
    if(!S.observer) {
        S.observer = new IntersectionObserver(function(entries) {
            for(const e of entries) {
                if(e.isIntersecting) {
                    S.observer.unobserve(e.target);
                    want(e.target.__vid_video);
                }
            }
        }, {rootMargin: "200px"});
    }
    S.observer.observe($box);
}

/*  Ask for a video's frame. Newest request first: the rows just
    scrolled into view are the ones the user is looking at. */
function want(video)
{
    const key = key_of(video);
    if(!key || S.rows.has(key) || S.asked.has(key) || (S.tried.get(key) || 0) >= TRIES) {
        return;
    }
    S.asked.add(key);
    S.waiting.push(video);
    pump();
}

async function pump()
{
    if(S.busy) {
        return;
    }
    S.busy = true;
    try {
        while(S.waiting.length) {
            const video = S.waiting.pop();
            await make(video);
        }
    } finally {
        S.busy = false;
    }
}

async function make(video)
{
    const key = key_of(video);
    let file = null;
    try {
        file = await resolve_file(video);
    } catch(e) {
        log_warning(`thumbs: cannot reach ${video.path}: ${(e && e.name) || e}`);
        file = null;
    }
    if(!file) {
        /*  Not authorised yet, or gone. Not a fact about the video, so
            nothing is stored: it is asked again the next time the row
            shows. */
        S.asked.delete(key);
        return;
    }

    const url = URL.createObjectURL(file);
    const el = document.createElement("video");
    el.muted = true;
    el.preload = "auto";
    el.playsInline = true;
    let row = {key: key, blob: null, dur: 0, w: 0, h: 0, bad: false};
    let failure = null;
    try {
        el.src = url;
        await wait(el, "loadedmetadata");
        row.dur = isFinite(el.duration) ? el.duration : 0;
        row.w = el.videoWidth || 0;
        row.h = el.videoHeight || 0;
        if(row.w && row.h) {
            const at = row.dur ? Math.min(Math.max(row.dur * 0.1, 0.5), row.dur / 2, 90) : 0.5;
            el.currentTime = at;
            await wait(el, "seeked");
            row.blob = await frame(el, row.w, row.h);
        }
    } catch(e) {
        failure = (e && e.media_code) || 0;
        S.failed++;
    } finally {
        el.removeAttribute("src");
        el.load();
        URL.revokeObjectURL(url);
    }
    S.asked.delete(key);

    /*  The source went while this was reading: what was learned is
        about a video the library no longer has, and storing it would
        leave rows nobody can reach or erase. */
    if(!find_video(video.source_id, video.path)) {
        S.boxes.delete(key);
        return;
    }

    if(failure !== null) {
        diag("thumb_fail", {code: failure});
        if(failure !== NOT_SUPPORTED) {
            /*  A timeout, a decode or read error: a slow disk, or this
                element starved by the film playing on the other one.
                Not a fact about the file — nothing stored, and it is
                asked again the next time its row shows. */
            S.tried.set(key, (S.tried.get(key) || 0) + 1);
            return;
        }
        /*  4 is "no decoder for this": the file is fine and this
            browser cannot show it. That is remembered, and said. */
        row.bad = true;
    }
    S.rows.set(key, row);
    if(row.blob) {
        S.made++;
    }
    if(row.dur) {
        note_duration(video, row.dur);
    }
    idb_put(STORE_THUMBS, row);

    const boxes = S.boxes.get(key);
    S.boxes.delete(key);
    const pic = thumb_url(video);
    for(const $box of (boxes || [])) {
        if(!$box.isConnected) {
            continue;
        }
        if(pic) {
            fill($box, pic);
        } else {
            $box.classList.toggle("is-bad", row.bad);
        }
    }
    /*  A picture is painted straight into the boxes waiting for it, and a
        length reaches the rows through the stats. Only a refusal is
        news nobody else carries. */
    if(row.bad) {
        emit();
    }
}

function wait(el, name)
{
    return new Promise(function(resolve, reject) {
        /*  `media_code`: the element's MediaError code, -1 for the
            timeout. make() keeps only a NOT_SUPPORTED. */
        const timer = setTimeout(() => {
            done();
            const err = new Error("timeout");
            err.media_code = -1;
            reject(err);
        }, GIVE_UP_MS);
        const ok = () => {
            done();
            resolve();
        };
        const fail = () => {
            done();
            const code = (el.error && el.error.code) || 0;
            const err = new Error("media error " + code);
            err.media_code = code;
            reject(err);
        };
        const done = () => {
            clearTimeout(timer);
            el.removeEventListener(name, ok);
            el.removeEventListener("error", fail);
        };
        el.addEventListener(name, ok);
        el.addEventListener("error", fail);
    });
}

function frame(el, w, h)
{
    const cw = WIDTH;
    const ch = Math.max(1, Math.round(WIDTH * h / w));
    const cv = document.createElement("canvas");
    cv.width = cw;
    cv.height = ch;
    const ctx = cv.getContext("2d");
    ctx.drawImage(el, 0, 0, cw, ch);
    return new Promise((resolve) => cv.toBlob((b) => resolve(b), "image/jpeg", QUALITY));
}


/***************************************************************
 *  A source goes, and its pictures with it. A rescan forgets
 *  only the verdicts "cannot play": a browser updated since may
 *  play them now, and the pictures that were made are still
 *  right.
 ***************************************************************/
function drop_source_thumbs(source_id)
{
    const prefix = source_id + "|";
    /*  What was still to be read for it goes too; a read already under
        way finds its video gone and stores nothing (see make). */
    S.waiting = S.waiting.filter((v) => key_of(v).indexOf(prefix) !== 0);
    for(const key of Array.from(S.asked)) {
        if(key.indexOf(prefix) === 0) {
            S.asked.delete(key);
        }
    }
    for(const [key, set] of Array.from(S.boxes)) {
        if(key.indexOf(prefix) === 0) {
            for(const $box of set) {
                if(S.observer) {
                    S.observer.unobserve($box);
                }
            }
            S.boxes.delete(key);
        }
    }
    for(const key of Array.from(S.rows.keys())) {
        if(key.indexOf(prefix) === 0) {
            S.rows.delete(key);
            const url = S.urls.get(key);
            if(url) {
                URL.revokeObjectURL(url);
                S.urls.delete(key);
            }
        }
    }
    idb_del_prefix(STORE_THUMBS, prefix);
    emit();
}

function forget_bad(source_id)
{
    const prefix = source_id + "|";
    for(const key of Array.from(S.tried.keys())) {
        if(key.indexOf(prefix) === 0) {
            S.tried.delete(key);
        }
    }
    for(const [key, row] of Array.from(S.rows.entries())) {
        if(key.indexOf(prefix) === 0 && row.bad) {
            S.rows.delete(key);
            idb_del(STORE_THUMBS, key);
        }
    }
}

/*  For the black box and the diagnostics: how many, and how heavy. */
function thumbs_held()
{
    let bytes = 0;
    let n = 0;
    let bad = 0;
    for(const row of S.rows.values()) {
        if(row.blob) {
            n++;
            bytes += row.blob.size || 0;
        }
        if(row.bad) {
            bad++;
        }
    }
    return {
        count: n, bad: bad, kb: Math.round(bytes / 1024),
        made: S.made, failed: S.failed, waiting: S.waiting.length,
    };
}


export {
    load_thumbs,
    subscribe_thumbs,
    thumb_url,
    thumb_info,
    is_unplayable,
    paint_thumb,
    drop_source_thumbs,
    forget_bad,
    thumbs_held,
};
