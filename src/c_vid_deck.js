/***********************************************************************
 *          c_vid_deck.js
 *
 *      C_VID_DECK — the Player screen: the picture first, the queue
 *      below it.
 *
 *      The top of the screen is the player block: the stage the one
 *      <video> element is docked into, the scrub bar, and the
 *      transport. It is built ONCE and updated in place — the element
 *      inside it must never be thrown away with a repaint — and it does
 *      not scroll: only the queue does. What is playing is never
 *      something you scroll back up to find.
 *
 *      Under the picture: the title, what the name said about it, and,
 *      when the video was RESUMED, the second it came back at with a
 *      "start over" next to it. A video that silently starts at 1:12:40
 *      looks like a broken file to somebody who did not expect it.
 *
 *      Then the queue, which is the deck: what you put together, in the
 *      order you want it, saved as a list or not, and whether it has
 *      been changed since it was saved.
 *
 *      Every control sends an event to this gobj; the actions do the
 *      work. The scrub bar is the one exception, on purpose: while a
 *      finger drags it, the bar and the clock follow the finger as
 *      plain widget plumbing, and the seek itself is ONE event, sent
 *      when the finger lets go.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    SDATA, SDATA_END, data_type_t,
    gclass_create, log_error,
    gobj_parent,
    gobj_read_attr, gobj_read_pointer_attr, gobj_write_attr,
    gobj_subscribe_event, gobj_send_event,
    createElement2, refresh_language,
} from "@yuneta/gobj-js";

import {yui_shell_of, yui_shell_navigate} from "@yuneta/gobj-ui/src/c_yui_shell.js";

import {
    subscribe, sounding, temp_track, temp_position, back_to_deck,
    queue_tracks, queue_index, queue_origin, queue_play_at, queue_move,
    queue_remove_at, queue_clear, toggle, step, prev, seek_by,
    seek_fraction, progress, fmt_time, facts_of, dock_video, get_video,
    RATES, set_rate, get_rate, subtitle_tracks, current_subtitle,
    set_subtitle, resumed, start_over, forget_resumed, store_state,
    clear_notice, find_uid, has_library, store_deck, NOTICE_I18N_KEYS,
} from "./video_store.js";
import {
    subscribe_sources, pending_authorisation, authorize_all,
} from "./sources_store.js";
import {save_queue_as} from "./playlists_store.js";
import {subscribe_stats, watched_fraction} from "./stats_store.js";
import {subscribe_thumbs} from "./thumbs.js";
import {subscribe_update, is_stale, latest_version} from "./update_check.js";
import {
    subscribe_install, install_bar_due, dismiss_install_bar,
} from "./install_prompt.js";
import {open_install} from "./install_dialog.js";
import {open_card, card_action} from "./video_card.js";
import {thumb_button, meta_line, watched_bar} from "./rows.js";
import {toggle_fullscreen, toggle_pip, pip_supported, in_fullscreen} from "./screen.js";
import {sub_label} from "./sub_label.js";
import {count_pair} from "./plural.js";
import {P, svg, seek10, ico, named, rename, clear, set_text, disabled_if} from "./ui.js";

import {t} from "i18next";


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_VID_DECK";

const DECK_ROUTE = "/player";

/*  "Resumed at 12:34" stays up until the video has gone this far past
    that point, or another video starts. */
const RESUMED_FOR_S = 20;


/***************************************************************
 *              Attrs
 ***************************************************************/
const attrs_table = [
SDATA(data_type_t.DTP_POINTER,  "subscriber",  0,  null,  "Subscriber of output events"),
SDATA(data_type_t.DTP_STRING,   "title",       0,  "",    "Human title of the view"),
SDATA(data_type_t.DTP_POINTER,  "$container",  0,  null,  "Root HTMLElement (shell contract)"),
SDATA_END()
];

let PRIVATE_DATA = {
    unsubs:     [],
    $player:    null,
    $stage:     null,
    $scrub:     null,
    $transport: null,
    $meta:      null,
    $bars:      null,
    $queue:     null,
    dragging:   false,
    maxq:       false,
    asking_clear: false,
    saving:     false,
    on_deck:    false,
};

let __gclass__ = null;




                    /******************************
                     *      Framework Methods
                     ******************************/




/***************************************************************
 *          Framework Method: Create
 ***************************************************************/
function mt_create(gobj)
{
    /*
     *  CHILD subscription model
     */
    let subscriber = gobj_read_pointer_attr(gobj, "subscriber");
    if(!subscriber) {
        subscriber = gobj_parent(gobj);
    }
    gobj_subscribe_event(gobj, null, {}, subscriber);

    let priv = gobj.priv;
    build(gobj);
    gobj_write_attr(gobj, "$container",
        createElement2(["div", {class: "C_VID_DECK VID_DECK"}, [
            ["div", {class: "VID_DECKCARD"}, [priv.$player, priv.$meta, priv.$bars]],
            priv.$queue
        ]]));
}

/***************************************************************
 *          Framework Method: Start
 ***************************************************************/
