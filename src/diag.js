/***********************************************************************
 *          diag.js
 *
 *      The black box.
 *
 *      Carried over from yunomúsica, where it was built for a bug that
 *      cannot be caught by watching: on a long drive the app stopped and
 *      came back asking for the folders again — a FRESH LAUNCH. Nobody
 *      holds a debugger at that moment, and the framework traces are of
 *      no use either: they live in memory, and whatever killed the app
 *      took them with it. A video player on a phone runs into the same
 *      thing, harder: a film is a much bigger resource than a song.
 *
 *      So the interesting part of the evidence is written down BEFORE
 *      the death, not after it:
 *
 *        - a heartbeat every fifteen seconds, so the last moment the app
 *          was known to be alive is never more than fifteen seconds from
 *          the moment it died — with what was playing, how long it is and
 *          how far in;
 *        - the page-lifecycle events the browser sends on its way to
 *          killing a tab (freeze, pagehide, visibility);
 *        - the JS heap, sampled every five minutes, and the thumbnails
 *          held, which are blobs and are NOT on that heap;
 *        - and, on the next launch, what the browser admits about it:
 *          `document.wasDiscarded` is Chrome saying "I threw that tab
 *          away", and the navigation type separates a discard from a
 *          renderer crash from the user simply reopening the app.
 *
 *      In localStorage and not IndexedDB, for one reason: localStorage
 *      is SYNCHRONOUS. The records that matter most are the last ones,
 *      written while the tab is being frozen, and an IndexedDB write
 *      started there is a promise nobody lives long enough to keep.
 *
 *      Nothing here is on a hot path: a heartbeat is one small write a
 *      quarter of a minute, and the journal is only appended to when
 *      something actually happens.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/

/*  The journal: an array of {t, e, d} — when, what, details. */
const KEY_LOG = "yunovideo_diag";
/*  The heartbeat, on its own key: rewritten constantly, and it must not
    drag the whole journal through JSON.stringify every fifteen seconds. */
const KEY_BEAT = "yunovideo_diag_beat";

/*  Two nights of listening, about. Old entries fall off the front; the
    boot records are what matter and there are only a handful a day. */
const MAX_ENTRIES = 400;

const BEAT_EVERY = 15 * 1000;
const MEM_EVERY = 5 * 60 * 1000;

let started = false;
let beat_timer = null;
let mem_timer = null;

/*  What is playing, asked for rather than imported: video_store records
    INTO this file, so this file cannot import video_store back. */
let probe = null;


                    /******************************
                     *      localStorage, safely
                     ******************************/


/*  Every browser that refuses storage — private windows, "block all
    cookies", an origin without one — throws on ACCESS, not on use. So
    every call is guarded and a refusal simply means no black box, never
    a broken app. */
function ls_get(key)
{
    try {
        return window.localStorage.getItem(key);
    } catch(e) {
        return null;
    }
}

function ls_set(key, value)
{
    try {
        window.localStorage.setItem(key, value);
        return true;
    } catch(e) {
        /*  Quota, most likely. Drop half the journal and try once more:
            a black box that fills up and then stops recording is worse
            than one that forgets the oldest hour. */
        return false;
    }
}


                    /******************************
                     *      The journal
                     ******************************/


function read_journal()
{
    let raw = ls_get(KEY_LOG);
    if(!raw) {
        return [];
    }
    try {
        let arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
    } catch(e) {
        return [];
    }
}

function write_journal(arr)
{
    if(!ls_set(KEY_LOG, JSON.stringify(arr))) {
        /*  Second attempt on half the history — see ls_set. */
        ls_set(KEY_LOG, JSON.stringify(arr.slice(Math.floor(arr.length / 2))));
    }
}

/***************************************************************
 *  Write one line in the journal. `e` is a short tag, `d` an
 *  object of whatever that tag needs. Never throws: a black box
 *  that can break the flight is not a black box.
 ***************************************************************/
function diag(e, d)
{
    try {
        let arr = read_journal();
        arr.push({t: Date.now(), e: e, d: d || {}});
        if(arr.length > MAX_ENTRIES) {
            arr = arr.slice(arr.length - MAX_ENTRIES);
        }
        write_journal(arr);
    } catch(err) {
        /* nothing: the app goes on */
    }
}

function diag_journal()
{
    return read_journal();
}

function diag_clear()
{
    try {
        window.localStorage.removeItem(KEY_LOG);
        window.localStorage.removeItem(KEY_BEAT);
    } catch(e) {
        /* nothing */
    }
}


                    /******************************
                     *      What we can measure
                     ******************************/


/*  Chrome only, and only over http(s) with the right flags in some
    builds — so always optional. In megabytes, because a byte count with
    nine digits is unreadable on a phone. */
