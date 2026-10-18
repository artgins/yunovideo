/***********************************************************************
 *          c_vid_library.js
 *
 *      C_VID_LIBRARY — the Library: three ways of looking at the same
 *      videos, and a search box over all of them.
 *
 *        Folders  the disk as it is: one level at a time, starting at
 *                 the source, with a breadcrumb that offers every rung
 *                 back. Folders are where people KEEP videos — a
 *                 camera's DCIM, "Pelis", a course in twelve parts —
 *                 so this is the view that works for any library and
 *                 the one it opens on.
 *        Series   every file whose name says it is an episode, grouped
 *                 by show and by season, in episode order: the order
 *                 the files happen to sort in is not always the order
 *                 they were broadcast in ("S01E10" before "S01E02").
 *        All      everything, by title.
 *
 *      PLAY IS EXPLICIT, and browsing never changes what is on the
 *      deck. The picture on a row plays the TEMPORARY list — what is on
 *      the screen, in that order, from that row — while the deck waits
 *      where it was. ＋ is the way onto the deck. Nothing here asks a
 *      question, because nothing here can lose anything.
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
    subscribe, has_library, series, series_by_id, all_sorted, search,
    folder_level, source_root_path, find_uid, queue_add, play_temp,
    take_open_request, sounding,
} from "./video_store.js";
import {subscribe_sources, all_sources} from "./sources_store.js";
import {subscribe_stats, heart} from "./stats_store.js";
import {paint_thumb, subscribe_thumbs} from "./thumbs.js";
import {open_card, card_action} from "./video_card.js";
import {video_row} from "./rows.js";
import {count_pair} from "./plural.js";
import {P, svg, ico, named, clear} from "./ui.js";

import {t} from "i18next";


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_VID_LIBRARY";

const LIBRARY_ROUTE = "/library";

/*  The chips, in the order they are offered. */
const VIEWS = [
    {id: "folders", key: "folders"},
    {id: "series",  key: "series"},
    {id: "all",     key: "all videos"},
];


/***************************************************************
 *              Attrs
 ***************************************************************/
const attrs_table = [
SDATA(data_type_t.DTP_POINTER,  "subscriber",  0,  null,      "Subscriber of output events"),
SDATA(data_type_t.DTP_STRING,   "title",       0,  "",        "Human title of the view"),
SDATA(data_type_t.DTP_STRING,   "view",        0,  "folders", "First grouping shown"),
SDATA(data_type_t.DTP_POINTER,  "$container",  0,  null,      "Root HTMLElement (shell contract)"),
SDATA_END()
];

let PRIVATE_DATA = {
    unsubs:   [],
    $head:    null,
    $content: null,
    view:     "folders",
    query:    "",
    folder:   null,     // {source_id, path} — null: the list of sources
    show_id:  "",       // the series opened, "" for the list of them
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
    priv.view = gobj_read_attr(gobj, "view") || "folders";

    /*  The head is built once: the search box must keep its focus and
        its caret while the list under it repaints at every key. */
    priv.$head = createElement2(
        ["div", {class: "VID_LIBHEAD"}, [
            ["div", {class: "VID_SECHEAD"}, [
                ["h1", {class: "VID_SECTITLE", i18n: "library"}, t("library")],
                ["span", {class: "VID_SECCOUNT VID_T2 VID_LIBCOUNT"}, []]
            ]],
            ["input", {class: "input VID_SEARCH", type: "search", ...named("search"),
                       placeholder: t("search"), "data-i18n-placeholder": "search"}, [], {
                input: (ev) => gobj_send_event(gobj, "EV_SEARCH", {q: ev.currentTarget.value}, gobj)
            }],
            ["div", {class: "VID_CHIPS", role: "group", ...named("view")},
                VIEWS.map((vw) => ["button", {
                        class: "VID_CHIP", type: "button", "data-view": vw.id,
                        i18n: vw.key, ...named(vw.key)
                    }, t(vw.key),
                    {click: () => gobj_send_event(gobj, "EV_SET_VIEW", {view: vw.id}, gobj)}])]
        ]]
    );
    priv.$content = createElement2(["div", {class: "VID_LIBLIST"}, []]);
    gobj_write_attr(gobj, "$container",
        createElement2(["div", {class: "C_VID_LIBRARY VID_VIEW"}, [
            ["div", {class: "VID_CONTENT"}, [priv.$head, priv.$content]]
        ]]));
}