function mt_start(gobj)
{
    let priv = gobj.priv;
    const send = (channel) => gobj_send_event(gobj, "EV_STORE", {channel: channel}, gobj);

    priv.asking_clear = false;
    priv.saving = false;
    priv.unsubs = [
        subscribe(send),
        subscribe_sources(() => send("sources")),
        subscribe_stats(() => send("stats")),
        subscribe_thumbs(() => send("thumbs")),
        subscribe_update(() => send("update")),
        subscribe_install(() => send("install")),
    ];
    /*  Fullscreen is the browser's state, and its change is an OS
        notification like any other. */
    let on_fs = () => gobj_send_event(gobj, "EV_STORE", {channel: "fullscreen"}, gobj);
    document.addEventListener("fullscreenchange", on_fs);
    priv.unsubs.push(() => document.removeEventListener("fullscreenchange", on_fs));

    let shell = yui_shell_of(gobj);
    if(shell) {
        gobj_subscribe_event(shell, "EV_LANGUAGE_CHANGED", {}, gobj);
        gobj_subscribe_event(shell, "EV_ROUTE_CHANGED", {}, gobj);
    }
    paint_all(gobj);
}

/***************************************************************
 *          Framework Method: Stop
 ***************************************************************/
function mt_stop(gobj)
{
    let priv = gobj.priv;
    for(const u of priv.unsubs) {
        u();
    }
    priv.unsubs = [];
}

/***************************************************************
 *          Framework Method: Destroy
 ***************************************************************/
function mt_destroy(gobj)
{
    let $c = gobj_read_attr(gobj, "$container");
    if($c && $c.parentNode) {
        $c.parentNode.removeChild($c);
    }
    gobj_write_attr(gobj, "$container", null);
}




                    /***************************
                     *      Local Methods
                     ***************************/




/***************************************************************
 *  The player block, built once.
 ***************************************************************/
function build(gobj)
{
    let priv = gobj.priv;
    const send = (ev, kw) => () => gobj_send_event(gobj, ev, kw || {}, gobj);
    const tbtn = (cls, key, icon, ev, kw) =>
        ["button", {class: "VID_TBTN " + cls, type: "button", ...named(key)}, icon,
            {click: send(ev, kw)}];

    priv.$stage = createElement2(
        ["div", {class: "VID_STAGE is-empty"}, [
            ["div", {class: "VID_STAGE_EMPTY"}, []],
            ["span", {class: "VID_BIGPLAY", "aria-hidden": "true"}, svg(P.play, 56)]
        ], {
            click: (ev) => {
                if(ev.target.closest(".VID_STAGE_EMPTY")) {
                    return;
                }
                gobj_send_event(gobj, "EV_TOGGLE_PLAY", {}, gobj);
            },
            dblclick: send("EV_FULLSCREEN")
        }]
    );

    priv.$scrub = createElement2(
        ["div", {class: "VID_SCRUB", role: "slider", tabindex: "0",
                 "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": "0",
                 ...named("position")}, [
            ["i", {class: "VID_SCRUB_FILL"}],
            ["i", {class: "VID_SCRUB_WATCH"}],
            ["span", {class: "VID_SCRUB_CLOCK"}, [
                ["span", {class: "VID_SCRUB_CUR"}, "0:00"],
                ["span", {class: "VID_SCRUB_DUR"}, "0:00"]
            ]]
        ]]
    );
    wire_scrub(gobj, priv.$scrub);

    priv.$transport = createElement2(
        ["div", {class: "VID_TRANSPORT"}, [
            ["div", {class: "VID_TGROUP VID_TMAIN"}, [
                tbtn("VID_TPREV", "previous", svg(P.prev, 24), "EV_PREV"),
                tbtn("VID_TBACK", "back 10 seconds", seek10(-1, 26), "EV_SEEK_BY", {seconds: -10}),
                tbtn("VID_TPLAY is-primary", "play", svg(P.play, 28), "EV_TOGGLE_PLAY"),
                tbtn("VID_TFWD", "forward 10 seconds", seek10(1, 26), "EV_SEEK_BY", {seconds: 10}),
                tbtn("VID_TNEXT", "next", svg(P.next, 24), "EV_NEXT")
            ]],
            ["div", {class: "VID_TGROUP VID_TSIDE"}, [
                ["label", {class: "VID_TSELECT VID_RATE"}, [
                    ["span", {class: "VID_ICO"}, svg(P.speed, 18)],
                    ["select", {class: "VID_RATE_SEL", ...named("speed")},
                        RATES.map((r) => ["option", {value: String(r)}, r + "×"]),
                        {change: (ev) => gobj_send_event(gobj, "EV_SET_RATE",
                            {rate: Number(ev.currentTarget.value)}, gobj)}]
                ]],
                ["label", {class: "VID_TSELECT VID_SUBS"}, [
                    ["span", {class: "VID_ICO"}, svg(P.cc, 18)],
                    ["select", {class: "VID_SUBS_SEL", ...named("subtitles")}, [],
                        {change: (ev) => gobj_send_event(gobj, "EV_SET_SUB",
                            {index: Number(ev.currentTarget.value)}, gobj)}]
                ]],
                tbtn("VID_TMUTE", "mute", svg(P.vol, 20), "EV_TOGGLE_MUTE"),
                tbtn("VID_TPIP", "picture in picture", svg(P.pip, 20), "EV_PIP"),
                tbtn("VID_TFULL", "fullscreen", svg(P.full, 22), "EV_FULLSCREEN")
            ]]
        ]]
    );

    priv.$player = createElement2(["div", {class: "VID_PLAYER"}, [
        priv.$stage, priv.$scrub, priv.$transport
    ]]);
    priv.$meta = createElement2(["div", {class: "VID_DECKMETA"}, []]);
    priv.$bars = createElement2(["div", {class: "VID_BARS"}, []]);
    priv.$queue = createElement2(["div", {class: "VID_QUEUEBOX"}, []]);
}

