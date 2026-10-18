/***********************************************************************
 *          rows.js
 *
 *      One video, as a row. The same row on every screen that lists
 *      videos, so the same tap does the same thing wherever it lands:
 *
 *        - the PICTURE is the play button. It is the biggest target on
 *          the row and the thing the eye goes to; on the library it
 *          starts the temporary list there, on the deck it plays that
 *          entry of the queue;
 *        - the NAME opens the video's card — the one gesture that only
 *          looks. A row gives a title one ellipsised line, and the card
 *          is where the rest of it can be read;
 *        - ＋ adds it to the deck, ♥ gives it a heart.
 *
 *      Under the name: what the name said (the show and its episode
 *      code, the year), how long it is, and a bar of how much of it has
 *      been watched — the one fact a video row has that a song row did
 *      not.
 *
 *      The row does not act. Every button sends an event to the gobj
 *      that drew it, with the video's uid (an identity, never the
 *      object), and the work is done in that gobj's FSM.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {gobj_send_event, createElement2} from "@yuneta/gobj-js";

import {facts_of, fmt_time, find_uid} from "./video_store.js";
import {stats_of, watched_fraction} from "./stats_store.js";
import {paint_thumb, thumb_info, is_unplayable} from "./thumbs.js";
import {P, svg, named} from "./ui.js";

import {t} from "i18next";


/*  How long it is: from the frame we read, or from the last time it
    played. Unknown is said as nothing, not as 0:00. */
function duration_of(v)
{
    const info = thumb_info(v);
    const dur = (info && info.dur) || stats_of(v).dur || 0;
    return dur ? fmt_time(dur) : "";
}

/*  The picture, as a button. `play_event` is what pressing it sends. */
function thumb_button(gobj, v, play_event, extra, ctx)
{
    const $box = document.createElement("span");
    $box.className = "VID_THUMB";
    const btn = ["button", {
            class: "VID_THUMBBTN" + (extra || ""),
            type: "button",
            ...named("play")
        }, [
            $box,
            ["span", {class: "VID_THUMBPLAY"}, svg(P.play, 22)]
        ],
        {click: () => gobj_send_event(gobj, play_event, {uid: v.uid, ctx: ctx || ""}, gobj)}];
    paint_thumb($box, v);
    return btn;
}

function watched_bar(v)
{
    const f = watched_fraction(v);
    if(!f) {
        return null;
    }
    return ["span", {class: "VID_WATCHED", role: "presentation"}, [
        ["i", {style: "width:" + Math.round(f * 100) + "%"}]
    ]];
}

/*  The line under the title. Each fact its own node: createElement2
    trims text, and the separators come from the stylesheet. */
function meta_line(v)
{
    const bits = facts_of(v).map((s) => ["span", {class: "VID_FACT"}, s]);
    const dur = duration_of(v);
    if(dur) {
        bits.push(["span", {class: "VID_FACT VID_DUR"}, dur]);
    }
    const st = stats_of(v);
    if(st.views) {
        bits.push(["span", {class: "VID_FACT VID_NVIEWS"}, [
            ["span", {class: "VID_GLYPH", "aria-hidden": "true"}, "▶"],
            ["span", {}, String(st.views)]
        ]]);
    }
    if(st.hearts) {
        bits.push(["span", {class: "VID_FACT VID_NHEARTS"}, [
            ["span", {class: "VID_GLYPH", "aria-hidden": "true"}, "♥"],
            ["span", {}, String(st.hearts)]
        ]]);
    }
    if(is_unplayable(v)) {
        bits.push(["span", {class: "VID_FACT VID_BAD", i18n: "cannot play here"},
            t("cannot play here")]);
    }
    return ["span", {class: "VID_META"}, bits];
}

/***************************************************************
 *  A row of the library or of a list.
 *
 *      opts.play     event the picture sends (default EV_PLAY_ROW)
 *      opts.playing  true to mark it as the one on screen
 *      opts.ctx      which list on the screen the row belongs to, handed
 *                    back with the play event
 ***************************************************************/
function video_row(gobj, v, opts)
{
    const o = opts || {};
    const send = (ev) => () => gobj_send_event(gobj, ev, {uid: v.uid}, gobj);
    const bar = watched_bar(v);
    return ["div", {class: "VID_ROW" + (o.playing ? " is-playing" : ""), "data-uid": String(v.uid)}, [
        thumb_button(gobj, v, o.play || "EV_PLAY_ROW", "", o.ctx),
        ["div", {class: "VID_ROWBODY"}, [
            ["button", {class: "VID_NAME", type: "button", ...named("open the card")},
                v.title, {click: send("EV_OPEN_CARD")}],
            meta_line(v),
            bar
        ].filter(Boolean)],
        ["div", {class: "VID_ROWBTNS"}, [
            ["button", {class: "VID_IBTN VID_ADDQ", type: "button", ...named("add to queue")},
                svg(P.enqueue, 20), {click: send("EV_ADD_ROW")}],
            ["button", {class: "VID_IBTN VID_HEARTBTN", type: "button", ...named("give a heart")},
                svg(P.heart, 18), {click: send("EV_HEART_ROW")}]
        ]]
    ]];
}


/***************************************************************
 *  What the stats and the pictures change on a row — the facts
 *  under its name and the watched bar — written into the rows
 *  already in `$scope`. Never a rebuild: those numbers move every
 *  few seconds while a video plays, and a rebuild takes the focus
 *  from whatever has it (a row's button, a name being typed) and
 *  leaves the old rows behind for the pictures still to be made.
 *
 *  Returns false when a row names a video the library no longer
 *  has: the list is out of step and the caller rebuilds it.
 ***************************************************************/
function refresh_rows($scope)
{
    for(const $row of $scope.querySelectorAll(".VID_ROW[data-uid]")) {
        const v = find_uid(Number($row.getAttribute("data-uid")));
        const $body = $row.querySelector(".VID_ROWBODY");
        if(!v || !$body) {
            return false;
        }
        const $meta = $body.querySelector(".VID_META");
        if($meta) {
            $meta.replaceWith(createElement2(meta_line(v)));
        }
        const $old = $body.querySelector(".VID_WATCHED");
        const bar = watched_bar(v);
        const $bar = bar ? createElement2(bar) : null;
        if($old && $bar) {
            $old.replaceWith($bar);
        } else if($old) {
            $old.remove();
        } else if($bar) {
            $body.appendChild($bar);
        }
    }
    return true;
}

/*  Which row is the one on screen, said in place. */
function mark_playing($scope, uid)
{
    for(const $row of $scope.querySelectorAll(".VID_ROW[data-uid]")) {
        $row.classList.toggle("is-playing", Number($row.getAttribute("data-uid")) === uid);
    }
}


export {video_row, thumb_button, meta_line, watched_bar, duration_of, refresh_rows, mark_playing};
