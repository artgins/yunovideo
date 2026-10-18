/***********************************************************************
 *          dev_dialog.js
 *
 *      The Developer sheet: two panes behind one door.
 *
 *      "Session log" is the black box (diag.js) read back — the boots,
 *      the freezes, the heap curve, and the one sentence that matters:
 *      did the last run end, or was it ended? It is first because it is
 *      the pane that answers a question nobody can answer while it is
 *      happening: the app stopping by itself in the middle of a drive.
 *
 *      "Traces" is the framework's own developer panel from gobj-ui —
 *      automata, creation, start/stop, subscriptions, inter-event
 *      traffic. It is loaded on demand, not at boot: it is a large piece
 *      of code that nobody needs until they open this, and this app is
 *      one that has to start on a phone with no network. The trace
 *      SWITCHES, though, are remembered in localStorage and re-applied
 *      on every launch (see main.js) — otherwise a restart would be the
 *      one event that turns the tracing off, which is precisely the
 *      event we are trying to watch.
 *
 *      Its controls send EV_DIALOG {dialog: "dev"} to the gobj that
 *      opened it, and that gobj's action hands the kw to dev_action().
 *      So do the answers that come late: the traces panel loaded, the
 *      clipboard done.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    createElement2, refresh_language, log_error, log_warning, gobj_send_event,
    gobj_command, gobj_yuno, gobj_get_gclass_trace_level2,
} from "@yuneta/gobj-js";

import {yui_shell_show_modal} from "@yuneta/gobj-ui/src/shell_modals.js";
import {named} from "./ui.js";

import {
    diag_journal, diag_line, diag_time, diag_duration, diag_report, diag_clear,
    diag_last_death, diag_death_count, diag_boot_count,
} from "./diag.js";

import {t} from "i18next";


/*  The app's trace levels: [level of C_YUNOVIDEO, label key, title key]. */
const APP_TRACES = [
    ["stores",      "the stores",       "trace the stores"],
    ["stores-time", "the stores' clock", "trace the stores' clock"],
];
export const APP_TRACE_I18N_KEYS = [
    "the stores", "trace the stores", "the stores' clock", "trace the stores' clock",
];
const APP_GCLASS = "C_YUNOVIDEO";

/*  Set through the yuno's own command, as gobj-ui's chips do: the yuno
    keeps the levels across launches. */
function toggle_app_trace(level)
{
    let on = gobj_get_gclass_trace_level2(APP_GCLASS).includes(level);
    let r = gobj_command(gobj_yuno(), "set-gclass-trace",
        {gclass_name: APP_GCLASS, level: level, set: on ? 0 : 1}, gobj_yuno());
    if(!r || r.result < 0) {
        log_error(`dev_dialog: set-gclass-trace ${level}: ${r ? r.comment : "no answer"}`);
    }
    paint_app_traces();
}

function paint_app_traces()
{
    let levels = gobj_get_gclass_trace_level2(APP_GCLASS);
    for(const $b of panes.$traces.querySelectorAll(".VID_DEV_CHIP")) {
        let on = levels.includes($b.getAttribute("data-level"));
        $b.classList.toggle("is-on", on);
        $b.setAttribute("aria-pressed", on ? "true" : "false");
    }
}

/*  The open sheet, so a second tap on the menu closes it instead of
    stacking a second one. */
let $sheet = null;
let opener = null;          // the gobj that opened it, and gets its events
let panes = null;           // {$tabs, $log, $traces}
let loaded_traces = false;
let traces_mod = null;      // gobj-ui's yui_dev module, once loaded
/*  What the traces panel wants doing when the sheet goes away (it turns
    the inter-event tap back off). */
let dispose_traces = null;
let paint_log = null;       // repaints the session log pane
let $copy_btn = null;


function send(act, extra)
{
    if(!opener) {
        log_error(`dev_dialog: ${act} with no opener`);
        return;
    }
    gobj_send_event(opener, "EV_DIALOG", Object.assign({dialog: "dev", act: act}, extra || {}), opener);
}


