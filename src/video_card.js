/***********************************************************************
 *          video_card.js
 *
 *      The card of one video: what the name opens.
 *
 *      It exists because of the title, as yunomúsica's does: a row gives
 *      a name one ellipsised line, and a film's name is longer than
 *      that. Here it is the heading, it wraps, and it is the one string
 *      with no ellipsis anywhere near it. Under it, everything the app
 *      knows: what the name was read as (show, season, episode, year),
 *      the FILE name itself — the guess is shown next to what it was
 *      made from —, where it lives, how big and how long it is, the
 *      size of the picture, the subtitles found beside it, and whether
 *      this browser can play it at all.
 *
 *      Then the numbers, with the buttons that change them next to
 *      them: how often it was watched, how many hearts, and where it
 *      was left — each erasable from here, the place that shows it.
 *
 *      The card does not act on its own. Its buttons send
 *      EV_CARD_ACTION to the gobj that opened it, and that gobj's FSM
 *      hands the kw to card_action() below.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {createElement2, refresh_language, gobj_send_event, log_error} from "@yuneta/gobj-js";
import {
    yui_shell_register_overlay,
    yui_shell_overlay_dismissed,
    yui_shell_push_escape,
    yui_shell_pop_escape,
    yui_shell_of,
} from "@yuneta/gobj-ui/src/c_yui_shell.js";

import {
    find_uid, facts_of, fmt_time, queue_add, play_temp,
} from "./video_store.js";
import {
    stats_of, subscribe_stats, heart, stats_reset, forget_place,
} from "./stats_store.js";
import {thumb_info, thumb_url, is_unplayable} from "./thumbs.js";
import {source_name} from "./sources_store.js";
import {P, svg, named, clear} from "./ui.js";
import {sub_label} from "./sub_label.js";
import {count_noun} from "./plural.js";

import {t} from "i18next";


let $open = null;
let overlay = null;
let opener = null;
let uid_open = 0;
let unsub = null;
let shape = "";         // what the card shows, but the place: see card_shape
/*  Escape is the shell's to route (its own stack, LIFO): the card asks
    for it while it is up and gives it back when it goes. */
let on_escape = null;


function open_card(gobj, uid)
{
    const v = find_uid(uid);
    if(!v) {
        return;
    }
    close_card();
    opener = gobj;
    uid_open = uid;

    const $card = createElement2(["div", {class: "VID_CARD", role: "dialog", "aria-modal": "true"}, []]);
    const $backdrop = createElement2(
        ["div", {class: "VID_ABOUT_BACKDROP VID_CARD_BACKDROP"}, [$card], {
            click: (ev) => {
                if(ev.target === ev.currentTarget) {
                    send("close");
                }
            }
        }]
    );
    document.body.appendChild($backdrop);
    $open = $backdrop;
    const shell = yui_shell_of(gobj);
    overlay = shell ? yui_shell_register_overlay(shell, () => close_card(true)) : null;
    if(shell) {
        on_escape = () => send("close");
        yui_shell_push_escape(shell, "modal", on_escape, () => close_card(true));
    }
    /*  The numbers move while a video plays: the news enters the
        opener's machine like a button press, and card_action() answers. */
    unsub = subscribe_stats(() => send("stats"));
    paint();
    const $close = $backdrop.querySelector(".VID_CARD_CLOSE");
    if($close) {
        $close.focus();
    }
}

function send(act)
{
    if(opener) {
        gobj_send_event(opener, "EV_CARD_ACTION", {act: act, uid: uid_open}, opener);
    }
}

function close_card(from_history)
{
    if(!$open) {
        return;
    }
    if($open.parentNode) {
        $open.parentNode.removeChild($open);
    }
    $open = null;
    if(unsub) {
        unsub();
        unsub = null;
    }
    const shell = opener ? yui_shell_of(opener) : null;
    if(shell && on_escape) {
        yui_shell_pop_escape(shell, on_escape);
    }
    on_escape = null;
    if(overlay && !from_history && shell) {
        yui_shell_overlay_dismissed(shell, overlay);
    }
    overlay = null;
    opener = null;
    uid_open = 0;
}

function size_of(bytes)
{
    if(!bytes) {
        return "";
    }
    if(bytes >= 1073741824) {
        return (bytes / 1073741824).toFixed(2) + " GB";
    }
    return Math.round(bytes / 1048576) + " MB";
}

function line(key, value)
{
    if(!value && value !== 0) {
        return null;
    }
    return ["div", {class: "VID_CARD_LINE"}, [
        ["span", {class: "VID_CARD_K", i18n: key}, t(key)],
        ["span", {class: "VID_CARD_V"}, String(value)]
    ]];
}

function button(cls, key, path, act, extra)
{
    return ["button", {class: "VID_QBTN button " + cls + (extra || ""), type: "button",
                       "data-act": act, ...named(key)}, [
        ["span", {class: "VID_ICO"}, svg(path, 18)],
        ["span", {class: "VID_QLABEL", i18n: key}, t(key)]
    ], {click: () => send(act)}];
}

/*  Everything the card shows but the place, which moves every ten
    seconds while this video plays and is written in place. */
function card_shape(v)
{
    const info = thumb_info(v) || {};
    const st = stats_of(v);
    return JSON.stringify([
        st.views, st.full, st.hearts, !!st.pos, info.dur || st.dur || 0,
        is_unplayable(v), thumb_url(v), info.w || 0, info.h || 0,
    ]);
}