/*  The scrub bar: a drag is plumbing, its end is an event. */
function wire_scrub(gobj, $scrub)
{
    let priv = gobj.priv;
    const at = (ev) => {
        let r = $scrub.getBoundingClientRect();
        let f = r.width ? (ev.clientX - r.left) / r.width : 0;
        if(getComputedStyle($scrub).direction === "rtl") {
            f = 1 - f;
        }
        return Math.max(0, Math.min(1, f));
    };
    const show = (f) => {
        let p = progress();
        $scrub.querySelector(".VID_SCRUB_FILL").style.width = (f * 100) + "%";
        set_text($scrub, ".VID_SCRUB_CUR", fmt_time(f * p.duration));
    };
    $scrub.addEventListener("pointerdown", function(ev) {
        if(!progress().duration) {
            return;
        }
        priv.dragging = true;
        $scrub.setPointerCapture(ev.pointerId);
        $scrub.classList.add("is-dragging");
        show(at(ev));
    });
    $scrub.addEventListener("pointermove", function(ev) {
        if(priv.dragging) {
            show(at(ev));
        }
    });
    const end = function(ev, cancel) {
        if(!priv.dragging) {
            return;
        }
        priv.dragging = false;
        $scrub.classList.remove("is-dragging");
        if(!cancel) {
            gobj_send_event(gobj, "EV_SEEK", {fraction: at(ev)}, gobj);
        }
    };
    $scrub.addEventListener("pointerup", (ev) => end(ev, false));
    $scrub.addEventListener("pointercancel", (ev) => end(ev, true));
    $scrub.addEventListener("keydown", function(ev) {
        if(ev.key === "ArrowLeft" || ev.key === "ArrowRight") {
            ev.preventDefault();
            ev.stopPropagation();
            let rtl = getComputedStyle($scrub).direction === "rtl";
            let fwd = (ev.key === "ArrowRight") !== rtl;
            gobj_send_event(gobj, "EV_SEEK_BY", {seconds: fwd ? 10 : -10}, gobj);
        }
    });
}

function paint_all(gobj)
{
    dock(gobj);
    paint_stage(gobj);
    paint_transport(gobj);
    paint_time(gobj);
    paint_meta(gobj);
    paint_bars(gobj);
    paint_queue(gobj);
}

/*  The element comes here while this screen is showing. */
function dock(gobj)
{
    let priv = gobj.priv;
    if(priv.on_deck) {
        dock_video(priv.$stage);
    }
}

function paint_stage(gobj)
{
    let priv = gobj.priv;
    let v = sounding();
    let el = get_video();
    priv.$stage.classList.toggle("is-empty", !v);
    priv.$stage.classList.toggle("is-paused", !!v && el.paused);
    let $empty = priv.$stage.querySelector(".VID_STAGE_EMPTY");
    clear($empty);
    if(v) {
        return;
    }
    /*  Nothing cued. Not a dead end: the way to something to watch. */
    let to_library = has_library();
    $empty.appendChild(createElement2(["p", {class: "VID_STAGE_MSG",
        i18n: "nothing in the queue"}, t("nothing in the queue")]));
    let key = to_library ? "go to the library" : "add videos";
    $empty.appendChild(createElement2(
        ["button", {class: "VID_QBTN button is-primary", type: "button", i18n: key, ...named(key)},
            t(key), {click: () => gobj_send_event(gobj, "EV_GO",
                {route: to_library ? "/library" : "/sources"}, gobj)}]));
}