function heap_mb()
{
    try {
        let m = window.performance && window.performance.memory;
        if(!m || !m.usedJSHeapSize) {
            return null;
        }
        return Math.round(m.usedJSHeapSize / (1024 * 1024));
    } catch(e) {
        return null;
    }
}

/*  "reload" after a renderer crash, "navigate" on a cold launch,
    "back_forward" out of the page cache. The three read differently and
    the difference is the diagnosis. */
function nav_type()
{
    try {
        let nav = window.performance.getEntriesByType("navigation");
        if(nav && nav.length && nav[0].type) {
            return nav[0].type;
        }
    } catch(e) {
        /* fall through */
    }
    return "?";
}

/*  Installed app or browser tab. It is not a detail: an installed PWA
    keeps its folder permissions across launches on Android and a tab
    does not, and a tab is discarded far more eagerly. */
function standalone()
{
    try {
        if(window.matchMedia("(display-mode: standalone)").matches) {
            return true;
        }
        if(window.matchMedia("(display-mode: fullscreen)").matches) {
            return true;
        }
        return !!window.navigator.standalone;
    } catch(e) {
        return false;
    }
}

/*  How much of the device's memory the browser will admit to, in GB.
    Chrome rounds it down to a power of two and caps it at 8. */
function device_memory()
{
    try {
        return navigator.deviceMemory || null;
    } catch(e) {
        return null;
    }
}


                    /******************************
                     *      The heartbeat
                     ******************************/


/*  The host registers a function that says what the app is doing, so a
    death can be described in the terms the user will use: "it stopped
    while Lady Fantasy was playing". */
function diag_watch(fn)
{
    probe = (typeof fn === "function") ? fn : null;
}

function beat()
{
    let state = {};
    if(probe) {
        try {
            state = probe() || {};
        } catch(e) {
            /*  The probe is the app's; a throw there is its bug. Said in
                the console, not through the logger this box backs up. */
            console.warn("diag: the state probe threw", e);
            state = {};
        }
    }
    let rec = {
        t: Date.now(),
        playing: !!state.playing,
        track: state.track || "",
        heap: heap_mb(),
        /*  The length of what was playing, and how far in. A death two
            hours into one four-hour file reads nothing like a death in
            the third minute of a clip. */
        dur: state.dur || 0,
        pos: state.pos || 0,
        vis: (typeof document !== "undefined") ? document.visibilityState : "?"
    };
    ls_set(KEY_BEAT, JSON.stringify(rec));
}

function last_beat()
{
    let raw = ls_get(KEY_BEAT);
    if(!raw) {
        return null;
    }
    try {
        let rec = JSON.parse(raw);
        return (rec && rec.t) ? rec : null;
    } catch(e) {
        return null;
    }
}


                    /******************************
                     *      Start up
                     ******************************/


/***************************************************************
 *  Called once, as early as main() can call it. Reads what the
 *  PREVIOUS run left behind, writes the boot record that
 *  explains this one, and starts listening.
 ***************************************************************/
function start_diag()
{
    if(started) {
        return;
    }
    started = true;

    /*  What the last run was doing when it stopped writing. A gap of a
        few seconds is a reload the user asked for; a gap of minutes,
        with `playing` true, is the app being killed mid-track — which
        is the whole reason this file exists. */
    let prev = last_beat();
    let d = {
        nav: nav_type(),
        app: standalone() ? "installed" : "tab",
        vis: (typeof document !== "undefined") ? document.visibilityState : "?",
        heap: heap_mb(),
        dev_mem: device_memory(),
        ver: (typeof __APP_VERSION__ !== "undefined") ? __APP_VERSION__ : "?"
    };
    /*  Chrome sets this on the document of a tab it threw away to
        reclaim memory. When it is true there is nothing left to guess:
        the browser discarded the app, and the folder prompt on this
        launch is the consequence, not the fault. */
    if(typeof document !== "undefined" && document.wasDiscarded) {
        d.discarded = true;
    }
    if(prev) {
        d.gap_s = Math.round((Date.now() - prev.t) / 1000);
        d.was_playing = !!prev.playing;
        if(prev.track) {
            d.was_track = prev.track;
        }
        if(prev.heap !== null && prev.heap !== undefined) {
            d.was_heap = prev.heap;
        }
        if(prev.vis) {
            d.was_vis = prev.vis;
        }
        if(prev.dur) {
            d.was_dur = prev.dur;
            d.was_pos = prev.pos || 0;
        }
    }
    diag("boot", d);

    install_listeners();

    beat();
    beat_timer = setInterval(beat, BEAT_EVERY);
    /*  A separate, slower sample kept IN the journal: the heartbeat is
        overwritten, so it can say what the heap is now and never what it
        was an hour ago. A leak is only visible as a curve. */
    mem_timer = setInterval(sample_memory, MEM_EVERY);
    /*  One sample straight away, so a run that is killed before the
        first five minutes are up still leaves a figure behind. */
    sample_memory();
}