/*  The numbers moved. A rebuild only when more than the place did,
    and then the focus goes back to the button that had it: pressing
    "give a heart" must leave the finger, and a reader, on it. */
function refresh()
{
    const v = find_uid(uid_open);
    if(!$open || !v) {
        log_error("video_card: refresh with no card open");
        return;
    }
    if(card_shape(v) !== shape) {
        const $had = document.activeElement;
        const act = ($had && $open.contains($had)) ? $had.getAttribute("data-act") : null;
        paint();
        const $back = act ? $open.querySelector(`[data-act="${act}"]:not(.is-hidden)`) : null;
        const $to = $back || ((act !== null) ? $open.querySelector(".VID_CARD_CLOSE") : null);
        if($to) {
            $to.focus();
        }
        return;
    }
    const st = stats_of(v);
    const $at = $open.querySelector(".VID_CARD_LEFTAT b");
    if($at) {
        $at.textContent = st.pos ? fmt_time(st.pos) : "—";
    }
}

function paint()
{
    const v = find_uid(uid_open);
    if(!$open || !v) {
        return;
    }
    const $card = $open.querySelector(".VID_CARD");
    clear($card);
    shape = card_shape(v);

    const info = thumb_info(v) || {};
    const st = stats_of(v);
    const dur = info.dur || st.dur || 0;
    const url = thumb_url(v);

    const facts = facts_of(v).map((s) => ["span", {class: "VID_FACT"}, s]);
    const subs = (v.subs || []).map((s) => sub_label(s.label)).join(", ");

    const nodes = [
        url ? ["img", {class: "VID_CARD_PIC", src: url, alt: ""}] : null,
        ["h2", {class: "VID_CARD_TITLE"}, v.title],
        facts.length ? ["div", {class: "VID_META VID_CARD_FACTS"}, facts] : null,
        is_unplayable(v)
            ? ["p", {class: "VID_CARD_BAD", i18n: "cannot play here long"}, t("cannot play here long")]
            : null,
        ["div", {class: "VID_CARD_LINES"}, [
            line("file", v.name),
            line("folder", v.path.split("/").slice(0, -1).join("/") || "/"),
            line("source", source_name(v.source_id)),
            line("size", size_of(v.size)),
            line("duration", dur ? fmt_time(dur) : ""),
            line("picture", info.w ? (info.w + " × " + info.h) : ""),
            line("subtitles", subs),
        ].filter(Boolean)],
        ["div", {class: "VID_CARD_NUMS"}, [
            ["div", {class: "VID_CARD_NUM"}, [
                ["b", {}, String(st.views)],
                /*  The noun agrees with the figure ("1 view", "2 views"),
                    so it carries no key refresh_language could repaint
                    without the count: see plural.js. */
                ["span", {}, count_noun("n views", st.views)]
            ]],
            ["div", {class: "VID_CARD_NUM"}, [
                ["b", {}, String(st.full)],
                ["span", {i18n: "to the end"}, t("to the end")]
            ]],
            ["div", {class: "VID_CARD_NUM"}, [
                ["b", {}, String(st.hearts)],
                ["span", {}, count_noun("n hearts", st.hearts)]
            ]],
            ["div", {class: "VID_CARD_NUM VID_CARD_LEFTAT"}, [
                ["b", {}, st.pos ? fmt_time(st.pos) : "—"],
                ["span", {i18n: "left at"}, t("left at")]
            ]]
        ]],
        ["div", {class: "VID_CARD_ACTIONS"}, [
            button("VID_CARD_PLAY is-primary", "play", P.play, "play"),
            button("VID_CARD_ADD", "add to queue", P.enqueue, "add"),
            button("VID_CARD_HEART", "give a heart", P.heart, "heart"),
            button("VID_CARD_UNHEART", "take a heart back", P.heart, "unheart", st.hearts ? "" : " is-hidden"),
            button("VID_CARD_FORGET", "forget the place", P.restart, "forget_place", st.pos ? "" : " is-hidden"),
            button("VID_CARD_RESET is-danger is-light", "forget these counts", P.trash, "reset",
                   (st.views || st.hearts || st.pos) ? "" : " is-hidden"),
        ]],
        ["footer", {class: "VID_CARD_FOOT"}, [
            ["button", {class: "VID_CARD_CLOSE button", type: "button", i18n: "close", ...named("close")},
                t("close"), {click: () => send("close")}]
        ]]
    ].filter(Boolean);
    for(const n of nodes) {
        $card.appendChild(createElement2(n));
    }
    refresh_language($card, t);
}

/***************************************************************
 *  What the card's buttons do, run from the opener's FSM.
 ***************************************************************/
function card_action(gobj, kw)
{
    const v = find_uid(kw.uid);
    const act = kw.act;
    if(act === "close" || !v) {
        close_card();
        return 0;
    }
    if(act === "stats") {
        refresh();
        return 0;
    }
    if(act === "play") {
        close_card();
        play_temp([v], 0);
    } else if(act === "add") {
        queue_add([v], "append");
    } else if(act === "heart") {
        heart(v, 1);
    } else if(act === "unheart") {
        heart(v, -1);
    } else if(act === "forget_place") {
        forget_place(v);
    } else if(act === "reset") {
        stats_reset(v);
    } else {
        log_error(`video_card: unknown action: ${act}`);
        return -1;
    }
    return 0;
}


export {open_card, close_card, card_action};
