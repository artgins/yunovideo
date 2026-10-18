/***********************************************************************
 *          rescan.mjs
 *
 *      A rescan reads a folder again and the library gets new objects
 *      for its videos. The deck must come out of it as it went in:
 *      same videos, same order, same one cued, playing on — only what
 *      left the folder leaves the deck. It used to be stripped of that
 *      source's videos, stop the one playing, and, left empty, be
 *      refilled with the whole folder in walk order.
 *
 *      In node, against video_store itself: the rescan is reachable
 *      only through a folder handle (File System Access), which no
 *      test browser hands over. The <video> is a stand-in.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/

/*  Just enough of a document for one media element. */
function fake_video()
{
    const attrs = {};
    return {
        paused: true, ended: false, currentTime: 0, duration: 60, error: null,
        style: {}, textTracks: [],
        addEventListener() {}, removeEventListener() {},
        appendChild() {}, removeChild() {},
        setAttribute(k, v) { attrs[k] = String(v); },
        getAttribute(k) { return (k in attrs) ? attrs[k] : null; },
        removeAttribute(k) { delete attrs[k]; },
        set src(v) { attrs.src = v; }, get src() { return attrs.src || ""; },
        load() {}, pause() { this.paused = true; },
        play() { this.paused = false; return Promise.resolve(); },
    };
}
globalThis.document = {
    createElement: (tag) => (tag === "video" ? fake_video()
        : {style: {}, setAttribute() {}, appendChild() {}, className: ""}),
    body: {appendChild() {}},
};

const V = await import("../src/video_store.js");

let failures = 0;
function check(ok, what)
{
    console.log((ok ? "ok    " : "FAIL  ") + what);
    if(!ok) {
        failures++;
    }
}

const file = (path) => {
    const f = new File([new Uint8Array(8)], path.split("/").pop(), {type: "video/webm"});
    Object.defineProperty(f, "webkitRelativePath", {value: path});
    return f;
};
const paths = (list) => list.map((v) => v.path.split("/").pop());

await V.ingest([file("F/a.webm"), file("F/b.webm"), file("F/c.webm"), file("F/d.webm")], "S1");
await V.ingest([file("G/x.webm")], "S2");

/*  A deck put together by hand, out of folder order, with another
    source in it, playing its third entry. */
V.queue_add([V.find_video("S1", "F/c.webm"), V.find_video("S2", "G/x.webm"),
             V.find_video("S1", "F/a.webm"), V.find_video("S1", "F/b.webm")], "append");
V.queue_play_at(2);
await new Promise((r) => setTimeout(r, 10));
const playing_before = V.sounding();
check(paths(V.queue_tracks()).join() === "c.webm,x.webm,a.webm,b.webm" && playing_before.path === "F/a.webm",
      "before: a deck by hand, playing a.webm");

/*  The rescan: b.webm was deleted from the folder, e.webm added. */
V.unlist_source_tracks("S1");
await V.ingest([file("F/a.webm"), file("F/c.webm"), file("F/d.webm"), file("F/e.webm")], "S1");
V.relink_source("S1");

const q = V.queue_tracks();
check(paths(q).join() === "c.webm,x.webm,a.webm",
      `after: same order, only the deleted one gone: ${paths(q).join()}`);
check(V.queue_index() === 2 && V.sounding().path === "F/a.webm",
      "the same video is still the one on the deck");
check(V.sounding() !== playing_before && V.find_uid(V.sounding().uid) === V.sounding(),
      "and it is the library's new object, found by its uid");
check(q.every((v) => V.find_uid(v.uid) === v), "every entry is a video the library has");
check(V.queue_length() === 3, "nothing was added: the folder was not poured onto the deck");

/*  The video playing is deleted too. */
V.unlist_source_tracks("S1");
await V.ingest([file("F/c.webm"), file("F/d.webm")], "S1");
V.relink_source("S1");
check(paths(V.queue_tracks()).join() === "c.webm,x.webm", "a video deleted while on the deck leaves it");
check(V.queue_index() === 1, `and the deck stays where it was: ${V.queue_index()}`);

console.log("=== ERRORS (0) ===");
process.exit(failures ? 1 : 0);
