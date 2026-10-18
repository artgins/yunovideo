/***********************************************************************
 *          c_vid_lists.js
 *
 *      C_VID_LISTS — the lists: one that is a consequence of watching,
 *      the ones you saved, and two more nobody saved.
 *
 *        Continue watching   every video left half-way, sorted by NAME:
 *                            the app keeps where each one was left and
 *                            not when, so there is no "most recent" to
 *                            sort by — on purpose (see stats_store.js).
 *        Saved lists         the queues you gave a name. Tapping a name
 *                            unfolds it; Play makes it the deck, which
 *                            throws the current one away, so it asks
 *                            first — the one place in the app that does.
 *        Loved               every video with a heart, most first.
 *        Most watched        everything watched, most first.
 *
 *      The last three are built from the numbers every time this
 *      screen is drawn, never stored, which is what keeps them from
 *      ever disagreeing with the numbers on the rows. A video whose
 *      source is not authorised right now cannot be resolved, and is
 *      COUNTED rather than dropped in silence.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    SDATA, SDATA_END, data_type_t,
    gclass_create, log_error,
    gobj_parent,
    gobj_read_attr, gobj_read_pointer_attr, gobj_write_attr,
    gobj_subscribe_event, gobj_send_event, gobj_change_state,
    createElement2, refresh_language,
} from "@yuneta/gobj-js";

import {yui_shell_of} from "@yuneta/gobj-ui/src/c_yui_shell.js";

import {
    subscribe, find_video, find_uid, queue_add, play_temp, play_list, sounding, queue_length,
} from "./video_store.js";
import {
    subscribe_playlists, all_playlists, resolve, entries_of, remove_playlist,
} from "./playlists_store.js";
import {
    subscribe_stats, ranked, in_progress, split_key, clear_counts, clear_places, heart,
} from "./stats_store.js";
import {open_confirm} from "./confirm_replace.js";
import {dialog_action} from "./dialogs.js";
import {open_card, card_action} from "./video_card.js";
import {video_row, refresh_rows, mark_playing} from "./rows.js";
import {subscribe_thumbs} from "./thumbs.js";
import {count_pair} from "./plural.js";
import {P, svg, ico, named, named_for, new_id, clear} from "./ui.js";

import {t} from "i18next";


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_VID_LISTS";

const LISTS_ROUTE = "/lists";

const collator = new Intl.Collator(undefined, {sensitivity: "base", numeric: true});


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
    unsubs:   [],
    $content: null,
    open:     "",       // id of the saved list unfolded
    asking:   "",       // what is being asked: "places", "views", or "del:<id>"
    shown:    true,     // on screen: created by the route that shows it
    shape:    "",       // which rows the stats put on screen, at the last render
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

    let $content = createElement2(["div", {class: "VID_CONTENT VID_SCROLL"}, []]);
    gobj.priv.$content = $content;
    gobj_write_attr(gobj, "$container",
        createElement2(["div", {class: "C_VID_LISTS VID_VIEW"}, [$content]]));
}

/***************************************************************
 *          Framework Method: Start
 ***************************************************************/
