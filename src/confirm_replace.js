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
import {createElement2, refresh_language} from "@yuneta/gobj-js";

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


/***************************************************************
 *  Resolves to "replace", "append" or null (cancelled).
 *
 *  With an empty deck it resolves to "replace" without asking.
 ***************************************************************/
function confirm_replace(shell_gobj)
{
    let have = queue_length();
    if(!have) {
        return Promise.resolve("replace");
    }
    if($open) {
        return Promise.resolve(null);       // one at a time
    }

    return new Promise(function(resolve) {
        let overlay = null;

        const done = function(answer, from_history) {
            if(!$open) {
                return;
            }
            if($open.parentNode) {
                $open.parentNode.removeChild($open);
            }
            $open = null;
            yui_shell_pop_escape(shell_gobj, on_escape);
            if(overlay && !from_history) {
                yui_shell_overlay_dismissed(shell_gobj, overlay);
            }
            resolve(answer);
        };
        const on_escape = () => done(null);

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
                    ["button", {class: "VID_QBTN button", type: "button",
                                i18n: "add to queue", ...named("add to queue")},
                        t("add to queue"), {click: () => done("append")}],
                    ["button", {class: "VID_QBTN button is-danger", type: "button",
                                i18n: "replace and play", ...named("replace and play")},
                        t("replace and play"), {click: () => done("replace")}],
                    ["button", {class: "VID_QBTN button is-ghost VID_CONFIRM_CANCEL",
                                type: "button", i18n: "cancel", ...named("cancel")},
                        t("cancel"), {click: () => done(null)}]
                ]]
            ]]
        );

        let $backdrop = createElement2(
            ["div", {class: "VID_ABOUT_BACKDROP"}, [$card], {
                click: (ev) => {
                    if(ev.target === ev.currentTarget) {
                        done(null);
                    }
                }
            }]
        );

        document.body.appendChild($backdrop);
        $open = $backdrop;

        overlay = yui_shell_register_overlay(shell_gobj, () => done(null, true));
        yui_shell_push_escape(shell_gobj, "modal", on_escape, () => done(null, true));
        refresh_language($backdrop, t);

        /*  Cancel takes the focus, not the destructive button. */
        let $cancel = $backdrop.querySelector(".VID_CONFIRM_CANCEL");
        if($cancel) {
            $cancel.focus();
        }
    });
}


export {confirm_replace};
