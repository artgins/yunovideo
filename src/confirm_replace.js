/***********************************************************************
 *          confirm_replace.js
 *
 *      "Play all" throws away the queue. Ask first.
 *
 *      A yes/no would be the lazy version of this question. When someone
 *      presses Play on a saved list while a queue is running, the thing they
 *      usually meant — and the thing a plain confirmation cannot offer —
 *      is to ADD it. So the dialog has three answers, and the destructive
 *      one is not the default focus.
 *
 *      Nothing is asked when the deck is empty: there is nothing to lose
 *      and a dialog would be pure ceremony.
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
} from "@yuneta/gobj-ui/src/c_yui_shell.js";

import {queue_length, queue_origin} from "./video_store.js";

import {count_noun} from "./plural.js";
import {named} from "./ui.js";

import {t} from "i18next";


let $open = null;       // the dialog, while it is up
let shell = null;       // the shell it is an overlay of
let overlay = null;     // its shell overlay handle
let on_escape = null;   // its handler on the shell's Escape stack


/***************************************************************
 *  Ask whether to replace the deck or add to it. The answer is
 *  an event: EV_DIALOG {dialog: "confirm", act: "replace" |
 *  "append" | "cancel", ctx} to `gobj`, whose action hands the
 *  kw to confirm_action(). `ctx` is whatever the caller needs to
 *  know what the question was about, plain JSON.
 *
 *  The caller asks only when there is a deck to lose
 *  (queue_length()); with an empty one there is nothing to ask.
 ***************************************************************/
function open_confirm(gobj, shell_gobj, ctx)
{
    let have = queue_length();
    if($open) {
        log_error("confirm_replace: already asking");
        return;
    }
    shell = shell_gobj;
    const send = (act) => gobj_send_event(gobj, "EV_DIALOG",
        {dialog: "confirm", act: act, ctx: ctx || {}}, gobj);
    on_escape = () => send("cancel");

    let origin = queue_origin();

    let $card = createElement2(
        ["div", {class: "VID_CONFIRM_CARD", role: "dialog", "aria-modal": "true"}, [
            ["h2", {class: "VID_CONFIRM_TITLE", i18n: "replace the queue"},
                t("replace the queue")],
            /*  What is at stake, in the terms the deck uses: how many
                videos, and whether they are a saved list. */
            ["p", {class: "VID_CONFIRM_WHAT"}, [
                ["span", {class: "VID_CONFIRM_N"}, String(have)],
                ["span", {}, count_noun("n videos", have)],
                ["span", {i18n: "in the queue now"}, t("in the queue now")],
                origin
                    ? ["span", {class: "VID_CONFIRM_LIST"}, "— " + origin.name]
                    : ["span", {}]
            ]],
            ["p", {class: "VID_CONFIRM_BODY", i18n: "replace warning"},
                t("replace warning")],
            ["div", {class: "VID_CONFIRM_ACTIONS"}, [
                ["button", {class: "VID_QBTN button VID_CONFIRM_APPEND", type: "button",
                            i18n: "add to queue", ...named("add to queue")},
                    t("add to queue"), {click: () => send("append")}],
                ["button", {class: "VID_QBTN button is-danger VID_CONFIRM_REPLACE", type: "button",
                            i18n: "replace and play", ...named("replace and play")},
                    t("replace and play"), {click: () => send("replace")}],
                ["button", {class: "VID_QBTN button is-ghost VID_CONFIRM_CANCEL",
                            type: "button", i18n: "cancel", ...named("cancel")},
                    t("cancel"), {click: () => send("cancel")}]
            ]]
        ]]
    );

    let $backdrop = createElement2(
        ["div", {class: "VID_ABOUT_BACKDROP"}, [$card], {
            click: (ev) => {
                if(ev.target === ev.currentTarget) {
                    send("cancel");
                }
            }
        }]
    );

    document.body.appendChild($backdrop);
    $open = $backdrop;

    overlay = yui_shell_register_overlay(shell_gobj, () => close(true));
    yui_shell_push_escape(shell_gobj, "modal", on_escape, () => close(true));
    refresh_language($backdrop, t);

    /*  Cancel takes the focus, not the destructive button. */
    let $cancel = $backdrop.querySelector(".VID_CONFIRM_CANCEL");
    if($cancel) {
        $cancel.focus();
    }
}

function close(from_history)
{
    if(!$open) {
        return;                         // the Back button and a click can race
    }
    if($open.parentNode) {
        $open.parentNode.removeChild($open);
    }
    $open = null;
    yui_shell_pop_escape(shell, on_escape);
    if(overlay && !from_history) {
        yui_shell_overlay_dismissed(shell, overlay);
    }
    overlay = null;
    on_escape = null;
    shell = null;
}

/*  Run from the opener's FSM: the dialog goes, and the answer is handed
    back — "replace", "append", or "" for none. */
function confirm_action(kw)
{
    close(false);
    if(kw.act === "replace" || kw.act === "append") {
        return kw.act;
    }
    if(kw.act !== "cancel") {
        log_error(`confirm_replace: unknown action: ${kw.act}`);
    }
    return "";
}


export {open_confirm, confirm_action};
