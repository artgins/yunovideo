/***********************************************************************
 *          c_vid_sources.js
 *
 *      C_VID_SOURCES — the authorised folders, listed and managed, and
 *      the ONLY place videos are added from. One door is better than
 *      three.
 *
 *      This is where the app is honest about what it does with your
 *      disk, in the interface and not just in a README:
 *
 *        - no file is copied and no file is uploaded — only a reference
 *          to what is already on your disk is kept;
 *        - a folder is taken WHOLE, that folder and every one below;
 *        - subtitles are read from beside the videos, and nowhere else;
 *        - which videos play is up to this browser's decoders, and the
 *          app says which ones it could not, rather than guessing;
 *        - what this particular browser can and cannot remember.
 *
 *      A folder the browser wants re-confirmed after a reload carries an
 *      Authorise button: re-granting a permission must be a deliberate
 *      click, and the browser demands the gesture anyway — which is why
 *      every button here reaches its action synchronously, through the
 *      FSM, inside the click.
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
    subscribe_sources, all_sources, fsa_supported, is_persistent,
    is_durable, write_failed, is_blocked, diagnose,
    add_dir, add_files, authorize, scan, remove_source,
    source_notice, dismiss_notice, accept_notice,
} from "./sources_store.js";
import {
    subscribe, videos_of_source, queue_add, store_state, open_in_library,
} from "./video_store.js";
import {count_pair} from "./plural.js";
import {P, ico, named, clear, disabled_if} from "./ui.js";

import {t} from "i18next";


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_VID_SOURCES";


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
    $content:   null,
    diag_open:  false,
    diag_text:  "",
    confirming: "",     // id of the source awaiting a remove confirmation
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
        createElement2(["div", {class: "C_VID_SOURCES VID_VIEW"}, [$content]]));
}

/***************************************************************
 *          Framework Method: Start
 ***************************************************************/