/***************************************************************
 *          Open / close
 ***************************************************************/
function open_developer(gobj, shell)
{
    if($sheet) {
        close_developer();
        return;
    }
    opener = gobj;
    loaded_traces = false;

    let $body = createElement2(["div", {class: "VID_DEV"}, []]);

    let $log_pane = build_log_pane();
    /*  The app's own levels first: what the stores do outside the
        machine (trace.js). gobj-ui's panel, below, has chips for the
        framework's levels and none for an app's. */
    let $trace_pane = createElement2(
        ["div", {class: "VID_DEV_PANE VID_DEV_TRACES", hidden: "hidden"}, [
            ["div", {class: "VID_DEV_APPTRACES"}, APP_TRACES.map(([level, key, title]) =>
                ["button", {class: "VID_DEV_CHIP button is-small", type: "button",
                            "data-level": level, i18n: /* i18n: APP_TRACE_I18N_KEYS */ key,
                            ...named(title)},
                    t(/* i18n: APP_TRACE_I18N_KEYS */ key), {click: () => send("trace", {level: level})}])],
            ["div", {class: "VID_DEV_TRACES_PANEL"}, [
                ["p", {class: "VID_DEV_WAIT", i18n: "loading"}, t("loading")]
            ]]
        ]]
    );

    let $tabs = createElement2(
        ["div", {class: "VID_DEV_TABS", role: "tablist"}, [
            ["button", {class: "VID_DEV_TAB is-on", type: "button",
                        "data-pane": "log", i18n: "session log", ...named("session log")},
                t("session log"), {click: () => send("tab", {pane: "log"})}],
            ["button", {class: "VID_DEV_TAB", type: "button",
                        "data-pane": "traces", i18n: "traces", ...named("traces")},
                t("traces"), {click: () => send("tab", {pane: "traces"})}]
        ]]
    );

    $body.appendChild($tabs);
    $body.appendChild($log_pane);
    $body.appendChild($trace_pane);
    panes = {$tabs: $tabs, $log: $log_pane, $traces: $trace_pane,
             $panel: $trace_pane.querySelector(".VID_DEV_TRACES_PANEL")};
    paint_app_traces();

    let modal = yui_shell_show_modal(shell, $body, {
        dialog:        true,
        logical_class: "VID_DEV_SHEET",
        title:         "developer",
        t:             t,
        on_close:      function() {
            /*  The shell closed it (its button, Escape, the backdrop):
                what the sheet holds is let go. */
            $sheet = null;
            panes = null;
            paint_log = null;
            $copy_btn = null;
            opener = null;
            if(dispose_traces) {
                try {
                    dispose_traces();
                } catch(e) {
                    log_error(`dev_dialog: the traces panel failed to close: ${(e && e.stack) || e}`);
                }
                dispose_traces = null;
            }
        }
    });
    $sheet = modal;
    refresh_language($body, t);
}


function close_developer()
{
    if($sheet) {
        let m = $sheet;
        $sheet = null;
        m.close();
    }
}


/***************************************************************
 *  What its controls do — and what comes back late — run from
 *  the opener's FSM.
 ***************************************************************/
function dev_action(kw)
{
    if(!panes) {
        /*  Closed while an answer was on its way (the panel loading,
            the clipboard): nothing left to paint it on. */
        return 0;
    }
    switch(kw.act) {
        case "tab":
            show_pane(kw.pane);
            return 0;
        case "copy":
            copy_report();
            return 0;
        case "copied":
            mark_copied();
            return 0;
        case "copy_by_hand":
            if(fallback(diag_report())) {
                mark_copied();
            }
            return 0;
        case "copy_label":
            if($copy_btn) {
                $copy_btn.textContent = t($copy_btn.getAttribute("data-i18n") || "copy");
            }
            return 0;
        case "refresh":
            paint_log(true);
            return 0;
        case "clear":
            diag_clear();
            paint_log(true);
            return 0;
        case "trace":
            toggle_app_trace(kw.level);
            return 0;
        case "traces_loaded":
            show_traces_panel();
            return 0;
        case "traces_failed":
            clear(panes.$panel);
            panes.$panel.appendChild(createElement2(
                ["p", {class: "VID_DEV_WAIT"}, String(kw.message || "")]
            ));
            return 0;
        default:
            log_error(`dev_dialog: unknown action: ${kw.act}`);
            return -1;
    }
}