function paint_transport(gobj)
{
    let priv = gobj.priv;
    let el = get_video();
    let v = sounding();
    let playing = !!v && !el.paused;
    let $tr = priv.$transport;

    let $play = $tr.querySelector(".VID_TPLAY");
    $play.innerHTML = "";
    $play.appendChild(createElement2(["span", {class: "VID_ICO"}, svg(playing ? P.pause : P.play, 28)]));
    rename($play, playing ? "pause" : "play");

    let none = !v;
    for(const sel of [".VID_TPREV", ".VID_TBACK", ".VID_TPLAY", ".VID_TFWD", ".VID_TNEXT",
                      ".VID_TMUTE", ".VID_TPIP", ".VID_TFULL"]) {
        $tr.querySelector(sel).disabled = none;
    }

    let $mute = $tr.querySelector(".VID_TMUTE");
    $mute.innerHTML = "";
    $mute.appendChild(createElement2(["span", {class: "VID_ICO"}, svg(el.muted ? P.mute : P.vol, 20)]));
    rename($mute, el.muted ? "unmute" : "mute");

    $tr.querySelector(".VID_TPIP").classList.toggle("is-hidden", !pip_supported());

    let fs = in_fullscreen();
    let $full = $tr.querySelector(".VID_TFULL");
    $full.innerHTML = "";
    $full.appendChild(createElement2(["span", {class: "VID_ICO"}, svg(fs ? P.unfull : P.full, 22)]));
    rename($full, fs ? "exit fullscreen" : "fullscreen");

    let $rate = $tr.querySelector(".VID_RATE_SEL");
    $rate.value = String(get_rate());
    $tr.querySelector(".VID_RATE").classList.toggle("is-on", get_rate() !== 1);

    /*  Subtitles: only when the video has any. Rebuilt when the set
        changes; the options carry their value explicitly, so a
        translated "Off" never reaches the FSM as a choice. */
    let tracks = subtitle_tracks();
    let $subs = $tr.querySelector(".VID_SUBS");
    $subs.classList.toggle("is-hidden", !tracks.length);
    $subs.classList.toggle("is-on", current_subtitle() >= 0);
    let $sel = $tr.querySelector(".VID_SUBS_SEL");
    let sig = tracks.map((s) => s.label).join("|");
    if($sel.__vid_sig !== sig) {
        $sel.__vid_sig = sig;
        clear($sel);
        $sel.appendChild(createElement2(["option", {value: "-1", i18n: "subtitles off"},
            t("subtitles off")]));
        for(const s of tracks) {
            $sel.appendChild(createElement2(["option", {value: String(s.index)}, sub_label(s.label)]));
        }
    }
    $sel.value = String(current_subtitle());
}

function paint_time(gobj)
{
    let priv = gobj.priv;
    if(priv.dragging) {
        return;
    }
    let p = progress();
    let $s = priv.$scrub;
    $s.querySelector(".VID_SCRUB_FILL").style.width = (p.fraction * 100) + "%";
    set_text($s, ".VID_SCRUB_CUR", fmt_time(p.current));
    set_text($s, ".VID_SCRUB_DUR", fmt_time(p.duration));
    $s.setAttribute("aria-valuenow", String(Math.round(p.fraction * 100)));
    $s.setAttribute("aria-valuetext", fmt_time(p.current) + " / " + fmt_time(p.duration));
    $s.classList.toggle("is-off", !p.duration);

    let r = resumed();
    if(r && Math.abs(p.current - r.at) > RESUMED_FOR_S) {
        forget_resumed();
    }
}

function paint_meta(gobj)
{
    let priv = gobj.priv;
    let $m = priv.$meta;
    clear($m);
    let v = sounding();
    const send = (ev) => () => gobj_send_event(gobj, ev, {}, gobj);
    let nodes = [];

    let temp = temp_track();
    if(temp) {
        /*  The deck is waiting; what is on screen came from the
            library. Said here too, with the way back. */
        let at = temp_position();
        nodes.push(["div", {class: "VID_TEMPLINE"}, [
            ["span", {class: "VID_TEMPLABEL", i18n: "temporary list"}, t("temporary list")],
            (at.length > 1) ? ["span", {class: "VID_TEMPPOS"}, `${at.index + 1} / ${at.length}`] : null,
            ["button", {class: "VID_QBTN button is-small VID_BACKDECK", type: "button",
                        i18n: "back to the queue", ...named("back to the queue")},
                t("back to the queue"), {click: send("EV_BACK_TO_DECK")}]
        ].filter(Boolean)]);
    }
    if(v) {
        nodes.push(["button", {class: "VID_DECKTITLE", type: "button", ...named("open the card")},
            v.title, {click: () => gobj_send_event(gobj, "EV_OPEN_CARD", {uid: v.uid}, gobj)}]);
        let facts = facts_of(v);
        if(facts.length) {
            nodes.push(["div", {class: "VID_META"}, facts.map((s) => ["span", {class: "VID_FACT"}, s])]);
        }
        let r = resumed();
        if(r) {
            nodes.push(["div", {class: "VID_RESUMED", role: "status"}, [
                ["span", {i18n: "resumed at"}, t("resumed at")],
                ["b", {}, fmt_time(r.at)],
                ["button", {class: "VID_QBTN button is-small VID_STARTOVER", type: "button",
                            ...named("start over")}, [
                    ico(P.restart, 16),
                    ["span", {class: "VID_QLABEL", i18n: "start over"}, t("start over")]
                ], {click: send("EV_START_OVER")}]
            ]]);
        }
    }
    let st = store_state();
    if(st.notice) {
        nodes.push(["div", {class: "VID_NOTICE", role: "status"}, [
            ["span", {i18n: /* i18n: NOTICE_I18N_KEYS */ st.notice}, t(/* i18n: NOTICE_I18N_KEYS */ st.notice)],
            ["button", {class: "VID_NOTICE_X", type: "button", ...named("close")},
                svg(P.remove, 14), {click: send("EV_CLEAR_NOTICE")}]
        ]]);
    }
    for(const n of nodes) {
        $m.appendChild(createElement2(n));
    }
}

