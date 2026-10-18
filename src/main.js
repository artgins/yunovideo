/***********************************************************************
 *          main.js
 *
 *      yunovídeo — entry point.
 *
 *      Wires the gobj-js kernel + the v2 shell/nav stack, registers the
 *      app's gclasses (C_YUNOVIDEO host + the four routed views), and
 *      starts a yuno whose default service hosts the shell. All
 *      navigation structure lives in app_config.json.
 *
 *      Import policy: pull the specific gobj-ui modules (shell + nav),
 *      NOT the @yuneta/gobj-ui/index.js barrel — the barrel transitively
 *      loads chart/map components this app does not use.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    gobj_start_up,
    gobj_create_yuno,
    gobj_create_default_service,
    gobj_start,
    gobj_play,
    register_c_yuno,
    register_c_timer,
    db_load_persistent_attrs,
    db_save_persistent_attrs,
    db_remove_persistent_attrs,
    db_list_persistent_attrs,
    gobj_global_trace_level,
    gobj_get_gclass_trace_level2,
    gclass_find_by_name,
    set_strings_are_text,
} from "@yuneta/gobj-js";

import {register_c_yui_shell} from "@yuneta/gobj-ui/src/c_yui_shell.js";
import {register_c_yui_nav}   from "@yuneta/gobj-ui/src/c_yui_nav.js";

import {register_c_yunovideo}   from "./c_yunovideo.js";
import {register_c_vid_deck}    from "./c_vid_deck.js";
import {register_c_vid_library} from "./c_vid_library.js";
import {register_c_vid_sources} from "./c_vid_sources.js";
import {register_c_vid_lists}   from "./c_vid_lists.js";

import {setup_locale} from "./locales/locales.js";
import {start_offline} from "./offline.js";
import {start_diag} from "./diag.js";

import "bulma/css/bulma.css";
import "@yuneta/gobj-ui/src/c_yui_shell.css";
import "@yuneta/gobj-ui/src/yui_icons.css";
import "./video.css";

import app_config from "./app_config.json";


/***************************************************************
 *  The black box, started before anything else can fail.
 *
 *  It is at module scope and not inside main() on purpose: it
 *  installs the window error handlers, and an exception thrown
 *  while the gclasses are being registered is exactly the kind
 *  of thing worth having a record of.
 ***************************************************************/
start_diag();


/***************************************************************
 *  Developer traces survive a launch — and they have to.
 *
 *  The bug they are switched on for is often the app RESTARTING
 *  by itself: if a restart also turned the tracing off, the one
 *  event under investigation would be the one event that ends
 *  the investigation. The trace levels are the yuno's: it
 *  persists them and restores them when it is created (gobj-js
 *  C_YUNO, `trace_levels`). So they are asked of the runtime
 *  here, and the panel's own code — a big module this app
 *  otherwise never needs — is fetched only if something is
 *  actually switched on, to take the traffic into its window.
 ***************************************************************/
function restore_traces()
{
    /*  This app opens no websocket and registers no C_IEVENT_CLI: asking
     *  for its levels anyway logged "gclass NOT FOUND" on every start.  */
    let wanted = gobj_global_trace_level() !== 0 ||
        (!!gclass_find_by_name("C_IEVENT_CLI") &&
            gobj_get_gclass_trace_level2("C_IEVENT_CLI").length > 0);
    try {
        if(Number(JSON.parse(window.localStorage.getItem("trace_i18n") || "0"))) {
            wanted = true;
        }
    } catch(e) {
        /*  A key we cannot read is a key that is not set. */
    }
    if(!wanted) {
        return;
    }
    import("@yuneta/gobj-ui/src/yui_dev.js").then(function(mod) {
        mod.apply_dev_traces();
    }).catch(function() {
        /*  No panel, no traces: not worth a word on screen. */
    });
}


/***************************************************************
 *          main()
 ***************************************************************/
function main()
{
    /*  Register gclasses */
    register_c_yuno();
    register_c_timer();

    register_c_yui_shell();
    register_c_yui_nav();

    register_c_yunovideo();
    register_c_vid_deck();
    register_c_vid_library();
    register_c_vid_sources();
    register_c_vid_lists();

    /*  i18n before anything paints: the locale also decides the writing
        direction the whole layout is built in. */
    setup_locale();

    /*  Start yuneta. What this app remembers it remembers itself, in
        IndexedDB (see idb.js); the persistence backend here carries only
        the framework's own persistent attrs -- the yuno's trace levels. */
    /*
     *  A plain string given to createElement2() is TEXT, never markup:
     *  markup is said with html_markup() (gobj-js 7.26.3+, gobj-ui
     *  7.26.10+ pass all theirs that way). A string that starts with
     *  '<' is logged once -- a datum that used to run as html.
     */
    set_strings_are_text(true);

    gobj_start_up(
        null,
        db_load_persistent_attrs,
        db_save_persistent_attrs,
        db_remove_persistent_attrs,
        db_list_persistent_attrs,
        null,
        null
    );

    let yuno = gobj_create_yuno(
        "video_yuno",
        "C_YUNO",
        {
            yuno_name:    "yunovídeo",
            yuno_role:    "yunovideo",
            yuno_version: __APP_VERSION__
        }
    );

    gobj_create_default_service(
        "video",
        "C_YUNOVIDEO",
        {
            config:   app_config,
            use_hash: true
        },
        yuno
    );

    gobj_start(yuno);
    gobj_play(yuno);

    /*  After the yuno exists: it has restored its trace levels. */
    restore_traces();
}


/***************************************************************
 *          Bootstrap on window load
 ***************************************************************/
window.addEventListener("load", function() {
    main();
    /*  After main(), never before: the offline cache is what the NEXT
        launch boots from, so it must not compete with this one. */
    start_offline();
});
