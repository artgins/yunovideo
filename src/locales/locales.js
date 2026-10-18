/***********************************************************************
 *          locales.js
 *
 *      i18n bootstrap (i18next) for yunovídeo.
 *
 *      Ten languages, all bundled: there is no backend to fetch a
 *      catalogue from, and the whole point of this app is that it works
 *      with nothing but the files on your device.
 *
 *      Two things every caller should know:
 *
 *        - Keys are lower-case English (see en.js). `fallbackLng: "en"`
 *          means a key a translator has not reached yet shows English
 *          rather than the bare key.
 *
 *        - A language carries a WRITING DIRECTION. Switching to Arabic
 *          writes dir="rtl" on <html>; the stylesheet is written with
 *          logical properties (inline-start / inline-end) so the layout
 *          mirrors itself instead of needing a second stylesheet.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import i18next from "i18next";

import {en} from "./en.js";
import {es} from "./es.js";
import {zh} from "./zh.js";
import {ar} from "./ar.js";
import {ru} from "./ru.js";
import {hi} from "./hi.js";
import {pt} from "./pt.js";
import {fr} from "./fr.js";
import {de} from "./de.js";
import {ja} from "./ja.js";

const STORAGE_KEY = "yunovideo:locale";

/*  Where a browser lands when it asks for a language this app does not
    speak. English, the same as `fallbackLng` below, so a visitor never
    meets two different answers to "what if we don't have it?".
    A Spanish browser still gets Spanish: the request is honoured first
    (see browser_locale), and this only decides the rest. */
const DEFAULT_LOCALE = "en";

/*  Insertion order is menu order: the two the app was written in first,
    then the rest by number of speakers. */
const LOCALES = {es, en, zh, hi, ar, pt, ru, ja, de, fr};


function locale_list()
{
    return Object.keys(LOCALES).map((code) => ({
        code: code,
        name: LOCALES[code].name,
        dir: LOCALES[code].dir || "ltr",
    }));
}

function stored_locale()
{
    try {
        return localStorage.getItem(STORAGE_KEY) || "";
    } catch(e) {
        return "";
    }
}

function store_locale(code)
{
    try {
        localStorage.setItem(STORAGE_KEY, code);
    } catch(e) {
        /*  Private mode: the choice still holds for this page load. */
    }
}

/*  What the browser asks for, if we happen to speak it. */
function browser_locale()
{
    let langs = (typeof navigator !== "undefined" && navigator.languages) || [];
    for(const l of langs) {
        let code = String(l).toLowerCase().split("-")[0];
        if(LOCALES[code]) {
            return code;
        }
    }
    return "";
}

function apply_direction(code)
{
    let dir = (LOCALES[code] && LOCALES[code].dir) || "ltr";
    let html = document.documentElement;
    html.setAttribute("dir", dir);
    html.setAttribute("lang", code);
    return dir;
}

function setup_locale()
{
    let code = stored_locale() || browser_locale() || DEFAULT_LOCALE;
    if(!LOCALES[code]) {
        code = DEFAULT_LOCALE;
    }

    i18next.init({
        lng:           code,
        fallbackLng:   "en",
        resources:     LOCALES,
        initImmediate: false,
    });

    apply_direction(code);
    return code;
}

function current_locale()
{
    return i18next.language || DEFAULT_LOCALE;
}

function current_direction()
{
    return (LOCALES[current_locale()] && LOCALES[current_locale()].dir) || "ltr";
}

/*  Returns the code actually in force, so a caller can repaint from it
    without asking again. */
function switch_locale(code)
{
    if(!LOCALES[code]) {
        return current_locale();
    }
    i18next.changeLanguage(code);
    store_locale(code);
    apply_direction(code);
    return code;
}


export {
    setup_locale,
    switch_locale,
    current_locale,
    current_direction,
    locale_list,
};