/***************************************************************
 *          Framework Method: Start
 ***************************************************************/
function mt_start(gobj)
{
    let priv = gobj.priv;
    const send = (channel) => gobj_send_event(gobj, "EV_STORE", {channel: channel}, gobj);
    priv.unsubs = [
        subscribe(function(channel) {
            if(channel === "library" || channel === "temp" || channel === "playing") {
                send(channel);
            }
        }),
        subscribe_sources(() => send("sources")),
        subscribe_stats(() => send("stats")),
        subscribe_thumbs(() => send("thumbs")),
    ];
    let shell = yui_shell_of(gobj);
    if(shell) {
        gobj_subscribe_event(shell, "EV_LANGUAGE_CHANGED", {}, gobj);
        gobj_subscribe_event(shell, "EV_ROUTE_CHANGED", {}, gobj);
    }
    take_request(gobj);
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




/*  Sources' "look inside" lands here with a source to open. */
function take_request(gobj)
{
    let w = take_open_request();
    if(!w || !w.source_id) {
        return;
    }
    let priv = gobj.priv;
    priv.view = "folders";
    priv.query = "";
    let $s = priv.$head.querySelector(".VID_SEARCH");
    if($s) {
        $s.value = "";
    }
    priv.folder = {source_id: w.source_id, path: source_root_path(w.source_id)};
}

/*  The videos on the screen, in the order they are shown — what the
    temporary list plays. */
function visible_list(gobj)
{
    let priv = gobj.priv;
    if(priv.query) {
        return search(priv.query);
    }
    if(priv.view === "series") {
        let g = priv.show_id ? series_by_id(priv.show_id) : null;
        return g ? g.videos : [];
    }
    if(priv.view === "all") {
        return all_sorted();
    }
    let f = current_folder(gobj);
    return f ? folder_level(f.source_id, f.path).videos : [];
}

/*  With one source there is no list of sources to stand at. */
function current_folder(gobj)
{
    let priv = gobj.priv;
    if(priv.folder) {
        return priv.folder;
    }
    let sources = all_sources();
    if(sources.length === 1) {
        return {source_id: sources[0].id, path: source_root_path(sources[0].id)};
    }
    return null;
}

/*  The videos of a group a row stands for: a folder (everything below
    it), a season. */
function group_videos(gobj, kw)
{
    if(kw.kind === "dir") {
        let f = current_folder(gobj);
        if(!f) {
            return [];
        }
        let d = folder_level(f.source_id, f.path).dirs.find((x) => x.path === kw.path);
        return d ? d.videos : [];
    }
    if(kw.kind === "season") {
        let g = series_by_id(kw.show);
        return g ? g.videos.filter((v) => v.season === kw.season) : [];
    }
    if(kw.kind === "show") {
        let g = series_by_id(kw.show);
        return g ? g.videos : [];
    }
    return [];
}

function render(gobj)
{
    let priv = gobj.priv;
    let $c = priv.$content;
    let scroll = $c.scrollTop;
    clear($c);

    for(const $chip of priv.$head.querySelectorAll(".VID_CHIP")) {
        let on = $chip.getAttribute("data-view") === priv.view;
        $chip.classList.toggle("is-on", on);
        $chip.setAttribute("aria-pressed", on ? "true" : "false");
    }
    let $count = priv.$head.querySelector(".VID_LIBCOUNT");
    clear($count);
    for(const n of count_pair(all_sorted().length, "n videos")) {
        $count.appendChild(createElement2(n));
    }

    let nodes;
    if(!has_library()) {
        nodes = empty_library(gobj);
    } else if(priv.query) {
        let found = search(priv.query);
        nodes = found.length
            ? rows(gobj, found)
            : [["p", {class: "VID_EMPTY", i18n: "nothing found"}, t("nothing found")]];
    } else if(priv.view === "series") {
        nodes = priv.show_id ? render_show(gobj) : render_shows(gobj);
    } else if(priv.view === "all") {
        nodes = rows(gobj, all_sorted());
    } else {
        nodes = render_folders(gobj);
    }
    for(const n of nodes) {
        $c.appendChild(createElement2(n));
    }
    $c.scrollTop = scroll;
}

function rows(gobj, list)
{
    let on = sounding();
    return list.map((v) => video_row(gobj, v, {playing: !!on && on.uid === v.uid}));
}

function empty_library(gobj)
{
    return [
        ["div", {class: "VID_EMPTYBOX"}, [
            ["p", {class: "VID_EMPTY", i18n: "library empty"}, t("library empty")],
            ["button", {class: "VID_QBTN button is-primary", type: "button", i18n: "add videos",
                        ...named("add videos")}, t("add videos"),
                {click: () => gobj_send_event(gobj, "EV_GO", {route: "/sources"}, gobj)}]
        ]]
    ];
}

/*  A group's two verbs: play it as the temporary list, put it on the
    deck. */
function group_buttons(gobj, kw)
{
    return ["div", {class: "VID_ROWBTNS"}, [
        ["button", {class: "VID_IBTN VID_PLAYGROUP", type: "button", ...named("play all")},
            svg(P.play, 20), {click: () => gobj_send_event(gobj, "EV_PLAY_GROUP", kw, gobj)}],
        ["button", {class: "VID_IBTN VID_ADDGROUP", type: "button", ...named("add all to queue")},
            svg(P.enqueue, 20), {click: () => gobj_send_event(gobj, "EV_ADD_GROUP", kw, gobj)}]
    ]];
}

function render_folders(gobj)
{
    let sources = all_sources();
    let f = current_folder(gobj);
    let out = [];

    if(!f) {
        /*  Several sources: they are the first level. */
        for(const s of sources) {
            out.push(["div", {class: "VID_ROW VID_DIRROW"}, [
                ["button", {class: "VID_DIRICON", type: "button", ...named("open folder")},
                    svg(P.folder, 26),
                    {click: () => gobj_send_event(gobj, "EV_OPEN_SOURCE", {source_id: s.id}, gobj)}],
                ["div", {class: "VID_ROWBODY"}, [
                    ["button", {class: "VID_NAME", type: "button", ...named("open folder")}, s.name,
                        {click: () => gobj_send_event(gobj, "EV_OPEN_SOURCE", {source_id: s.id}, gobj)}],
                    ["span", {class: "VID_META VID_T2"}, count_pair(s.count, "n videos")]
                ]]
            ]]);
        }
        return out;
    }

    out.push(crumbs(gobj, f, sources.length > 1));
    let level = folder_level(f.source_id, f.path);
    for(const d of level.dirs) {
        let kw = {kind: "dir", path: d.path};
        out.push(["div", {class: "VID_ROW VID_DIRROW"}, [
            ["button", {class: "VID_DIRICON", type: "button", ...named("open folder")},
                svg(P.folder, 26),
                {click: () => gobj_send_event(gobj, "EV_OPEN_DIR", {path: d.path}, gobj)}],
            ["div", {class: "VID_ROWBODY"}, [
                ["button", {class: "VID_NAME", type: "button", ...named("open folder")}, d.name,
                    {click: () => gobj_send_event(gobj, "EV_OPEN_DIR", {path: d.path}, gobj)}],
                ["span", {class: "VID_META VID_T2"}, count_pair(d.videos.length, "n videos")]
            ]],
            group_buttons(gobj, kw)
        ]]);
    }
    out.push(...rows(gobj, level.videos));
    if(!level.dirs.length && !level.videos.length) {
        out.push(["p", {class: "VID_EMPTY", i18n: "nothing here"}, t("nothing here")]);
    }
    return out;
}

/*  Every rung back, not just one: a tree with only "back" makes you
    climb down a step at a time to a root whose name is on screen. */
function crumbs(gobj, f, many)
{
    let root = source_root_path(f.source_id);
    let parts = [];
    if(many) {
        parts.push(["button", {class: "VID_CRUMB", type: "button", i18n: "all sources",
                               ...named("all sources")}, t("all sources"),
            {click: () => gobj_send_event(gobj, "EV_CRUMB", {path: null}, gobj)}]);
    }
    let segs = f.path ? f.path.split("/") : [];
    let from = root ? root.split("/").length - 1 : -1;
    for(let i = Math.max(0, from); i < segs.length; i++) {
        let path = segs.slice(0, i + 1).join("/");
        let last = (i === segs.length - 1);
        parts.push(["button", {class: "VID_CRUMB" + (last ? " is-here" : ""), type: "button",
                               ...named("open folder")}, segs[i],
            {click: () => gobj_send_event(gobj, "EV_CRUMB", {path: path}, gobj)}]);
    }
    return ["nav", {class: "VID_CRUMBS", ...named("folders")}, parts];
}

function render_shows(gobj)
{
    let shows = series();
    if(!shows.length) {
        return [["p", {class: "VID_EMPTY", i18n: "no series help"}, t("no series help")]];
    }
    return shows.map(function(g) {
        let $box = document.createElement("span");
        $box.className = "VID_THUMB";
        paint_thumb($box, g.videos[0]);
        const open = () => gobj_send_event(gobj, "EV_OPEN_SHOW", {id: g.id}, gobj);
        return ["div", {class: "VID_ROW VID_SHOWROW"}, [
            ["button", {class: "VID_THUMBBTN", type: "button", ...named("open the series")}, [$box],
                {click: open}],
            ["div", {class: "VID_ROWBODY"}, [
                ["button", {class: "VID_NAME", type: "button", ...named("open the series")}, g.name,
                    {click: open}],
                ["span", {class: "VID_META VID_T2"},
                    count_pair(g.videos.length, "n episodes").concat(
                        count_pair(g.seasons.length, "n seasons"))]
            ]],
            group_buttons(gobj, {kind: "show", show: g.id})
        ]];
    });
}

function render_show(gobj)
{
    let priv = gobj.priv;
    let g = series_by_id(priv.show_id);
    if(!g) {
        priv.show_id = "";
        return render_shows(gobj);
    }
    let out = [["nav", {class: "VID_CRUMBS", ...named("series")}, [
        ["button", {class: "VID_CRUMB", type: "button", i18n: "series", ...named("series")},
            t("series"), {click: () => gobj_send_event(gobj, "EV_OPEN_SHOW", {id: ""}, gobj)}],
        ["button", {class: "VID_CRUMB is-here", type: "button", ...named("open the series")}, g.name,
            {click: () => gobj_send_event(gobj, "EV_OPEN_SHOW", {id: g.id}, gobj)}]
    ]]];
    let on = sounding();
    for(const season of g.seasons) {
        out.push(["div", {class: "VID_SEASONHEAD"}, [
            ["h2", {class: "VID_SEASONTITLE"}, [
                ["span", {i18n: "season"}, t("season")],
                ["span", {}, String(season)]
            ]],
            group_buttons(gobj, {kind: "season", show: g.id, season: season})
        ]]);
        for(const v of g.videos.filter((x) => x.season === season)) {
            out.push(video_row(gobj, v, {playing: !!on && on.uid === v.uid}));
        }
    }
    return out;
}




                    /***************************
                     *      Actions
                     ***************************/




function ac_store(gobj, event, kw, src)
{
    render(gobj);
    return 0;
}

function ac_language_changed(gobj, event, kw, src)
{
    render(gobj);
    refresh_language(gobj_read_attr(gobj, "$container"), t);
    return 0;
}

function ac_route_changed(gobj, event, kw, src)
{
    let route = (kw && (kw.base || kw.route)) || "";
    if(route === LIBRARY_ROUTE) {
        take_request(gobj);
        render(gobj);
    }
    return 0;
}

function ac_set_view(gobj, event, kw, src)
{
    let priv = gobj.priv;
    if(!VIEWS.find((v) => v.id === kw.view)) {
        log_error(`${GCLASS_NAME}: unknown view: ${kw.view}`);
        return -1;
    }
    /*  A chip pressed twice goes back to the top of its view. */
    if(priv.view === kw.view) {
        priv.show_id = "";
        priv.folder = null;
    }
    priv.view = kw.view;
    priv.query = "";
    priv.$head.querySelector(".VID_SEARCH").value = "";
    priv.$content.scrollTop = 0;
    render(gobj);
    return 0;
}

function ac_search(gobj, event, kw, src)
{
    gobj.priv.query = String(kw.q || "").trim();
    render(gobj);
    return 0;
}

function ac_open_source(gobj, event, kw, src)
{
    gobj.priv.folder = {source_id: kw.source_id, path: source_root_path(kw.source_id)};
    gobj.priv.$content.scrollTop = 0;
    render(gobj);
    return 0;
}

function ac_open_dir(gobj, event, kw, src)
{
    let f = current_folder(gobj);
    if(!f) {
        log_error(`${GCLASS_NAME}: no folder open`);
        return -1;
    }
    gobj.priv.folder = {source_id: f.source_id, path: kw.path};
    gobj.priv.$content.scrollTop = 0;
    render(gobj);
    return 0;
}

function ac_crumb(gobj, event, kw, src)
{
    let f = current_folder(gobj);
    if(kw.path === null || !f) {
        gobj.priv.folder = null;
    } else {
        gobj.priv.folder = {source_id: f.source_id, path: kw.path};
    }
    gobj.priv.$content.scrollTop = 0;
    render(gobj);
    return 0;
}

function ac_open_show(gobj, event, kw, src)
{
    gobj.priv.show_id = kw.id || "";
    gobj.priv.$content.scrollTop = 0;
    render(gobj);
    return 0;
}

/*  The picture of a row: the temporary list, from this row on. */
function ac_play_row(gobj, event, kw, src)
{
    let list = visible_list(gobj);
    let i = list.findIndex((v) => v.uid === kw.uid);
    if(i < 0) {
        let v = find_uid(kw.uid);
        if(!v) {
            log_error(`${GCLASS_NAME}: no such video: ${kw.uid}`);
            return -1;
        }
        play_temp([v], 0);
        return 0;
    }
    play_temp(list, i);
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

function ac_play_group(gobj, event, kw, src)
{
    let list = group_videos(gobj, kw);
    if(!list.length) {
        log_error(`${GCLASS_NAME}: empty group: ${kw.kind}`);
        return -1;
    }
    play_temp(list, 0);
    return 0;
}

function ac_add_group(gobj, event, kw, src)
{
    let list = group_videos(gobj, kw);
    if(!list.length) {
        log_error(`${GCLASS_NAME}: empty group: ${kw.kind}`);
        return -1;
    }
    queue_add(list, "append");
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
            ["EV_SET_VIEW",         ac_set_view,        null],
            ["EV_SEARCH",           ac_search,          null],
            ["EV_OPEN_SOURCE",      ac_open_source,     null],
            ["EV_OPEN_DIR",         ac_open_dir,        null],
            ["EV_CRUMB",            ac_crumb,           null],
            ["EV_OPEN_SHOW",        ac_open_show,       null],
            ["EV_PLAY_ROW",         ac_play_row,        null],
            ["EV_ADD_ROW",          ac_add_row,         null],
            ["EV_HEART_ROW",        ac_heart_row,       null],
            ["EV_PLAY_GROUP",       ac_play_group,      null],
            ["EV_ADD_GROUP",        ac_add_group,       null],
            ["EV_OPEN_CARD",        ac_open_card,       null],
            ["EV_CARD_ACTION",      ac_card_action,     null],
            ["EV_GO",               ac_go,              null]
        ]]
    ];

    const event_types = [
        ["EV_STORE",            0],
        ["EV_LANGUAGE_CHANGED", 0],
        ["EV_ROUTE_CHANGED",    0],
        ["EV_SET_VIEW",         0],
        ["EV_SEARCH",           0],
        ["EV_OPEN_SOURCE",      0],
        ["EV_OPEN_DIR",         0],
        ["EV_CRUMB",            0],
        ["EV_OPEN_SHOW",        0],
        ["EV_PLAY_ROW",         0],
        ["EV_ADD_ROW",          0],
        ["EV_HEART_ROW",        0],
        ["EV_PLAY_GROUP",       0],
        ["EV_ADD_GROUP",        0],
        ["EV_OPEN_CARD",        0],
        ["EV_CARD_ACTION",      0],
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

function register_c_vid_library()
{
    return create_gclass(GCLASS_NAME);
}

export {register_c_vid_library};
