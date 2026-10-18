/***********************************************************************
 *          install_dialog.js
 *
 *      "Do you want to install this?" — asked by the app, once.
 *
 *      The question is worth asking out loud because the answer changes
 *      how the app behaves, not how it looks: Chrome only offers
 *      persistent folder permissions to an installed app, so installing
 *      is the difference between authorising your video folder once and
 *      authorising it at every single launch. That is the reason the
 *      dialog gives, because it is the reason that matters.
 *
 *      Asked once, and only once. "Not now" is remembered for good: the
 *      offer then lives on as a bar on the player screen, which is
 *      there when it is wanted and says nothing when it is not.
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

import {pref_get, pref_set} from "./idb.js";
import {named} from "./ui.js";
import {
    can_install, do_install, subscribe_install, dismiss_install_bar,
} from "./install_prompt.js";

import {t} from "i18next";


const PREF_ASKED = "install_asked";

let $open = null;       // the dialog, while it is up
let waiting = null;     // unsubscribe, while we wait for the offer


/***************************************************************
 *  Ask, when there is something to ask about.
 *
 *  Chrome does not decide an origin is installable the instant
 *  the page loads, so this may have nothing to work with yet;
 *  in that case it waits for the offer to arrive and asks then.
 *  Called once at boot.
 ***************************************************************/
async function offer_install_when_due(shell_gobj)
{
    if(waiting) {
        return;
    }
    if(await pref_get(PREF_ASKED, false)) {
        return;                         // already asked, once is once
    }
    if(can_install()) {
        open_install(shell_gobj);
        return;
    }
    waiting = subscribe_install(function() {
        if(can_install()) {
            stop_waiting();
            open_install(shell_gobj);
        }
    });
}

function stop_waiting()
{
    if(waiting) {
        waiting();
        waiting = null;
    }
}


/***************************************************************
 *  The dialog proper. Also reachable from the bar on the player
 *  screen, which is why it does not check the "asked" flag
 *  itself — asking again is fine when the user asked to be
 *  asked.
 ***************************************************************/
function open_install(shell_gobj)
{
    if($open || !can_install()) {
        return;
    }

    let overlay = null;

    const close = function(from_history) {
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
    };
    const on_escape = () => answered();

    /*  However this ends — installed, refused, Escape, Back — the app
        has now had its turn, and it does not get a second one today:
        the bar behind this dialog goes with it. It is back at the next
        launch, quietly, which is the difference between an offer and
        nagging. */
    const answered = function(from_history) {
        pref_set(PREF_ASKED, true);
        close(from_history);
        dismiss_install_bar();
    };

    /*  The DOM goes first and nothing is awaited before prompt(), or the
        browser stops treating this as a click and refuses to open the
        system dialog. */
    const accept = function() {
        answered();
        do_install();
    };

    let $card = createElement2(
        ["div", {class: "VID_INSTALL_CARD", role: "dialog", "aria-modal": "true"}, [
            ["img", {class: "VID_INSTALL_MARK", src: "./yunovideo-mark.svg", alt: ""}],
            ["h2", {class: "VID_INSTALL_TITLE", i18n: "install this app"},
                t("install this app")],
            ["p", {class: "VID_INSTALL_BODY", i18n: "install why"}, t("install why")],
            ["div", {class: "VID_INSTALL_ACTIONS"}, [
                ["button", {class: "VID_QBTN button is-primary VID_INSTALL_GO",
                            type: "button", i18n: "install", ...named("install")},
                    t("install"), {click: () => accept()}],
                ["button", {class: "VID_QBTN button is-ghost VID_INSTALL_NO",
                            type: "button", i18n: "not now", ...named("not now")},
                    t("not now"), {click: () => answered()}]
            ]]
        ]]
    );

    let $backdrop = createElement2(
        ["div", {class: "VID_ABOUT_BACKDROP"}, [$card], {
            click: (ev) => {
                if(ev.target === ev.currentTarget) {
                    answered();
                }
            }
        }]
    );

    document.body.appendChild($backdrop);
    $open = $backdrop;

    /*  Back button and Escape, courtesy of the shell. */
    overlay = yui_shell_register_overlay(shell_gobj, () => answered(true));
    yui_shell_push_escape(shell_gobj, "modal", on_escape, () => answered(true));
    refresh_language($backdrop, t);

    let $go = $backdrop.querySelector(".VID_INSTALL_GO");
    if($go) {
        $go.focus();
    }
}


export {offer_install_when_due, open_install};