function show_pane(want)
{
    for(const $b of panes.$tabs.querySelectorAll(".VID_DEV_TAB")) {
        $b.classList.toggle("is-on", $b.getAttribute("data-pane") === want);
    }
    panes.$log.hidden = (want !== "log");
    panes.$traces.hidden = (want !== "traces");
    if(want === "traces" && !loaded_traces) {
        loaded_traces = true;
        load_traces();
    }
}


/***************************************************************
 *  The framework panel, fetched only now. A failure here is not
 *  an app failure: the session log — the pane that matters for
 *  the bug this was built for — is already on screen.
 ***************************************************************/
function load_traces()
{
    import("@yuneta/gobj-ui/src/yui_dev.js").then(function(mod) {
        traces_mod = mod;
        send("traces_loaded");
    }, function(err) {
        log_warning(`dev_dialog: the traces panel did not load: ${(err && err.message) || err}`);
        send("traces_failed", {message: String((err && err.message) || err)});
    });
}

function show_traces_panel()
{
    let panel = traces_mod.build_dev_panel();
    clear(panes.$panel);
    panes.$panel.appendChild(panel.$el);
    dispose_traces = panel.dispose;
}


                    /***************************
                     *      The session log
                     ***************************/


function build_log_pane()
{
    let $pane = createElement2(["div", {class: "VID_DEV_PANE"}, []]);

    let $verdict = createElement2(["div", {class: "VID_DEV_VERDICT"}, []]);
    let $lines = createElement2(["pre", {class: "VID_DEV_LOG"}, []]);

    let $bar = createElement2(
        ["div", {class: "VID_DEV_BAR"}, [
            ["button", {class: "VID_DEV_BTN VID_DEV_COPY button is-small", type: "button",
                        i18n: "copy", ...named("copy")},
                t("copy"), {click: () => send("copy")}],
            ["button", {class: "VID_DEV_BTN VID_DEV_REFRESH button is-small", type: "button",
                        i18n: "refresh", ...named("refresh")},
                t("refresh"), {click: () => send("refresh")}],
            ["button", {class: "VID_DEV_BTN VID_DEV_CLEAR button is-small", type: "button",
                        i18n: "clear log", ...named("clear log")},
                t("clear log"), {click: () => send("clear")}]
        ]]
    );

    $pane.appendChild($verdict);
    $pane.appendChild($bar);
    $pane.appendChild($lines);
    $copy_btn = $bar.querySelector(".VID_DEV_COPY");

    function paint(retranslate)
    {
        clear($verdict);
        for(const node of build_verdict()) {
            $verdict.appendChild(createElement2(node));
        }

        let journal = diag_journal();
        /*  Newest first: the reason anyone opens this is something that
            just happened, and scrolling to the bottom of four hours of
            heartbeats to find it is not reading, it is archaeology. */
        $lines.textContent = journal.length
            ? journal.slice().reverse().map(diag_line).join("\n")
            : "";
        if(!journal.length) {
            $lines.textContent = t("log empty");
            $lines.setAttribute("data-i18n", "log empty");
        } else {
            $lines.removeAttribute("data-i18n");
        }
        if(retranslate) {
            refresh_language($verdict, t);
        }
    }

    paint(false);
    paint_log = paint;
    return $pane;
}


/***************************************************************
 *  The sentence at the top. Everything below it is evidence;
 *  this is the reading of it.
 ***************************************************************/