function paint_bars(gobj)
{
    let $b = gobj.priv.$bars;
    clear($b);
    const send = (ev) => () => gobj_send_event(gobj, ev, {}, gobj);
    const bar = (cls, txt, which, buttons) => createElement2(
        ["div", {class: "VID_AUTHBAR " + cls, role: "status"}, [
            ["div", {class: "VID_AUTHBAR_TXT"}, [txt, which].filter(Boolean)]
        ].concat(buttons)]);

    /*  A tab opened before a deploy runs the old bundle until it is
        reloaded; reloading is the user's call, not ours. */
    if(is_stale()) {
        $b.appendChild(bar("VID_UPDBAR",
            ["span", {i18n: "new version"}, t("new version")],
            ["span", {class: "VID_AUTHBAR_WHICH"}, latest_version()],
            [["button", {class: "VID_QBTN button is-primary", type: "button", i18n: "reload",
                         ...named("reload")}, t("reload"), {click: send("EV_RELOAD")}]]));
    }
    /*  Chrome gives the folder back across a launch but not the
        permission on it. The button goes where the user already is. */
    let pending = pending_authorisation();
    if(pending.length) {
        $b.appendChild(bar("VID_PENDBAR",
            ["span", {i18n: "folders need authorising"}, t("folders need authorising")],
            ["span", {class: "VID_AUTHBAR_WHICH"}, pending.map((p) => p.name).join(" · ")],
            [["button", {class: "VID_QBTN button is-primary", type: "button", i18n: "authorise",
                         ...named("authorise")}, t("authorise"), {click: send("EV_AUTHORIZE")}]]));
    }
    /*  Installed is the only way Chrome keeps folder permissions. */
    if(install_bar_due()) {
        $b.appendChild(bar("VID_INSTBAR",
            ["span", {i18n: "install this app"}, t("install this app")],
            ["span", {class: "VID_AUTHBAR_WHICH", i18n: "install so folders stay"},
                t("install so folders stay")],
            [["button", {class: "VID_QBTN button is-primary", type: "button", i18n: "install",
                         ...named("install")}, t("install"), {click: send("EV_INSTALL")}],
             ["button", {class: "VID_NOTICE_X", type: "button", ...named("close")},
                svg(P.remove, 14), {click: send("EV_INSTALL_CLOSE")}]]));
    }
}

/***************************************************************
 *  The queue. Rebuilt whole: it is a list being edited under a
 *  finger, and a cut is the right way for it to change.
 ***************************************************************/
