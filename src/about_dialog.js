/***********************************************************************
 *          about_dialog.js
 *
 *      The welcome / help / credits dialog.
 *
 *      This is where the pitch lives. In yunomúsica it used to be the
 *      first screen of the app, which put an advertisement between the
 *      user and their music every single time. Now it shows once, carries a "do not
 *      show this again" checkbox, and stays reachable for good from the
 *      toolbar — so it can be read when it is wanted and never again
 *      when it is not.
 *
 *      It registers itself as a shell overlay, which buys the browser
 *      Back button, and on the shell's Escape stack, which buys Escape.
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

import {t} from "i18next";


const PREF_SEEN = "welcome_dismissed";

let $dialog = null;         // the open dialog, if any
let overlay = null;         // its shell overlay handle
let on_closed = null;       // what the caller wants doing afterwards
let on_escape = null;       // its handler on the shell's Escape stack


/***************************************************************
 *  Has the user asked never to see this again?
 ***************************************************************/
function welcome_dismissed()
{
    return pref_get(PREF_SEEN, false);
}


/***************************************************************
 *  Open. `first_run` shows the "do not show this again" line;
 *  opened from the toolbar it would be a strange thing to offer,
 *  since the user just asked for it on purpose.
 *
 *  `on_close` is run once the dialog is gone, whichever way it
 *  went. Two dialogs must never be stacked on a first run, and
 *  this is how the second one waits its turn.
 ***************************************************************/
function open_about(shell_gobj, first_run, on_close)
{
    if($dialog) {
        return;
    }
    on_closed = on_close || null;

    let $card = createElement2(
        ["div", {class: "VID_ABOUT_CARD", role: "dialog", "aria-modal": "true"}, [
            ["header", {class: "VID_ABOUT_HEAD"}, [
                ["img", {class: "VID_ABOUT_MARK", src: "./yunovideo-mark.svg", alt: ""}],
                ["h2", {class: "VID_ABOUT_TITLE", i18n: "your videos where you left them"},
                    t("your videos where you left them")]
            ]],
            ["p", {class: "VID_ABOUT_LEAD", i18n: "about lead"}, t("about lead")],

            ["h3", {class: "VID_ABOUT_H3", i18n: "how it works"}, t("how it works")],
            ["ul", {class: "VID_ABOUT_LIST"}, [
                ["li", {i18n: "help pick"},    t("help pick")],
                ["li", {i18n: "help queue"},   t("help queue")],
                ["li", {i18n: "help lists"},   t("help lists")],
                ["li", {i18n: "help place"},   t("help place")],
                ["li", {i18n: "help privacy"}, t("help privacy")]
            ]],

            build_footer(first_run)
        ]]
    );

    let $backdrop = createElement2(
        ["div", {class: "VID_ABOUT_BACKDROP"}, [$card], {
            click: (ev) => {
                if(ev.target === ev.currentTarget) {
                    close_about(shell_gobj);
                }
            }
        }]
    );

    document.body.appendChild($backdrop);
    $dialog = $backdrop;

    /*  Back button and Escape, courtesy of the shell. */
    overlay = yui_shell_register_overlay(shell_gobj, () => close_about(shell_gobj, true));
    /*  The overlay buys the Back button; Escape is a stack of its own. */
    on_escape = () => close_about(shell_gobj);
    yui_shell_push_escape(shell_gobj, "modal", on_escape, () => close_about(shell_gobj, true));

    refresh_language($backdrop, t);

    let $close = $backdrop.querySelector(".VID_ABOUT_CLOSE");
    if($close) {
        $close.focus();
    }
}


function build_footer(first_run)
{
    let children = [];

    if(first_run) {
        children.push(
            ["label", {class: "VID_ABOUT_CHECK"}, [
                ["input", {class: "VID_ABOUT_DONTSHOW", type: "checkbox"}],
                ["span", {i18n: "do not show this again"}, t("do not show this again")]
            ]]);
    }

    children.push(
        ["div", {class: "VID_ABOUT_CREDITS"}, [
            ["a", {
                class: "VID_ABOUT_BRAND",
                href: "https://artgins.com",
                target: "_blank",
                rel: "noopener noreferrer",
                i18n: "made by artgins"
            }, t("made by artgins")],
            /*  Both credits are links: who made it, and what it is made
                with. The framework earns a way to its own landing page,
                not just a mention in passing. */
            ["a", {
                class: "VID_ABOUT_BRAND VID_ABOUT_YUNETA",
                href: "https://yuneta.io",
                target: "_blank",
                rel: "noopener noreferrer",
                i18n: "made with yuneta"
            }, t("made with yuneta")],
            ["span", {class: "VID_ABOUT_TAGLINE", i18n: "about tagline"},
                t("about tagline")],
            /*  MIT is a licence nobody can act on without the code it
                covers. The line below says "MIT" and this says where —
                the same claim, made checkable. */
            ["a", {
                class: "VID_ABOUT_BRAND VID_ABOUT_SOURCE",
                href: "https://github.com/artgins/yunovideo",
                target: "_blank",
                rel: "noopener noreferrer",
                i18n: "source code"
            }, t("source code")],
            /*  Not translated on purpose: a copyright line and a licence
                identifier are the same in every language, and turning
                them into ten strings is ten chances to get a legal
                notice wrong. */
            ["span", {class: "VID_ABOUT_COPY"}, "© 2026 ArtGins · MIT"],
            /*  Which build is this? Baked in at compile time, so it
                cannot drift from what is actually running. */
            ["span", {class: "VID_ABOUT_VERSION"},
                "v" + __APP_VERSION__ + " · " + __BUILD_STAMP__]
        ]]);

    return ["footer", {class: "VID_ABOUT_FOOT"}, [
        ["div", {class: "VID_ABOUT_FOOTL"}, children],
        ["button", {class: "VID_ABOUT_CLOSE button is-primary", type: "button",
                    i18n: "close", ...named("close")},
            t("close"), {click: (ev) => close_from_button(ev)}]
    ]];
}

/*  The close button has no reference to the shell; it is resolved from
    the dialog element the button lives in. */
let close_shell = null;

function close_from_button()
{
    close_about(close_shell);
}


function close_about(shell_gobj, from_history)
{
    if(!$dialog) {
        return;
    }

    /*  Honour the checkbox on the way out, whichever way the dialog was
        closed — including the Back button. */
    let $check = $dialog.querySelector(".VID_ABOUT_DONTSHOW");
    if($check && $check.checked) {
        pref_set(PREF_SEEN, true);
    }

    if($dialog.parentNode) {
        $dialog.parentNode.removeChild($dialog);
    }
    $dialog = null;

    if(on_escape) {
        yui_shell_pop_escape(shell_gobj, on_escape);
        on_escape = null;
    }
    if(overlay && !from_history) {
        yui_shell_overlay_dismissed(shell_gobj, overlay);
    }
    overlay = null;

    let after = on_closed;
    on_closed = null;
    if(after) {
        after();
    }
}


/*  The host hands us the shell once, at start up, so the close button
    and the backdrop do not each have to carry it. */
function about_bind_shell(shell_gobj)
{
    close_shell = shell_gobj;
}


export {open_about, close_about, welcome_dismissed, about_bind_shell};