function mt_start(gobj)
{
    let priv = gobj.priv;
    priv.confirming = "";
    const send = (channel) => gobj_send_event(gobj, "EV_STORE", {channel: channel}, gobj);
    priv.unsubs = [
        subscribe_sources(() => send("sources")),
        subscribe(function(channel) {
            if(channel === "library" || channel === "loading") {
                send(channel);
            }
        }),
    ];
    let shell = yui_shell_of(gobj);
    if(shell) {
        gobj_subscribe_event(shell, "EV_LANGUAGE_CHANGED", {}, gobj);
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




function render(gobj)
{
    let priv = gobj.priv;
    let $c = priv.$content;
    let scroll = $c.scrollTop;
    clear($c);

    $c.appendChild(build_header(gobj));
    let $note = build_notice(gobj);
    if($note) {
        $c.appendChild($note);
    }
    $c.appendChild(build_explainer());

    let sources = all_sources();
    if(!sources.length) {
        $c.appendChild(createElement2(["p", {class: "VID_EMPTY", i18n: "no sources yet"},
            t("no sources yet")]));
    } else {
        let $list = createElement2(["div", {class: "VID_SRCLIST"}, []]);
        for(const s of sources) {
            $list.appendChild(build_source_row(gobj, s));
        }
        $c.appendChild($list);
    }
    $c.appendChild(build_diagnostics(gobj));
    refresh_language($c, t);
    $c.scrollTop = scroll;
}

function build_header(gobj)
{
    const send = (ev) => () => gobj_send_event(gobj, ev, {}, gobj);
    return createElement2(
        ["header", {class: "VID_SECHEAD"}, [
            ["h1", {class: "VID_SECTITLE", i18n: "authorised sources"}, t("authorised sources")],
            ["div", {class: "VID_QACTIONS"}, [
                ["button", {class: "VID_QBTN button is-primary VID_ADDDIR", type: "button",
                            ...named("add a folder")},
                    [ico(P.folder, 16), ["span", {i18n: "add a folder"}, t("add a folder")]],
                    {click: send("EV_ADD_DIR")}],
                ["button", {class: "VID_QBTN button VID_ADDFILES", type: "button",
                            ...named("add loose files")},
                    [ico(P.file, 16), ["span", {i18n: "add loose files"}, t("add loose files")]],
                    {click: send("EV_ADD_FILES")}]
            ]]
        ]]
    );
}

/*  What the last pick ran into, said next to the buttons that made it
    happen — and, for a folder that CONTAINS folders already in, asked:
    taking it drops those, with their counts and their places. */
function build_notice(gobj)
{
    const n = source_notice();
    if(!n) {
        return null;
    }
    const send = (ev) => () => gobj_send_event(gobj, ev, {}, gobj);
    let actions = [];
    if(n.pending) {
        actions.push(["button", {class: "VID_QBTN button is-danger", type: "button",
                                 i18n: "remove it and add this", ...named("remove it and add this")},
            t("remove it and add this"), {click: send("EV_ACCEPT_NOTICE")}]);
        actions.push(["button", {class: "VID_QBTN button is-ghost", type: "button",
                                 i18n: "cancel", ...named("cancel")},
            t("cancel"), {click: send("EV_DISMISS_NOTICE")}]);
    } else {
        actions.push(["button", {class: "VID_QBTN button is-ghost", type: "button",
                                 i18n: "understood", ...named("understood")},
            t("understood"), {click: send("EV_DISMISS_NOTICE")}]);
    }
    return createElement2(
        ["div", {class: "VID_SRCNOTE is-warn", role: "status"}, [
            ["p", {class: "VID_SRCNOTE_TEXT"},
                t(/* i18n: SOURCE_NOTICE_I18N_KEYS */ n.kind,
                  {name: n.name, other: n.other, count: n.skipped || 0})],
            ["div", {class: "VID_SRCNOTE_ACTIONS"}, actions]
        ]]
    );
}

/*  The keys a pick can end in, handed by variable above. */
export const SOURCE_NOTICE_I18N_KEYS = [
    "folder already added",
    "folder inside another",
    "folder contains others",
    "files already added",
    "some were already in",
    "no videos here",
];

function build_explainer()
{
    let persists = fsa_supported() && is_persistent();
    let key = persists ? "sources persist" : "sources do not persist";
    let children = [
        ["p", {i18n: "nothing is copied"}, t("nothing is copied")],
        ["p", {i18n: "folders are recursive"}, t("folders are recursive")],
        ["p", {class: "VID_DIM", i18n: "subtitles explained"}, t("subtitles explained")],
        ["p", {class: "VID_DIM", i18n: "formats explained"}, t("formats explained")],
        ["p", {class: "VID_DIM", i18n: key}, t(key)]
    ];
    if(!fsa_supported()) {
        children.push(["p", {class: "VID_DIM", i18n: "upload warning explained"},
            t("upload warning explained")]);
    } else {
        children.push(["p", {class: "VID_DIM", i18n: "allow on every visit"},
            t("allow on every visit")]);
    }
    if(is_blocked()) {
        children.push(["p", {class: "is-warn", i18n: "another tab is holding it"},
            t("another tab is holding it")]);
    } else if(!is_persistent() || write_failed()) {
        children.push(["p", {class: "is-warn", i18n: "could not be saved"},
            t("could not be saved")]);
    } else if(is_durable() === false) {
        children.push(["p", {class: "is-warn", i18n: "storage may be cleared"},
            t("storage may be cleared")]);
    }
    return createElement2(["div", {class: "VID_EXPLAIN"}, children]);
}

/*  The states a source row can be in, by key. */
export const SOURCE_STATE_I18N_KEYS = [
    "permission denied",
    "could not be read",
    "stopped",
    "no videos here",
];

function build_source_row(gobj, s)
{
    let needs_auth = (s.permission !== "granted");
    let kind_key = (s.kind === "dir") ? "folder" : "files";
    const send = (ev) => () => gobj_send_event(gobj, ev, {source_id: s.id}, gobj);

    let meta = ["div", {class: "VID_SRCMETA"}, [
        ["div", {class: "VID_T1"}, s.name],
        ["div", {class: "VID_T2"}, [
            ["span", {i18n: kind_key}, t(kind_key)],
            ["span", {class: "VID_SEP"}, "·"],
            ...count_pair(s.count, "n videos")
        ]]
    ]];

    let state = null;
    if(s.scanning) {
        let st = store_state();
        let total = st.total || 0;
        let pct = total ? Math.round((st.loaded / total) * 100) : 0;
        let line = [
            ["span", {class: "VID_SPINNER", "aria-hidden": "true"}],
            ["span", {i18n: "reading"}, t("reading")]
        ];
        line.push(["span", {class: "VID_SRCPROGRESS_COUNT"}, total ? st.loaded + " / " + total : ""]);
        state = ["div", {class: "VID_SRCSTATE VID_SRCPROGRESS", role: "status"}, [
            ["div", {class: "VID_SRCPROGRESS_LINE"}, line],
            ["div", {class: "VID_BAR"}, [
                ["i", {class: "VID_BAR_FILL" + (total ? "" : " is-indeterminate"),
                       style: total ? `width:${pct}%` : ""}]
            ]]
        ]];
    } else if(s.queued) {
        state = ["div", {class: "VID_SRCSTATE VID_DIM", i18n: "waiting its turn"}, t("waiting its turn")];
    } else if(needs_auth) {
        let k = (s.permission === "denied") ? "permission denied" : "waiting for permission";
        state = ["div", {class: "VID_SRCSTATE is-warn", i18n: k}, t(k)];
    } else if(s.error) {
        state = ["div", {class: "VID_SRCSTATE is-warn", i18n: /* i18n: SOURCE_STATE_I18N_KEYS */ s.error},
            t(/* i18n: SOURCE_STATE_I18N_KEYS */ s.error)];
    } else if(s.kind === "files") {
        state = ["div", {class: "VID_SRCSTATE VID_DIM", i18n: "snapshot warning"}, t("snapshot warning")];
    }

    const action = (cls, key, path, ev, extra) =>
        ["button", {class: "VID_QBTN button " + cls, type: "button", ...named(key), ...(extra || {})},
            [ico(path, 15), ["span", {class: "VID_QLABEL", i18n: key}, t(key)]],
            {click: send(ev)}];

    let actions = [];
    /*  LOOK INSIDE: a door to the library's folder tree at this source,
        not a second browser grown inside Sources. */
    if(!needs_auth && s.count) {
        actions.push(action("VID_LOOK", "look inside", P.look, "EV_LOOK_INSIDE"));
    }
    if(needs_auth) {
        actions.push(action("is-primary VID_AUTH", "authorise", P.key, "EV_AUTHORIZE"));
    } else {
        if(s.rescannable) {
            actions.push(action("VID_RESCAN", "rescan", P.refresh, "EV_RESCAN"));
        }
        actions.push(action("VID_ADDSRC", "add to queue", P.enqueue, "EV_ADD_SOURCE",
            disabled_if(!s.count)));
    }
    /*  Removing a source drops its videos, their counts and their
        places: asked in the row, where the finger already is. */
    if(gobj.priv.confirming === s.id) {
        actions.push(["button", {class: "VID_QBTN button is-danger VID_REMOVE_YES", type: "button",
                                 i18n: "remove this source?", ...named("remove this source?")},
            t("remove this source?"), {click: send("EV_REMOVE_YES")}]);
        actions.push(["button", {class: "VID_QBTN button is-ghost", type: "button",
                                 i18n: "cancel", ...named("cancel")},
            t("cancel"), {click: send("EV_REMOVE_NO")}]);
    } else {
        actions.push(action("is-ghost VID_REMOVESRC", "remove this source", P.trash, "EV_REMOVE_ASK"));
    }

    return createElement2(["article", {class: "VID_SRCROW"}, [
        meta, state, ["div", {class: "VID_SRCACTIONS"}, actions]
    ].filter(Boolean)]);
}

/*  The readout is probed only when the panel is OPENED: one line of it
    touches the disk, and this view repaints on every scan tick. */
function build_diagnostics(gobj)
{
    let priv = gobj.priv;
    let $body = createElement2(["pre", {class: "VID_DIAG_BODY"}, priv.diag_text || "…"]);
    let $wrap = createElement2(
        ["details", {class: "VID_DIAG"}, [
            ["summary", {class: "VID_DIAG_SUM", i18n: "diagnostics"}, t("diagnostics")],
            ["div", {class: "VID_DIAG_ACTIONS"}, [
                ["button", {class: "VID_QBTN button is-ghost VID_DIAG_COPY", type: "button",
                            i18n: "copy", ...named("copy")},
                    t("copy"), {click: () => gobj_send_event(gobj, "EV_COPY_DIAG", {}, gobj)}]
            ]],
            $body
        ]]
    );
    if(priv.diag_open) {
        $wrap.open = true;
    }
    $wrap.addEventListener("toggle", function() {
        if($wrap.open !== priv.diag_open) {
            gobj_send_event(gobj, "EV_DIAG_TOGGLE", {open: $wrap.open}, gobj);
        }
    });
    return $wrap;
}

function fill_diagnostics(gobj)
{
    diagnose().then(function(lines) {
        gobj.priv.diag_text = lines.map((l) => l.k.padEnd(22) + " " + l.v).join("\n");
        let $b = gobj.priv.$content.querySelector(".VID_DIAG_BODY");
        if($b) {
            $b.textContent = gobj.priv.diag_text;
        }
    });
}




                    /***************************
                     *      Actions
                     ***************************/




/*  A folder being read reports every ~120 ms. That moves a count and
    a bar, written in place: a rebuild that often swallowed taps (the
    press and the release landing on two different buttons) and shut
    the diagnostics. Whatever else changes, the screen is rebuilt. */
function paint_progress(gobj)
{
    let $p = gobj.priv.$content.querySelector(".VID_SRCPROGRESS");
    let st = store_state();
    if(!$p || !st.loading) {
        return false;
    }
    let total = st.total || 0;
    let $count = $p.querySelector(".VID_SRCPROGRESS_COUNT");
    let $fill = $p.querySelector(".VID_BAR_FILL");
    if(!$count || !$fill) {
        return false;
    }
    $count.textContent = total ? st.loaded + " / " + total : "";
    $fill.classList.toggle("is-indeterminate", !total);
    $fill.style.width = total ? Math.round((st.loaded / total) * 100) + "%" : "";
    return true;
}

function ac_store(gobj, event, kw, src)
{
    if(kw.channel === "loading" && paint_progress(gobj)) {
        return 0;
    }
    render(gobj);
    return 0;
}

function ac_language_changed(gobj, event, kw, src)
{
    render(gobj);
    return 0;
}

function ac_add_dir(gobj, event, kw, src)
{
    add_dir();
    return 0;
}

function ac_add_files(gobj, event, kw, src)
{
    add_files();
    return 0;
}

function ac_accept_notice(gobj, event, kw, src)
{
    accept_notice();
    return 0;
}

function ac_dismiss_notice(gobj, event, kw, src)
{
    dismiss_notice();
    return 0;
}

function ac_look_inside(gobj, event, kw, src)
{
    open_in_library({source_id: kw.source_id});
    let shell = yui_shell_of(gobj);
    if(shell) {
        yui_shell_navigate(shell, "/library");
    }
    return 0;
}

function ac_authorize(gobj, event, kw, src)
{
    authorize(kw.source_id);
    return 0;
}

function ac_rescan(gobj, event, kw, src)
{
    scan(kw.source_id, true);
    return 0;
}

function ac_add_source(gobj, event, kw, src)
{
    queue_add(videos_of_source(kw.source_id), "append");
    return 0;
}

function ac_remove_ask(gobj, event, kw, src)
{
    gobj.priv.confirming = kw.source_id;
    render(gobj);
    return 0;
}

function ac_remove_yes(gobj, event, kw, src)
{
    gobj.priv.confirming = "";
    remove_source(kw.source_id);
    return 0;
}

function ac_remove_no(gobj, event, kw, src)
{
    gobj.priv.confirming = "";
    render(gobj);
    return 0;
}

function ac_diag_toggle(gobj, event, kw, src)
{
    gobj.priv.diag_open = !!kw.open;
    if(kw.open) {
        fill_diagnostics(gobj);
    }
    return 0;
}

function ac_copy_diag(gobj, event, kw, src)
{
    let text = gobj.priv.diag_text || "";
    if(navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => {
            log_error(`${GCLASS_NAME}: clipboard refused the diagnostics`);
        });
        return 0;
    }
    /*  No clipboard: select it, so it can be copied by hand. */
    let $b = gobj.priv.$content.querySelector(".VID_DIAG_BODY");
    if($b) {
        let r = document.createRange();
        r.selectNodeContents($b);
        let sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(r);
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
            ["EV_ADD_DIR",          ac_add_dir,         null],
            ["EV_ADD_FILES",        ac_add_files,       null],
            ["EV_ACCEPT_NOTICE",    ac_accept_notice,   null],
            ["EV_DISMISS_NOTICE",   ac_dismiss_notice,  null],
            ["EV_LOOK_INSIDE",      ac_look_inside,     null],
            ["EV_AUTHORIZE",        ac_authorize,       null],
            ["EV_RESCAN",           ac_rescan,          null],
            ["EV_ADD_SOURCE",       ac_add_source,      null],
            ["EV_REMOVE_ASK",       ac_remove_ask,      null],
            ["EV_REMOVE_YES",       ac_remove_yes,      null],
            ["EV_REMOVE_NO",        ac_remove_no,       null],
            ["EV_DIAG_TOGGLE",      ac_diag_toggle,     null],
            ["EV_COPY_DIAG",        ac_copy_diag,       null]
        ]]
    ];

    const event_types = [
        ["EV_STORE",            0],
        ["EV_LANGUAGE_CHANGED", 0],
        ["EV_ADD_DIR",          0],
        ["EV_ADD_FILES",        0],
        ["EV_ACCEPT_NOTICE",    0],
        ["EV_DISMISS_NOTICE",   0],
        ["EV_LOOK_INSIDE",      0],
        ["EV_AUTHORIZE",        0],
        ["EV_RESCAN",           0],
        ["EV_ADD_SOURCE",       0],
        ["EV_REMOVE_ASK",       0],
        ["EV_REMOVE_YES",       0],
        ["EV_REMOVE_NO",        0],
        ["EV_DIAG_TOGGLE",      0],
        ["EV_COPY_DIAG",        0]
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

function register_c_vid_sources()
{
    return create_gclass(GCLASS_NAME);
}

export {register_c_vid_sources};