function paint_queue(gobj)
{
    let priv = gobj.priv;
    let $q = priv.$queue;
    let keep = $q.querySelector(".VID_QLIST");
    let scroll = keep ? keep.scrollTop : 0;
    let draft = "";
    let $name = $q.querySelector(".VID_SAVENAME");
    if($name) {
        draft = $name.value;
    }
    clear($q);

    let queue = queue_tracks();
    let qi = queue_index();
    let origin = queue_origin();
    let temp = !!temp_track();
    const send = (ev, kw) => () => gobj_send_event(gobj, ev, kw || {}, gobj);
    let $c = gobj_read_attr(gobj, "$container");
    if($c) {
        $c.classList.toggle("is-maxq", priv.maxq);
    }

    /*  What the deck IS: a saved list (and whether it has been changed
        since), or a queue put together by hand. */
    let origin_line = origin
        ? ["div", {class: "VID_ORIGIN"}, [
            ["span", {i18n: "saved list"}, t("saved list")],
            ["b", {class: "VID_ORIGIN_NAME"}, origin.name],
            origin.edited ? ["span", {class: "VID_EDITED", i18n: "edited"}, t("edited")] : null
          ].filter(Boolean)]
        : ["div", {class: "VID_ORIGIN"}, [
            ["span", {i18n: "queue by hand"}, t("queue by hand")]
          ]];

    let head = ["div", {class: "VID_QHEAD"}, [
        ["div", {class: "VID_QTITLE"}, [
            ["h2", {class: "VID_SECTITLE", i18n: "queue"}, t("queue")],
            ["span", {class: "VID_SECCOUNT VID_T2"}, count_pair(queue.length, "n videos")]
        ]],
        queue.length ? origin_line : null
    ].filter(Boolean)];

    /*  Two ends of one line: what is rare and destroys at the start,
        what is used all the time at the end. */
    let start = [];
    if(priv.asking_clear) {
        start.push(["button", {class: "VID_QBTN button is-danger VID_QCLEAR_YES", type: "button",
                               ...named("clear the queue?")}, [
            ico(P.sweep, 18), ["span", {class: "VID_QLABEL", i18n: "clear the queue?"}, t("clear the queue?")]
        ], {click: send("EV_CLEAR_YES")}]);
        start.push(["button", {class: "VID_QBTN button VID_QCLEAR_NO", type: "button", i18n: "cancel",
                               ...named("cancel")}, t("cancel"), {click: send("EV_CLEAR_NO")}]);
    } else if(priv.saving) {
        start.push(["input", {class: "input VID_SAVENAME", type: "text", value: draft,
                              ...named("list name"), placeholder: t("list name"),
                              "data-i18n-placeholder": "list name"}, [],
            {keydown: (ev) => {
                if(ev.key === "Enter") {
                    gobj_send_event(gobj, "EV_SAVE_YES", {name: ev.currentTarget.value}, gobj);
                } else if(ev.key === "Escape") {
                    gobj_send_event(gobj, "EV_SAVE_NO", {}, gobj);
                }
            }}]);
        start.push(["button", {class: "VID_QBTN button is-primary VID_SAVE_YES", type: "button",
                               i18n: "save", ...named("save")}, t("save"),
            {click: () => gobj_send_event(gobj, "EV_SAVE_YES",
                {name: $q.querySelector(".VID_SAVENAME").value}, gobj)}]);
        start.push(["button", {class: "VID_QBTN button", type: "button", i18n: "cancel",
                               ...named("cancel")}, t("cancel"), {click: send("EV_SAVE_NO")}]);
    } else if(queue.length) {
        start.push(["button", {class: "VID_QBTN button VID_QCLEAR", type: "button",
                               ...named("clear the queue")}, [
            ico(P.sweep, 18), ["span", {class: "VID_QLABEL is-hidden-mobile", i18n: "clear the queue"},
                t("clear the queue")]
        ], {click: send("EV_CLEAR_ASK")}]);
        /*  Nothing to save while the deck IS a saved list, untouched. */
        let saved = !!origin && !origin.edited;
        start.push(["button", {class: "VID_QBTN button VID_QSAVE", type: "button",
                               ...named("save as list"), ...disabled_if(saved)}, [
            ico(P.save, 18), ["span", {class: "VID_QLABEL is-hidden-mobile", i18n: "save as list"},
                t("save as list")]
        ], {click: send("EV_SAVE_ASK")}]);
    }
    let end = [];
    if(queue.length) {
        let key = priv.maxq ? "show the player" : "whole queue";
        end.push(["button", {class: "VID_QBTN button is-primary VID_MAXQ", type: "button",
                             ...named(key)}, [
            ico(priv.maxq ? P.minq : P.maxq, 18),
            ["span", {class: "VID_QLABEL", i18n: key}, t(key)]
        ], {click: send("EV_MAXQ")}]);
    }
    let actions = ["div", {class: "VID_QLINE" + (priv.asking_clear || priv.saving ? " is-asking" : "")}, [
        ["div", {class: "VID_QSTART"}, start],
        ["div", {class: "VID_QEND"}, end]
    ]];

    let rows = queue.map(function(v, i) {
        let playing = (i === qi) && !temp;
        let bar = watched_bar(v);
        const kw = {uid: v.uid};
        return ["div", {class: "VID_ROW VID_QROW" + (playing ? " is-playing" : "")}, [
            thumb_button(gobj, v, "EV_PLAY_AT"),
            ["div", {class: "VID_ROWBODY"}, [
                ["button", {class: "VID_NAME", type: "button", ...named("open the card")},
                    v.title, {click: send("EV_OPEN_CARD", kw)}],
                meta_line(v),
                bar
            ].filter(Boolean)],
            ["div", {class: "VID_ROWBTNS"}, [
                ["button", {class: "VID_IBTN VID_UP", type: "button", ...named("move up"),
                            ...disabled_if(i === 0)},
                    svg(P.up, 18), {click: send("EV_MOVE", {uid: v.uid, dir: -1})}],
                ["button", {class: "VID_IBTN VID_DOWN", type: "button", ...named("move down"),
                            ...disabled_if(i === queue.length - 1)},
                    svg(P.down, 18), {click: send("EV_MOVE", {uid: v.uid, dir: 1})}],
                ["button", {class: "VID_IBTN VID_REMOVE", type: "button", ...named("remove from queue")},
                    svg(P.remove, 18), {click: send("EV_REMOVE", kw)}]
            ]]
        ]];
    });
    if(!queue.length) {
        rows.push(["p", {class: "VID_EMPTY", i18n: "queue empty help"}, t("queue empty help")]);
    }

    for(const n of [head, actions, ["div", {class: "VID_QLIST"}, rows]]) {
        $q.appendChild(createElement2(n));
    }
    let $list = $q.querySelector(".VID_QLIST");
    if($list) {
        $list.scrollTop = scroll;
    }
}

function index_of_uid(uid)
{
    return queue_tracks().findIndex((v) => v.uid === uid);
}




                    /***************************
                     *      Actions
                     ***************************/




function ac_store(gobj, event, kw, src)
{
    switch(kw.channel) {
        case "time":
            paint_time(gobj);
            break;
        case "playing":
        case "subs":
        case "fullscreen":
            paint_stage(gobj);
            paint_transport(gobj);
            paint_time(gobj);
            paint_meta(gobj);
            break;
        case "temp":
            dock(gobj);
            paint_all(gobj);
            break;
        case "queue":
        case "stats":
        case "thumbs":
            paint_queue(gobj);
            paint_stage(gobj);
            break;
        case "library":
            paint_meta(gobj);
            paint_stage(gobj);
            paint_queue(gobj);
            break;
        case "sources":
        case "update":
        case "install":
            paint_bars(gobj);
            break;
        default:
            break;
    }
    return 0;
}

