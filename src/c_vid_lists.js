/***********************************************************************
 *          c_vid_lists.js
 *
 *      C_VID_LISTS — the lists: the ones you saved, and two nobody saved.
 *
 *        Saved lists         the queues you gave a name, each in its own
 *                            box, as in yunomúsica. Tapping a name
 *                            unfolds it; Play makes it the deck, which
 *                            throws the current one away, so it asks
 *                            first — the one place in the app that does.
 *        Loved               every video with a heart, most first.
 *        Most watched        everything watched, most first.
 *
 *      There is no "Continue watching" any more: every video keeps
 *      where it was left, and a saved list comes back where it was
 *      left, so a third list of the same places said nothing new.
 *
 *      The last two are built from the numbers every time this screen
 *      is drawn, never stored, which is what keeps them from ever
 *      disagreeing with the numbers on the rows. A video whose source
 *      is not authorised right now cannot be resolved, and is COUNTED
 *      rather than dropped in silence.
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
    subscribe_stats, ranked, split_key, clear_counts, heart,
} from "./stats_store.js";
import {open_confirm} from "./confirm_replace.js";
import {dialog_action} from "./dialogs.js";
import {open_card, card_action} from "./video_card.js";
import {video_row, refresh_rows, mark_playing} from "./rows.js";
import {subscribe_thumbs} from "./thumbs.js";
import {count_pair} from "./plural.js";
import {P, svg, ico, named, named_for, new_id, clear, disabled_if} from "./ui.js";

import {t} from "i18next";


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_VID_LISTS";

const LISTS_ROUTE = "/lists";

/*  The fold of a saved list: a chevron, because it opens ONE thing. */
const CHEVRON = "M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z";


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
    asking:   "",       // what is being asked: "views", or "del:<id>"
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

/*  Which rows the numbers decide: what is loved, what is most
    watched, in their order, and how many of each no longer resolve.
    While it holds, a change of the numbers is written into the rows;
    when it moves, the screen is rebuilt. */
function shape_of(gobj)
{
    const ids = (list) => list.map((v) => v.uid).join(",");
    let loved = resolve_rows(ranked("hearts"));
    let watched = resolve_rows(ranked("views"));
    return [
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

function missing_line(n)
{
    return ["p", {class: "VID_DIM VID_MISSING VID_T2"}, count_pair(n, "n missing")];
}

/***************************************************************
 *  The saved lists, one box each — the same box as a source, and
 *  the same shape as yunomúsica's lists: the name (which unfolds
 *  it) and its count on one side, Play / Add to queue / Delete,
 *  with their words, on the other. Unfolded, its videos follow
 *  the box, every one of them, the unreachable ones too.
 ***************************************************************/
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
    let boxes = [];
    for(const pl of lists) {
        boxes.push(list_box(gobj, pl, priv.open === pl.id));
    }
    out.push(["div", {class: "VID_SRCLIST VID_LISTBOXES"}, boxes]);
    return out;
}

function list_box(gobj, pl, open)
{
    let priv = gobj.priv;
    let r = resolve(pl.id);
    let kw = {id: pl.id};
    const send = (ev) => () => gobj_send_event(gobj, ev, kw, gobj);
    let del = "del:" + pl.id;
    /*  Every button is named by the list too: "Play" on three boxes is
        three buttons nobody can tell apart by ear. */
    let tid = new_id();

    const action = (cls, name_key, label_key, path, ev, extra) =>
        ["button", {class: "VID_QBTN button " + cls, type: "button", ...named_for(name_key, tid),
                    ...(extra || {})},
            [ico(path, 15), ["span", {class: "VID_QLABEL", i18n: label_key}, t(label_key)]],
            {click: send(ev)}];

    let actions = [
        action("is-primary VID_PLAYLIST", "play the list", "play", P.play, "EV_PLAY_LIST",
            disabled_if(!r.tracks.length)),
        action("VID_ADDLIST", "add all to queue", "add to queue", P.enqueue, "EV_ADD_LIST",
            disabled_if(!r.tracks.length))
    ];
    if(priv.asking === del) {
        actions.push(["button", {class: "VID_QBTN button is-danger VID_DEL_YES",
                                 type: "button", i18n: "delete this list?",
                                 ...named_for("delete this list?", tid)},
            t("delete this list?"), {click: () => gobj_send_event(gobj, "EV_ASK_YES",
                {what: del}, gobj)}]);
        actions.push(["button", {class: "VID_QBTN button is-ghost", type: "button", i18n: "cancel",
                                 ...named("cancel")},
            t("cancel"), {click: () => gobj_send_event(gobj, "EV_ASK_NO", {}, gobj)}]);
    } else {
        actions.push(["button", {class: "VID_QBTN button is-ghost VID_DELLIST", type: "button",
                                 ...named_for("delete this list", tid)},
            [ico(P.trash, 15), ["span", {class: "VID_QLABEL", i18n: "delete"}, t("delete")]],
            {click: () => gobj_send_event(gobj, "EV_ASK", {what: del}, gobj)}]);
    }

    let sub = count_pair(pl.count, "n videos");
    if(r.missing) {
        sub.push(["span", {class: "VID_SEP"}, "·"]);
        sub.push(["span", {class: "VID_FACT is-warn"}, count_pair(r.missing, "n missing")]);
    }

    /*  THE NAME OPENS THE LIST, as everywhere else here a name opens
        what it names; the chevron says so without having to guess. */
    let box = ["article", {class: "VID_SRCROW VID_LISTBOX" + (open ? " is-open" : "")}, [
        ["button", {class: "VID_LISTNAME", type: "button", "aria-expanded": open ? "true" : "false",
                    ...named_for("show what is in it", tid)}, [
            ["div", {class: "VID_T1"}, [
                ["span", {class: "VID_LISTCHEV", "aria-hidden": "true"}, svg(CHEVRON, 18)],
                ["span", {class: "VID_TITLE", id: tid}, pl.name]
            ]],
            ["div", {class: "VID_T2"}, sub]
        ], {click: send("EV_UNFOLD")}],
        ["div", {class: "VID_SRCACTIONS"}, actions]
    ]];
    if(!open) {
        return box;
    }

    /*  Every entry gets a row, the ones that do not resolve too —
        greyed, from the title stored WITH the list. A list shorter on
        screen than it is would be a lie. */
    let rows = [];
    let on = sounding();
    for(const it of entries_of(pl.id)) {
        let v = find_video(it.source_id, it.path);
        if(v) {
            rows.push(video_row(gobj, v, {ctx: "list:" + pl.id,
                                          playing: !!on && on.uid === v.uid}));
        } else {
            rows.push(["div", {class: "VID_ROW VID_GONE"}, [
                ["div", {class: "VID_ROWBODY"}, [
                    ["span", {class: "VID_NAME"}, it.title || it.path],
                    ["span", {class: "VID_META", i18n: "not reachable now"}, t("not reachable now")]
                ]]
            ]]);
        }
    }
    return ["div", {class: "VID_LISTWRAP"}, [
        box,
        ["div", {class: "VID_LISTENTRIES"}, rows]
    ]];
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
    if(what === "views") {
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
