/***********************************************************************
 *          ui.js
 *
 *      The small pieces every screen builds with: the icons, and the
 *      one rule every control obeys.
 *
 *      A CONTROL WITHOUT A NAME IS A BUG. Every button carries a
 *      `title` AND an `aria-label`, both translated and both with their
 *      key, so a language switch re-translates them in place. An icon
 *      button has no other name at all; a button with words still gets
 *      both, because its words hide on a phone. named() writes the four
 *      attributes, and every button in this app is built through it.
 *
 *      Icons are inline SVG (Material Icons, Apache 2.0, unless said
 *      otherwise). Each SHAPE means one thing, and no glyph is reused
 *      because it happens to be there.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {html_markup} from "@yuneta/gobj-js";

import {t} from "i18next";


const P = {
    play:     "M8 5v14l11-7z",
    pause:    "M6 19h4V5H6v14zm8-14v14h4V5h-4z",
    prev:     "M6 6h2v12H6zm3.5 6 8.5 6V6z",
    next:     "M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z",
    full:     "M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z",
    unfull:   "M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z",
    pip:      "M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z",
    cc:       "M19 4H5c-1.11 0-2 .9-2 2v12c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm-8 7H9.5v-.5h-2v3h2V13H11v1c0 .55-.45 1-1 1H7c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1zm7 0h-1.5v-.5h-2v3h2V13H18v1c0 .55-.45 1-1 1h-3c-.55 0-1-.45-1-1v-4c0-.55.45-1 1-1h3c.55 0 1 .45 1 1v1z",
    speed:    "M20.38 8.57l-1.23 1.85a8 8 0 0 1-.22 7.58H5.07A8 8 0 0 1 15.58 6.85l1.85-1.23A10 10 0 0 0 3.35 19a2 2 0 0 0 1.72 1h13.85a2 2 0 0 0 1.74-1 10 10 0 0 0-.27-10.44zm-9.79 6.84a2 2 0 0 0 2.83 0l5.66-8.49-8.49 5.66a2 2 0 0 0 0 2.83z",
    vol:      "M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z",
    mute:     "M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z",
    enqueue:  "M14 10H3v2h11v-2zm0-4H3v2h11V6zm4 8v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zM3 16h7v-2H3v2z",
    heart:    "M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z",
    restart:  "M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z",
    maxq:     "M21 11V3h-8l3.29 3.29-10 10L3 13v8h8l-3.29-3.29 10-10z",
    minq:     "M22 3.41 16.71 8.7 20 12h-8V4l3.29 3.29L20.59 2 22 3.41zM3.41 22l5.29-5.29L12 20v-8H4l3.29 3.29L2 20.59 3.41 22z",
    up:       "M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z",
    down:     "M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z",
    remove:   "M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z",
    folder:   "M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8z",
    file:     "M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zm0 7V3.5L18.5 9z",
    refresh:  "M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z",
    trash:    "M9 3h6l1 2h4v2H4V5h4zM6 9h12l-1 12H7z",
    key:      "M21 10h-8.35A5.99 5.99 0 0 0 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6a5.99 5.99 0 0 0 5.65-4H13l2 2 2-2 2 2 4-4.04L21 10zM7 15c-1.65 0-3-1.35-3-3s1.35-3 3-3 3 1.35 3 3-1.35 3-3 3z",
    look:     "M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
    save:     "M17 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7l-4-4zm-5 16a3 3 0 1 1 0-6 3 3 0 0 1 0 6zm3-10H5V5h10v4z",
    sweep:    "M15 16h4v2h-4zm0-8h7v2h-7zm0 4h6v2h-6zM3 18c0 1.1.9 2 2 2h6c1.1 0 2-.9 2-2V8H3v10zM14 5h-3l-1-1H6L5 5H2v2h12z",
    film:     "M18 4l2 4h-3l-2-4h-2l2 4h-3l-2-4H8l2 4H7L5 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4h-4z",
};

/*  ±10 s: a circular arrow with the number inside it. Drawn rather than
    taken from a set, so the two read as one pair and the figure is a
    real "10" in every script. `dir` is -1 (back) or 1 (forward). */
function seek10(dir, size)
{
    const arc = dir < 0
        ? "M12 5V2L7 6l5 4V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"
        : "M12 5V2l5 4-5 4V7a6 6 0 1 0 6 6h2a8 8 0 1 1-8-8z";
    return html_markup(
        `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true">` +
        `<path d="${arc}"/>` +
        `<text x="12" y="16.2" font-size="6.6" font-weight="700" text-anchor="middle" ` +
        `font-family="system-ui, sans-serif">10</text></svg>`);
}

function svg(path, size)
{
    return html_markup(
        `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="currentColor" aria-hidden="true"><path d="${path}"/></svg>`);
}

function ico(path, size)
{
    return ["span", {class: "VID_ICO"}, svg(path, size)];
}

/*  The four attributes of a control's name. */
function named(key)
{
    return {
        title: t(key),
        "data-i18n-title": key,
        "aria-label": t(key),
        "data-i18n-aria-label": key,
    };
}

/*  Rename a control that is already on the page: its state changed, and
    what pressing it does changed with it. */
function rename($node, key)
{
    if(!$node) {
        return;
    }
    $node.setAttribute("title", t(key));
    $node.setAttribute("data-i18n-title", key);
    $node.setAttribute("aria-label", t(key));
    $node.setAttribute("data-i18n-aria-label", key);
}

/*  `disabled: undefined` becomes the literal attribute
    disabled="undefined", which DISABLES the button. The key must be
    absent. */
function disabled_if(cond)
{
    return cond ? {disabled: "disabled"} : {};
}

function clear($node)
{
    while($node && $node.firstChild) {
        $node.removeChild($node.firstChild);
    }
}

function set_text($root, sel, text)
{
    const $n = $root && $root.querySelector(sel);
    if($n) {
        $n.textContent = text;
    }
}


export {P, svg, seek10, ico, named, rename, disabled_if, clear, set_text};