/***************************************************************
 *  A memory line in the journal.
 *
 *  Two numbers, because one of them is not enough. `heap` is
 *  the JS heap, which is all the browser will tell us — and
 *  blob bytes are NOT on it. `thumbs` is the pictures held,
 *  counted where it is known: by the store that holds them.
 ***************************************************************/
function sample_memory()
{
    let d = {};
    let mb = heap_mb();
    if(mb !== null) {
        d.heap = mb;
    }
    if(probe) {
        try {
            let state = probe() || {};
            if(state.thumbs) {
                d.thumbs = state.thumbs;
            }
            if(state.thumb_kb) {
                d.thumb_kb = state.thumb_kb;
            }
            if(state.dur) {
                d.dur = state.dur;
                d.pos = state.pos || 0;
            }
        } catch(e) {
            console.warn("diag: the state probe threw", e);
        }
    }
    if(Object.keys(d).length) {
        diag("mem", d);
    }
}


function install_listeners()
{
    if(typeof window === "undefined") {
        return;
    }

    /*  The Page Lifecycle API. `freeze` is Chrome telling the tab it is
        about to be suspended — timers stop, so this is the LAST code
        that runs, and it is one synchronous localStorage write away from
        being recorded. A discard usually follows a freeze. */
    document.addEventListener("freeze", function() {
        diag("freeze", {heap: heap_mb()});
    });
    document.addEventListener("resume", function() {
        diag("resume", {});
        beat();
    });

    /*  pagehide with persisted=true means the page went into the back /
        forward cache and can come back alive; false means it is being
        torn down for good. */
    window.addEventListener("pagehide", function(ev) {
        diag("pagehide", {bfcache: !!ev.persisted, heap: heap_mb()});
    });

    /*  The other half of that pair, and it settles a real ambiguity.
     *
     *  A boot record says a NEW document was built. A `pageshow` with
     *  persisted=true says the OLD one came back out of the back/forward
     *  cache with everything still in it — no boot, no reload, nothing
     *  lost. Without this line the two are told apart only by the
     *  absence of a record, which is not evidence anybody should have to
     *  reason from. */
    window.addEventListener("pageshow", function(ev) {
        if(ev.persisted) {
            diag("restored", {bfcache: true});
            beat();
        }
    });

    document.addEventListener("visibilitychange", function() {
        diag("vis", {state: document.visibilityState});
        /*  Coming back to the front is a good moment to re-mark the
            clock: the timer may have been throttled to nothing while the
            screen was off, which would otherwise look like a death. */
        if(document.visibilityState === "visible") {
            beat();
        }
    });

    /*  An uncaught error is not usually fatal to a tab, but it is
        usually fatal to whatever was in the middle of happening — and if
        one of them lands seconds before a boot record, the order alone
        tells the story. */
    window.addEventListener("error", function(ev) {
        diag("err", {
            msg: String((ev && ev.message) || "?").slice(0, 200),
            at: short_src(ev)
        });
    });
    window.addEventListener("unhandledrejection", function(ev) {
        let r = ev && ev.reason;
        diag("reject", {
            msg: String((r && r.message) || r || "?").slice(0, 200)
        });
    });

    /*  A new service worker taking over mid-session. It does not reload
        this app, and knowing that for certain is worth one line. */
    if(navigator.serviceWorker) {
        navigator.serviceWorker.addEventListener("controllerchange", function() {
            diag("sw", {took_over: true});
        });
    }
}

function short_src(ev)
{
    let f = (ev && ev.filename) || "";
    let i = f.lastIndexOf("/");
    let name = (i >= 0) ? f.slice(i + 1) : f;
    if(!name) {
        return "";
    }
    return name + ":" + ((ev && ev.lineno) || 0);
}


                    /******************************
                     *      Reading it back
                     ******************************/


function pad2(n)
{
    return (n < 10 ? "0" : "") + n;
}

/*  hh:mm:ss on the day it happened — a journal read the morning after a
    trip spans midnight more often than not. */
function diag_time(t)
{
    let d = new Date(t);
    return pad2(d.getDate()) + "/" + pad2(d.getMonth() + 1) + " " +
        pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
}

/***************************************************************
 *  A span of seconds, said the way a person would say it.
 *
 *  "1200 s" is a correct answer to "how long was the video
 *  off?" and a useless one; twenty minutes is the fact. The
 *  units are left untranslated on purpose — s, min and h read
 *  the same in every catalogue this app ships, and a unit is
 *  not worth ten more strings to get one of them wrong.
 ***************************************************************/
function diag_duration(seconds)
{
    let s = Math.max(0, Math.round(seconds || 0));
    if(s < 120) {
        return s + " s";
    }
    let m = Math.round(s / 60);
    if(m < 90) {
        return m + " min";
    }
    let h = Math.floor(m / 60);
    return h + " h " + (m - h * 60) + " min";
}