function mt_start(gobj)
{
    let priv = gobj.priv;
    priv.asking = "";
    gobj_change_state(gobj, "ST_IDLE");
    const send = (channel) => gobj_send_event(gobj, "EV_STORE", {channel: channel}, gobj);
    priv.unsubs = [
        subscribe_playlists(() => send("playlists")),
        subscribe_stats(() => send("stats")),
        subscribe_thumbs(() => send("thumbs")),
        subscribe(function(channel) {
            if(channel === "library" || channel === "temp") {
                send(channel);
            }
        }),
    ];
    let shell = yui_shell_of(gobj);
    if(shell) {
        gobj_subscribe_event(shell, "EV_LANGUAGE_CHANGED", {}, gobj);
        gobj_subscribe_event(shell, "EV_ROUTE_CHANGED", {}, gobj);
    }
    render(gobj);
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




/*  Rows of numbers back into videos: what resolves, and how many do
    not. */
function resolve_rows(rows)
{
    let videos = [];
    let missing = 0;
    for(const r of rows) {
        let k = split_key(r.key);
        let v = find_video(k.source_id, k.path);
        if(v) {
            videos.push(v);
        } else {
            missing++;
        }
    }
    return {videos, missing};
}

/*  The list a context names, in the order it is shown. */
function list_of(gobj, ctx)
{
    if(ctx === "continue") {
        return resolve_rows(in_progress()).videos
            .sort((a, b) => collator.compare(a.show || a.title, b.show || b.title) ||
                            (a.season - b.season) || (a.episode - b.episode));
    }
    if(ctx === "loved") {
        return resolve_rows(ranked("hearts")).videos;
    }
    if(ctx === "watched") {
        return resolve_rows(ranked("views")).videos;
    }
    if(ctx && ctx.indexOf("list:") === 0) {
        return resolve(ctx.slice(5)).tracks;
    }
    return [];
}

/*  Which rows the numbers decide: what is half watched, what is
    loved, what is most watched, in their order, and how many of each
    no longer resolve. While it holds, a change of the numbers is
    written into the rows; when it moves, the screen is rebuilt. */
function shape_of(gobj)
{
    const ids = (list) => list.map((v) => v.uid).join(",");
    let cont = resolve_rows(in_progress());
    let loved = resolve_rows(ranked("hearts"));
    let watched = resolve_rows(ranked("views"));
    return [
        ids(list_of(gobj, "continue")), cont.missing,
        ids(loved.videos), loved.missing,
        ids(watched.videos), watched.missing,
    ].join("|");
}

function render(gobj)
{
    let priv = gobj.priv;
    let $c = priv.$content;
    let scroll = $c.scrollTop;
    clear($c);
    priv.shape = shape_of(gobj);

    let nodes = [];
    nodes.push(["header", {class: "VID_SECHEAD"}, [
        ["h1", {class: "VID_SECTITLE", i18n: "lists"}, t("lists")]
    ]]);
    nodes.push(...section_continue(gobj));
    nodes.push(...section_saved(gobj));
    nodes.push(...section_ranked(gobj, "loved", "hearts", "loved", "loved empty"));
    nodes.push(...section_ranked(gobj, "watched", "views", "most watched", "most watched empty"));
    for(const n of nodes) {
        $c.appendChild(createElement2(n));
    }
    refresh_language($c, t);
    $c.scrollTop = scroll;
}

/*  A section's play-all and add-all are named by the section's title:
    "Play all" four times on one screen says nothing. */
function section_head(gobj, title_key, n, kw, extra)
{
    let tid = new_id();
    let buttons = [];
    if(n) {
        buttons.push(["button", {class: "VID_IBTN VID_PLAYGROUP", type: "button",
                                 ...named_for("play all", tid)},
            svg(P.play, 20), {click: () => gobj_send_event(gobj, "EV_PLAY_CTX", kw, gobj)}]);
        buttons.push(["button", {class: "VID_IBTN VID_ADDGROUP", type: "button",
                                 ...named_for("add all to queue", tid)},
            svg(P.enqueue, 20), {click: () => gobj_send_event(gobj, "EV_ADD_CTX", kw, gobj)}]);
    }
    return ["div", {class: "VID_LISTHEAD"}, [
        ["h2", {class: "VID_LISTTITLE"}, [
            ["span", {i18n: title_key, id: tid}, t(title_key)],
            ["span", {class: "VID_SECCOUNT"}, String(n)]
        ]],
        ["div", {class: "VID_ROWBTNS"}, buttons.concat(extra || [])]
    ]];
}

/*  An inline question: the button turns into the question and a
    cancel, in place. A modal for this would be ceremony. */
function ask_buttons(gobj, what, plain_key, ask_key)
{
    if(gobj.priv.asking === what) {
        return [
            ["button", {class: "VID_QBTN button is-small is-danger VID_ASK_YES", type: "button",
                        i18n: ask_key, ...named(ask_key)},
                t(ask_key), {click: () => gobj_send_event(gobj, "EV_ASK_YES", {what: what}, gobj)}],
            ["button", {class: "VID_QBTN button is-small", type: "button", i18n: "cancel",
                        ...named("cancel")},
                t("cancel"), {click: () => gobj_send_event(gobj, "EV_ASK_NO", {}, gobj)}]
        ];
    }
    return [["button", {class: "VID_IBTN VID_ASK", type: "button", ...named(plain_key)},
        svg(P.sweep, 18), {click: () => gobj_send_event(gobj, "EV_ASK", {what: what}, gobj)}]];
}

function section_continue(gobj)
{
    let res = resolve_rows(in_progress());
    let list = list_of(gobj, "continue");
    let on = sounding();
    let out = [section_head(gobj, "continue watching", list.length, {ctx: "continue"},
        res.videos.length + res.missing
            ? ask_buttons(gobj, "places", "forget every place", "forget every place?")
            : [])];
    out.push(["p", {class: "VID_DIM VID_LISTNOTE", i18n: "continue explained"}, t("continue explained")]);
    for(const v of list) {
        out.push(video_row(gobj, v, {ctx: "continue", playing: !!on && on.uid === v.uid}));
    }
    if(res.missing) {
        out.push(missing_line(res.missing));
    }
    if(!list.length && !res.missing) {
        out.push(["p", {class: "VID_EMPTY", i18n: "continue empty"}, t("continue empty")]);
    }
    return out;
}

function missing_line(n)
{
    return ["p", {class: "VID_DIM VID_MISSING VID_T2"}, count_pair(n, "n missing")];
}

function section_saved(gobj)
{
    let priv = gobj.priv;
    let lists = all_playlists();
    let out = [["div", {class: "VID_LISTHEAD"}, [
        ["h2", {class: "VID_LISTTITLE"}, [
            ["span", {i18n: "saved lists"}, t("saved lists")],
            ["span", {class: "VID_SECCOUNT"}, String(lists.length)]
        ]]
    ]]];
    if(!lists.length) {
        out.push(["p", {class: "VID_EMPTY", i18n: "no lists yet"}, t("no lists yet")]);
        return out;
    }
    for(const pl of lists) {
        let r = resolve(pl.id);
        let kw = {id: pl.id};
        const send = (ev) => () => gobj_send_event(gobj, ev, kw, gobj);
        let del = "del:" + pl.id;
        let tid = new_id();
        let buttons = [
            ["button", {class: "VID_IBTN VID_PLAYLIST", type: "button", ...named_for("play the list", tid),
                        ...(r.tracks.length ? {} : {disabled: "disabled"})},
                svg(P.play, 20), {click: send("EV_PLAY_LIST")}],
            ["button", {class: "VID_IBTN VID_ADDLIST", type: "button", ...named_for("add all to queue", tid),
                        ...(r.tracks.length ? {} : {disabled: "disabled"})},
                svg(P.enqueue, 20), {click: send("EV_ADD_LIST")}]
        ];
        if(priv.asking === del) {
            buttons.push(["button", {class: "VID_QBTN button is-small is-danger VID_DEL_YES",
                                     type: "button", i18n: "delete this list?",
                                     ...named_for("delete this list?", tid)},
                t("delete this list?"), {click: () => gobj_send_event(gobj, "EV_ASK_YES",
                    {what: del}, gobj)}]);
            buttons.push(["button", {class: "VID_QBTN button is-small", type: "button", i18n: "cancel",
                                     ...named("cancel")},
                t("cancel"), {click: () => gobj_send_event(gobj, "EV_ASK_NO", {}, gobj)}]);
        } else {
            buttons.push(["button", {class: "VID_IBTN VID_DELLIST", type: "button",
                                     ...named_for("delete this list", tid)},
                svg(P.trash, 18), {click: () => gobj_send_event(gobj, "EV_ASK", {what: del}, gobj)}]);
        }
        let open = priv.open === pl.id;
        out.push(["div", {class: "VID_ROW VID_LISTROW" + (open ? " is-open" : "")}, [
            ["div", {class: "VID_ROWBODY"}, [
                ["button", {class: "VID_NAME", type: "button", "aria-expanded": open ? "true" : "false",
                            ...named_for("show what is in it", tid)},
                    [["span", {class: "VID_TITLE", id: tid}, pl.name]], {click: send("EV_UNFOLD")}],
                ["span", {class: "VID_META VID_T2"}, count_pair(pl.count, "n videos").concat(
                    r.missing ? [["span", {class: "VID_FACT is-warn VID_T2"},
                        count_pair(r.missing, "n missing")]] : [])]
            ]],
            ["div", {class: "VID_ROWBTNS"}, buttons]
        ]]);
        if(open) {
            /*  Every entry gets a row, the ones that do not resolve
                too — greyed, from the title stored WITH the list. A
                list shorter on screen than it is would be a lie. */
            let on = sounding();
            for(const it of entries_of(pl.id)) {
                let v = find_video(it.source_id, it.path);
                if(v) {
                    out.push(video_row(gobj, v, {ctx: "list:" + pl.id,
                                                  playing: !!on && on.uid === v.uid}));
                } else {
                    out.push(["div", {class: "VID_ROW VID_GONE"}, [
                        ["div", {class: "VID_ROWBODY"}, [
                            ["span", {class: "VID_NAME"}, it.title || it.path],
                            ["span", {class: "VID_META", i18n: "not reachable now"}, t("not reachable now")]
                        ]]
                    ]]);
                }
            }
        }
    }
    return out;
}

function section_ranked(gobj, ctx, by, title_key, empty_key)
{
    let res = resolve_rows(ranked(by));
    let extra = [];
    if(by === "views" && (res.videos.length || res.missing)) {
        extra = ask_buttons(gobj, "views", "forget every count", "forget every count?");
    }
    let out = [section_head(gobj, title_key, res.videos.length, {ctx: ctx}, extra)];
    let on = sounding();
    for(const v of res.videos) {
        out.push(video_row(gobj, v, {ctx: ctx, playing: !!on && on.uid === v.uid}));
    }
    if(res.missing) {
        out.push(missing_line(res.missing));
    }
    if(!res.videos.length && !res.missing) {
        out.push(["p", {class: "VID_EMPTY", i18n: empty_key}, t(empty_key)]);
    }
    return out;
}




                    /***************************
                     *      Actions
                     ***************************/




/*  Kept alive, so subscribed while hidden: hidden, nothing is
    drawn — the route that shows it again renders it. On screen, a
    change of the numbers that leaves the same rows is written into
    them (see shape_of); a rebuild every ten seconds while a film
    plays took the focus from the list and left the old rows behind
    for pictures never made. */
function ac_store(gobj, event, kw, src)
{
    let priv = gobj.priv;
    if(!priv.shown) {
        return 0;
    }
    switch(kw.channel) {
        case "stats":
            if(shape_of(gobj) !== priv.shape || !refresh_rows(priv.$content)) {
                render(gobj);
            }
            break;
        case "thumbs":
            if(!refresh_rows(priv.$content)) {
                render(gobj);
            }
            break;
        case "temp": {
            let on = sounding();
            mark_playing(priv.$content, on ? on.uid : 0);
            break;
        }
        default:
            render(gobj);
            break;
    }
    return 0;
}

function ac_route_changed(gobj, event, kw, src)
{
    let route = (kw && (kw.base || kw.route)) || "";
    gobj.priv.shown = (route === LISTS_ROUTE);
    if(gobj.priv.shown) {
        render(gobj);
    }
    return 0;
}

function ac_language_changed(gobj, event, kw, src)
{
    render(gobj);
    return 0;
}

function ac_play_row(gobj, event, kw, src)
{
    let list = list_of(gobj, kw.ctx);
    let i = list.findIndex((v) => v.uid === kw.uid);
    if(i < 0) {
        log_error(`${GCLASS_NAME}: video not in ${kw.ctx}: ${kw.uid}`);
        return -1;
    }
    play_temp(list, i);
    return 0;
}

function ac_play_ctx(gobj, event, kw, src)
{
    let list = list_of(gobj, kw.ctx);
    if(!list.length) {
        log_error(`${GCLASS_NAME}: nothing to play in ${kw.ctx}`);
        return -1;
    }
    play_temp(list, 0);
    return 0;
}

function ac_add_ctx(gobj, event, kw, src)
{
    queue_add(list_of(gobj, kw.ctx), "append");
    return 0;
}

function ac_add_row(gobj, event, kw, src)
{
    let v = find_uid(kw.uid);
    if(!v) {
        log_error(`${GCLASS_NAME}: no such video: ${kw.uid}`);
        return -1;
    }
    queue_add([v], "append");
    return 0;
}

function ac_heart_row(gobj, event, kw, src)
{
    let v = find_uid(kw.uid);
    if(!v) {
        log_error(`${GCLASS_NAME}: no such video: ${kw.uid}`);
        return -1;
    }
    heart(v, 1);
    return 0;
}

function ac_unfold(gobj, event, kw, src)
{
    gobj.priv.open = (gobj.priv.open === kw.id) ? "" : kw.id;
    render(gobj);
    return 0;
}

/*  Play a saved list: it becomes the deck. That throws the current
    deck away, so it asks — and the answer comes back as an event. */
function ac_play_list(gobj, event, kw, src)
{
    if(!queue_length()) {
        /*  Nothing on the deck to lose: nothing to ask. */
        return replace_answer(gobj, kw.id, "replace");
    }
    open_confirm(gobj, yui_shell_of(gobj), {id: kw.id});
    return 0;
}

/*  A dialog this view opened answered (the replace question). */
function ac_dialog(gobj, event, kw, src)
{
    if(kw.dialog === "confirm") {
        return replace_answer(gobj, kw.ctx && kw.ctx.id, dialog_action(gobj, kw));
    }
    return dialog_action(gobj, kw);
}

function replace_answer(gobj, id, answer)
{
    if(!answer) {
        return 0;                       // cancelled
    }
    let r = resolve(id);
    let pl = all_playlists().find((p) => p.id === id);
    if(!pl || !r.tracks.length) {
        log_error(`${GCLASS_NAME}: list gone or empty: ${id}`);
        return -1;
    }
    if(answer === "replace") {
        play_list(r.tracks, pl.id, pl.name);
    } else if(answer === "append") {
        queue_add(r.tracks, "append");
    }
    return 0;
}

function ac_add_list(gobj, event, kw, src)
{
    queue_add(resolve(kw.id).tracks, "append");
    return 0;
}

function ac_ask(gobj, event, kw, src)
{
    gobj.priv.asking = kw.what;
    render(gobj);
    return 0;
}

function ac_ask_no(gobj, event, kw, src)
{
    gobj.priv.asking = "";
    render(gobj);
    return 0;
}

function ac_ask_yes(gobj, event, kw, src)
{
    let what = kw.what || "";
    if(what !== gobj.priv.asking) {
        log_error(`${GCLASS_NAME}: answer to "${what}" while asking "${gobj.priv.asking}"`);
        gobj.priv.asking = "";
        render(gobj);
        return -1;
    }
    gobj.priv.asking = "";
    if(what === "places") {
        clear_places();
    } else if(what === "views") {
        clear_counts("views");
    } else if(what.indexOf("del:") === 0) {
        remove_playlist(what.slice(4));
    } else {
        log_error(`${GCLASS_NAME}: unknown question: ${what}`);
        return -1;
    }
    render(gobj);
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

    /*  What the view does in every state; each state adds what only it
        can answer. */
    const common = [
        ["EV_STORE",            ac_store,           null],
        ["EV_LANGUAGE_CHANGED", ac_language_changed, null],
        ["EV_ROUTE_CHANGED",    ac_route_changed,   null],
        ["EV_PLAY_ROW",         ac_play_row,        null],
        ["EV_PLAY_CTX",         ac_play_ctx,        null],
        ["EV_ADD_CTX",          ac_add_ctx,         null],
        ["EV_ADD_ROW",          ac_add_row,         null],
        ["EV_HEART_ROW",        ac_heart_row,       null],
        ["EV_UNFOLD",           ac_unfold,          null],
        ["EV_PLAY_LIST",        ac_play_list,       null],
        ["EV_DIALOG",           ac_dialog,          null],
        ["EV_ADD_LIST",         ac_add_list,        null],
        ["EV_OPEN_CARD",        ac_open_card,       null],
        ["EV_CARD_ACTION",      ac_card_action,     null]
    ];
    const states = [
        ["ST_IDLE", [
            ...common,
            ["EV_ASK",              ac_ask,             "ST_ASKING"]
        ]],
        /*  A question stands in place of its button (priv.asking says which). */
        ["ST_ASKING", [
            ...common,
            ["EV_ASK",              ac_ask,             "ST_ASKING"],
            ["EV_ASK_YES",          ac_ask_yes,         "ST_IDLE"],
            ["EV_ASK_NO",           ac_ask_no,          "ST_IDLE"]
        ]]
    ];

    const event_types = [
        ["EV_STORE",            0],
        ["EV_LANGUAGE_CHANGED", 0],
        ["EV_ROUTE_CHANGED",    0],
        ["EV_PLAY_ROW",         0],
        ["EV_PLAY_CTX",         0],
        ["EV_ADD_CTX",          0],
        ["EV_ADD_ROW",          0],
        ["EV_HEART_ROW",        0],
        ["EV_UNFOLD",           0],
        ["EV_PLAY_LIST",        0],
        ["EV_DIALOG",           0],
        ["EV_ADD_LIST",         0],
        ["EV_ASK",              0],
        ["EV_ASK_NO",           0],
        ["EV_ASK_YES",          0],
        ["EV_OPEN_CARD",        0],
        ["EV_CARD_ACTION",      0]
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

function register_c_vid_lists()
{
    return create_gclass(GCLASS_NAME);
}

export {register_c_vid_lists};