function build_verdict()
{
    let out = [];
    /*  A DEATH, not merely a launch: diag.js does the telling apart, so
        a page anyone reloads twice a day is not accused of crashing. */
    let death = diag_last_death();
    let deaths = diag_death_count(24);
    let boots = diag_boot_count(24);

    if(!death) {
        out.push(["p", {class: "VID_DEV_OK", i18n: "no unexpected stop"},
            t("no unexpected stop")]);
    } else {
        out.push(["p", {class: "VID_DEV_BAD", i18n: "last unexpected stop"},
            t("last unexpected stop")]);
        out.push(["p", {class: "VID_DEV_FACT"}, diag_time(death.t)]);

        if(death.discarded) {
            out.push(["p", {class: "VID_DEV_FACT", i18n: "browser discarded the app"},
                t("browser discarded the app")]);
        }
        if(death.was_playing && death.was_track) {
            out.push(["p", {class: "VID_DEV_FACT"}, [
                ["span", {i18n: "stopped while playing"}, t("stopped while playing")],
                ["span", {class: "VID_DEV_VAL"}, death.was_track]
            ]]);
        }
        out.push(["p", {class: "VID_DEV_FACT"}, [
            ["span", {i18n: "silent for"}, t("silent for")],
            ["span", {class: "VID_DEV_VAL"}, diag_duration(death.gap_s)]
        ]]);
        if(death.was_heap !== null) {
            out.push(["p", {class: "VID_DEV_FACT"}, [
                ["span", {i18n: "memory in use"}, t("memory in use")],
                ["span", {class: "VID_DEV_VAL"}, [
                    ["span", {}, String(death.was_heap)],
                    " ",    // a real space: read, copied and heard as "812 MB"
                    ["span", {class: "VID_UNIT", i18n: "unit mb"}, t("unit mb")]
                ]]
            ]]);
        }
    }

    /*  Two counts, because they answer two different questions. The
        user said "two or three times in four hours" — that is the
        SECOND number. The first is every launch, deliberate ones
        included, and it is the denominator that makes the second one
        mean something. */
    if(deaths) {
        out.push(["p", {class: "VID_DEV_FACT"}, [
            ["span", {i18n: "unexpected stops today"}, t("unexpected stops today")],
            ["span", {class: "VID_DEV_VAL"}, String(deaths)]
        ]]);
    }
    out.push(["p", {class: "VID_DEV_FACT"}, [
        ["span", {i18n: "restarts today"}, t("restarts today")],
        ["span", {class: "VID_DEV_VAL"}, String(boots)]
    ]]);

    return out;
}


/*  The clipboard, with the one fallback that still works on a phone
    with no permission for it: a selected textarea and execCommand. The
    clipboard answers late, and its answer is an event. */
function copy_report()
{
    let text = diag_report();
    if(navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(function() {
            send("copied");
        }, function(e) {
            log_warning(`dev_dialog: the clipboard refused: ${(e && e.name) || e}`);
            send("copy_by_hand");
        });
        return;
    }
    if(fallback(text)) {
        mark_copied();
    }
}

/*  "Copied" for a moment, then its own label back — by its key: the
    text on the button may be "Copied" still, from a press a moment
    ago. */
function mark_copied()
{
    if(!$copy_btn) {
        return;
    }
    $copy_btn.textContent = t("copied");
    setTimeout(function() {
        send("copy_label");
    }, 1500);
}

function fallback(text)
{
    let $ta = document.createElement("textarea");
    $ta.value = text;
    $ta.setAttribute("readonly", "readonly");
    $ta.style.position = "fixed";
    $ta.style.opacity = "0";
    document.body.appendChild($ta);
    $ta.select();
    let ok = false;
    try {
        ok = document.execCommand("copy");
    } catch(e) {
        ok = false;
    }
    document.body.removeChild($ta);
    if(!ok) {
        log_warning("dev_dialog: the report could not be copied");
    }
    return ok;
}


function clear($node)
{
    while($node.firstChild) {
        $node.removeChild($node.firstChild);
    }
}


export {open_developer, close_developer, dev_action};