/*  One journal line as text: the same thing the panel shows and the
    same thing the clipboard gets, so a screenshot and a paste never
    disagree. */
function diag_line(rec)
{
    let parts = [diag_time(rec.t), rec.e];
    let d = rec.d || {};
    for(const k of Object.keys(d)) {
        let v = d[k];
        if(v === null || v === undefined || v === "" || v === false) {
            continue;
        }
        parts.push(k + "=" + (v === true ? "yes" : String(v)));
    }
    return parts.join(" ");
}

/***************************************************************
 *  The whole journal as text, with a header naming the build
 *  and the device. This is what gets copied and sent.
 ***************************************************************/
function diag_report()
{
    let head = [
        "yunovídeo diagnostic log",
        "build: " + ((typeof __APP_VERSION__ !== "undefined") ? __APP_VERSION__ : "?") +
            " · " + ((typeof __BUILD_STAMP__ !== "undefined") ? __BUILD_STAMP__ : "?"),
        "mode: " + (standalone() ? "installed" : "browser tab"),
        "device memory: " + (device_memory() || "?") + " GB",
        "agent: " + ((typeof navigator !== "undefined") ? navigator.userAgent : "?"),
        "copied: " + diag_time(Date.now()),
        ""
    ];
    return head.concat(read_journal().map(diag_line)).join("\n");
}

/***************************************************************
 *  Was a boot a DEATH, or just a launch?
 *
 *  The difference is the whole value of the panel. Every reload
 *  leaves a boot record with a gap in it, and a verdict that
 *  called each one an unexpected stop would cry wolf on every
 *  refresh — which is worse than saying nothing, because the
 *  one real stop would arrive looking like the other twenty.
 *
 *  Two thresholds, and both come from how the browser behaves
 *  rather than from taste:
 *
 *    - a HIDDEN tab has its timers throttled to about one a
 *      minute, so a heartbeat can legitimately be a minute
 *      late. Under ninety seconds proves nothing;
 *
 *    - a tab that is PLAYING AUDIO is not throttled and not
 *      frozen — that is the point of the audible state — so
 *      while a video was playing, three quarters of a minute of
 *      silence from the heartbeat is already the app not
 *      running.
 *
 *  And `wasDiscarded` needs no threshold at all: it is the
 *  browser stating what it did.
 ***************************************************************/
const DEAD_GAP = 90;                // hidden and throttled: believe nothing sooner
const DEAD_GAP_PLAYING = 45;        // audible tabs run at full speed

function looks_like_death(d)
{
    if(d.gap_s === undefined) {
        return false;               // nothing before it to compare against
    }
    if(d.discarded) {
        return true;
    }
    if(d.was_playing && d.gap_s >= DEAD_GAP_PLAYING) {
        return true;
    }
    return d.gap_s >= DEAD_GAP;
}

/***************************************************************
 *  The one sentence worth putting at the top of the panel: the
 *  most recent launch that was NOT asked for.
 *
 *  Returns null when there is nothing to say — the first launch
 *  ever, a journal that was just cleared, or a history of
 *  ordinary reloads, which is the answer everybody hopes for.
 ***************************************************************/
function diag_last_death()
{
    let arr = read_journal();
    for(let i = arr.length - 1; i >= 0; i--) {
        let rec = arr[i];
        if(rec.e !== "boot") {
            continue;
        }
        let d = rec.d || {};
        if(!looks_like_death(d)) {
            continue;
        }
        return {
            t: rec.t,
            discarded: !!d.discarded,
            nav: d.nav || "?",
            gap_s: d.gap_s,
            was_playing: !!d.was_playing,
            was_track: d.was_track || "",
            was_heap: (d.was_heap === undefined) ? null : d.was_heap
        };
    }
    return null;
}

/*  How many of the launches in the last `hours` hours were deaths. The
    user counted "two or three" over four hours; this is the app
    counting the same thing, and the two numbers are worth comparing. */
function diag_death_count(hours)
{
    let since = Date.now() - (hours || 24) * 3600 * 1000;
    return read_journal().filter(
        (r) => r.e === "boot" && r.t >= since && looks_like_death(r.d || {})).length;
}

/*  How many times the app started, in the last `hours` hours. Two or
    three of these in an afternoon is the bug the user reported, stated
    as a number instead of as a memory. */
function diag_boot_count(hours)
{
    let since = Date.now() - (hours || 24) * 3600 * 1000;
    return read_journal().filter((r) => r.e === "boot" && r.t >= since).length;
}


export {
    start_diag,
    diag,
    diag_watch,
    diag_journal,
    diag_line,
    diag_time,
    diag_duration,
    diag_report,
    diag_clear,
    diag_last_death,
    diag_death_count,
    diag_boot_count,
};