function ac_route_changed(gobj, event, kw, src)
{
    let priv = gobj.priv;
    let route = (kw && (kw.base || kw.route)) || "";
    priv.on_deck = (route === DECK_ROUTE);
    if(!priv.on_deck) {
        /*  A question left standing must not be standing minutes later
            where the plain button was. */
        priv.asking_clear = false;
        priv.saving = false;
        return 0;
    }
    paint_all(gobj);
    return 0;
}

function ac_language_changed(gobj, event, kw, src)
{
    let $c = gobj_read_attr(gobj, "$container");
    let $sel = $c.querySelector(".VID_SUBS_SEL");
    if($sel) {
        $sel.__vid_sig = null;
    }
    paint_all(gobj);
    refresh_language($c, t);
    return 0;
}

function ac_toggle_play(gobj, event, kw, src)
{
    toggle();
    return 0;
}

function ac_prev(gobj, event, kw, src)
{
    prev();
    return 0;
}

function ac_next(gobj, event, kw, src)
{
    step(1);
    return 0;
}

function ac_seek_by(gobj, event, kw, src)
{
    seek_by(Number(kw.seconds) || 0);
    return 0;
}

function ac_seek(gobj, event, kw, src)
{
    seek_fraction(Number(kw.fraction) || 0);
    return 0;
}

function ac_set_rate(gobj, event, kw, src)
{
    set_rate(kw.rate);
    return 0;
}

function ac_set_sub(gobj, event, kw, src)
{
    set_subtitle(Number(kw.index));
    return 0;
}

function ac_toggle_mute(gobj, event, kw, src)
{
    let el = get_video();
    el.muted = !el.muted;
    paint_transport(gobj);
    return 0;
}

function ac_fullscreen(gobj, event, kw, src)
{
    toggle_fullscreen();
    return 0;
}

function ac_pip(gobj, event, kw, src)
{
    toggle_pip();
    return 0;
}

function ac_start_over(gobj, event, kw, src)
{
    start_over();
    return 0;
}

function ac_back_to_deck(gobj, event, kw, src)
{
    back_to_deck();
    return 0;
}

function ac_play_at(gobj, event, kw, src)
{
    let i = index_of_uid(kw.uid);
    if(i < 0) {
        log_error(`${GCLASS_NAME}: video not in the queue: ${kw.uid}`);
        return -1;
    }
    queue_play_at(i);
    return 0;
}

function ac_move(gobj, event, kw, src)
{
    let i = index_of_uid(kw.uid);
    if(i < 0) {
        log_error(`${GCLASS_NAME}: video not in the queue: ${kw.uid}`);
        return -1;
    }
    queue_move(i, i + (kw.dir < 0 ? -1 : 1));
    return 0;
}

function ac_remove(gobj, event, kw, src)
{
    let i = index_of_uid(kw.uid);
    if(i < 0) {
        log_error(`${GCLASS_NAME}: video not in the queue: ${kw.uid}`);
        return -1;
    }
    queue_remove_at(i);
    return 0;
}

function ac_clear_ask(gobj, event, kw, src)
{
    gobj.priv.asking_clear = true;
    gobj.priv.saving = false;
    paint_queue(gobj);
    return 0;
}

function ac_clear_yes(gobj, event, kw, src)
{
    gobj.priv.asking_clear = false;
    queue_clear();
    paint_queue(gobj);
    return 0;
}

function ac_clear_no(gobj, event, kw, src)
{
    gobj.priv.asking_clear = false;
    paint_queue(gobj);
    return 0;
}

function ac_save_ask(gobj, event, kw, src)
{
    gobj.priv.saving = true;
    gobj.priv.asking_clear = false;
    paint_queue(gobj);
    let $in = gobj.priv.$queue.querySelector(".VID_SAVENAME");
    if($in) {
        $in.focus();
    }
    return 0;
}

function ac_save_yes(gobj, event, kw, src)
{
    gobj.priv.saving = false;
    save_queue_as(String(kw.name || "").trim() || t("untitled list"));
    paint_queue(gobj);
    return 0;
}

function ac_save_no(gobj, event, kw, src)
{
    gobj.priv.saving = false;
    paint_queue(gobj);
    return 0;
}

function ac_maxq(gobj, event, kw, src)
{
    gobj.priv.maxq = !gobj.priv.maxq;
    paint_queue(gobj);
    return 0;
}

function ac_open_card(gobj, event, kw, src)
{
    if(!find_uid(kw.uid)) {
        log_error(`${GCLASS_NAME}: no such video: ${kw.uid}`);
        return -1;
    }
    open_card(gobj, kw.uid);
    return 0;
}

function ac_card_action(gobj, event, kw, src)
{
    return card_action(gobj, kw);
}

function ac_clear_notice(gobj, event, kw, src)
{
    clear_notice();
    return 0;
}

/*  Must run inside the click: the browser asks for the permission only
    from a user gesture, and the FSM runs synchronously from it. */
function ac_authorize(gobj, event, kw, src)
{
    authorize_all();
    return 0;
}

/*  The new build is loaded by a reload, and the reload is ours: it waits
    for the deck to be written, for at most a second and a half. */
function ac_reload(gobj, event, kw, src)
{
    const go = () => location.reload();
    Promise.race([
        store_deck(),
        new Promise((resolve) => setTimeout(resolve, 1500))
    ]).then(go, go);
    return 0;
}

function ac_install(gobj, event, kw, src)
{
    open_install(yui_shell_of(gobj));
    return 0;
}

function ac_install_close(gobj, event, kw, src)
{
    dismiss_install_bar();
    return 0;
}

function ac_go(gobj, event, kw, src)
{
    let shell = yui_shell_of(gobj);
    if(shell) {
        yui_shell_navigate(shell, kw.route);
    }
    return 0;
}




/***************************************************************
 *              FSM
 ***************************************************************/
const gmt = {
    mt_create:  mt_create,
    mt_start:   mt_start,
    mt_stop:    mt_stop,
    mt_destroy: mt_destroy
};

function create_gclass(gclass_name)
{
    if(__gclass__) {
        log_error(`GClass ALREADY created: ${gclass_name}`);
        return -1;
    }

    const states = [
        ["ST_IDLE", [
            ["EV_STORE",            ac_store,           null],
            ["EV_LANGUAGE_CHANGED", ac_language_changed, null],
            ["EV_ROUTE_CHANGED",    ac_route_changed,   null],
            ["EV_TOGGLE_PLAY",      ac_toggle_play,     null],
            ["EV_PREV",             ac_prev,            null],
            ["EV_NEXT",             ac_next,            null],
            ["EV_SEEK_BY",          ac_seek_by,         null],
            ["EV_SEEK",             ac_seek,            null],
            ["EV_SET_RATE",         ac_set_rate,        null],
            ["EV_SET_SUB",          ac_set_sub,         null],
            ["EV_TOGGLE_MUTE",      ac_toggle_mute,     null],
            ["EV_FULLSCREEN",       ac_fullscreen,      null],
            ["EV_PIP",              ac_pip,             null],
            ["EV_START_OVER",       ac_start_over,      null],
            ["EV_BACK_TO_DECK",     ac_back_to_deck,    null],
            ["EV_PLAY_AT",          ac_play_at,         null],
            ["EV_MOVE",             ac_move,            null],
            ["EV_REMOVE",           ac_remove,          null],
            ["EV_CLEAR_ASK",        ac_clear_ask,       null],
            ["EV_CLEAR_YES",        ac_clear_yes,       null],
            ["EV_CLEAR_NO",         ac_clear_no,        null],
            ["EV_SAVE_ASK",         ac_save_ask,        null],
            ["EV_SAVE_YES",         ac_save_yes,        null],
            ["EV_SAVE_NO",          ac_save_no,         null],
            ["EV_MAXQ",             ac_maxq,            null],
            ["EV_OPEN_CARD",        ac_open_card,       null],
            ["EV_CARD_ACTION",      ac_card_action,     null],
            ["EV_CLEAR_NOTICE",     ac_clear_notice,    null],
            ["EV_AUTHORIZE",        ac_authorize,       null],
            ["EV_RELOAD",           ac_reload,          null],
            ["EV_INSTALL",          ac_install,         null],
            ["EV_INSTALL_CLOSE",    ac_install_close,   null],
            ["EV_GO",               ac_go,              null]
        ]]
    ];

    const event_types = [
        ["EV_STORE",            0],
        ["EV_LANGUAGE_CHANGED", 0],
        ["EV_ROUTE_CHANGED",    0],
        ["EV_TOGGLE_PLAY",      0],
        ["EV_PREV",             0],
        ["EV_NEXT",             0],
        ["EV_SEEK_BY",          0],
        ["EV_SEEK",             0],
        ["EV_SET_RATE",         0],
        ["EV_SET_SUB",          0],
        ["EV_TOGGLE_MUTE",      0],
        ["EV_FULLSCREEN",       0],
        ["EV_PIP",              0],
        ["EV_START_OVER",       0],
        ["EV_BACK_TO_DECK",     0],
        ["EV_PLAY_AT",          0],
        ["EV_MOVE",             0],
        ["EV_REMOVE",           0],
        ["EV_CLEAR_ASK",        0],
        ["EV_CLEAR_YES",        0],
        ["EV_CLEAR_NO",         0],
        ["EV_SAVE_ASK",         0],
        ["EV_SAVE_YES",         0],
        ["EV_SAVE_NO",          0],
        ["EV_MAXQ",             0],
        ["EV_OPEN_CARD",        0],
        ["EV_CARD_ACTION",      0],
        ["EV_CLEAR_NOTICE",     0],
        ["EV_AUTHORIZE",        0],
        ["EV_RELOAD",           0],
        ["EV_INSTALL",          0],
        ["EV_INSTALL_CLOSE",    0],
        ["EV_GO",               0]
    ];

    __gclass__ = gclass_create(
        gclass_name,
        event_types,
        states,
        gmt,
        0,
        attrs_table,
        PRIVATE_DATA,
        0,
        0,
        0,
        0
    );
    if(!__gclass__) {
        return -1;
    }
    return 0;
}

function register_c_vid_deck()
{
    return create_gclass(GCLASS_NAME);
}

export {register_c_vid_deck};
