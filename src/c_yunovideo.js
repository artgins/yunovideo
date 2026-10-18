/***********************************************************************
 *          c_yunovideo.js
 *
 *      C_YUNOVIDEO — the app's root service (the yuno's default
 *      service). It hosts the declarative shell and owns everything
 *      that lives OUTSIDE the routed views:
 *
 *        - the layout frame: the shell, and the strips docked under it;
 *        - the MINI-PLAYER, the transport you keep while you are away
 *          from the deck — and the video itself, still playing, in a
 *          box at its start. The one <video> element moves there when
 *          the player screen is left and back when it is shown again;
 *          a film that disappears because you went to look at the
 *          library is not a player anybody would keep;
 *        - the scan bar, from every screen, while a folder is read;
 *        - the light/dark theme, the palette and the language;
 *        - the keyboard (space, arrows, f, m, n, p, c);
 *        - the welcome / help dialog, the site map and the developer
 *          sheet the "more" menu opens;
 *        - loading what was remembered, before anything else paints.
 *
 *      Every DOM callback here does one thing: send an event to this
 *      gobj. The work is in the actions, where the machine trace sees
 *      it.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {
    SDATA, SDATA_END, data_type_t,
    gclass_create, log_error, log_warning,
    gobj_read_attr,
    gobj_create_pure_child,
    gobj_subscribe_event,
    gobj_send_event,
    gobj_stop_children,
    gobj_start_tree,
    createElement2, refresh_language,
} from "@yuneta/gobj-js";

import {
    yui_shell_set_translator,
    yui_shell_language_changed,
    yui_shell_navigate,
    yui_shell_set_toolbar_item_icon,
} from "@yuneta/gobj-ui/src/c_yui_shell.js";

import {yui_shell_show_route_map} from "@yuneta/gobj-ui/src/shell_route_map.js";

import {
    subscribe, store_state, sounding, current_track, is_sounding, toggle,
    step, prev, seek_fraction, seek_by, progress, setup_media_session,
    fmt_time, restore_queue, store_deck, set_deck_ready, temp_track,
    temp_position, back_to_deck, queue_add, last_said, clear_said,
    dock_video, get_video, facts_of, set_ui_language, set_subtitle,
    subtitle_tracks, current_subtitle, media_action,
    on_metadata, on_canplay, on_ended, on_media_error,
} from "./video_store.js";
import {
    load_sources, subscribe_sources, scanning_source, is_preparing,
    stop_scan, is_stopping,
} from "./sources_store.js";
import {load_playlists} from "./playlists_store.js";
import {load_stats, flush_places, note_ended} from "./stats_store.js";
import {load_thumbs, thumb_url, paint_thumb, thumbs_held} from "./thumbs.js";
import {pref_get} from "./idb.js";
import {diag_watch} from "./diag.js";
import {toggle_fullscreen, toggle_pip} from "./screen.js";
import {P, svg, named, rename, set_text, clear} from "./ui.js";
import {STORE_TRACE_LEVELS, set_store_tracer} from "./trace.js";

import {switch_locale, current_locale} from "./locales/locales.js";
import {open_about, welcome_dismissed} from "./about_dialog.js";
import {dialog_action} from "./dialogs.js";
import {open_developer} from "./dev_dialog.js";
import {start_update_watch} from "./update_check.js";
import {start_install_watch} from "./install_prompt.js";
import {offer_install_when_due} from "./install_dialog.js";

import {t} from "i18next";


/***************************************************************
 *              Constants
 ***************************************************************/
const GCLASS_NAME = "C_YUNOVIDEO";

const DECK_ROUTE = "/player";

/*  The store channels this gobj repaints on. "time" is four a second
    while something plays; it is cheap, and it is what moves the bar. */
const CHANNELS = {playing: 1, queue: 1, time: 1, loading: 1, temp: 1, said: 1};

/*  What the video element itself said (see video_store): each enters
    the machine as EV_MEDIA, and its action answers it. */
const MEDIA_CHANNELS = {metadata: 1, canplay: 1, ended: 1, error: 1};

const PALETTES = {auto: 1, gold: 1, ice: 1, rose: 1, leaf: 1, aurora: 1, dusk: 1};


/***************************************************************
 *              Attrs
 ***************************************************************/
const attrs_table = [
SDATA(data_type_t.DTP_JSON,     "config",    0,  null,  "Shell config (app_config.json)"),
SDATA(data_type_t.DTP_BOOLEAN,  "use_hash",  0,  true,  "Pass-through to C_YUI_SHELL"),
SDATA_END()
];

let PRIVATE_DATA = {
    shell:      null,
    $root:      null,
    $strip:     null,
    $scan:      null,
    $said:      null,
    said_timer: 0,
    scan_timer: 0,
    scan_t0:    0,
    save_timer: 0,
    strips:     null,
    unsub:      null,
    unsub_src:  null,
    tint_key:   null,
    tint_img:   null,
    on_deck:    true,
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
    let priv = gobj.priv;

    /*  The stores trace under this gclass's levels (see trace.js). */
    set_store_tracer(gobj);

    let $root = createElement2(["div", {class: "VID_ROOT"}, []]);
    document.body.appendChild($root);
    priv.$root = $root;

    let shell = gobj_create_pure_child(
        "shell",
        "C_YUI_SHELL",
        {
            config:        gobj_read_attr(gobj, "config"),
            use_hash:      gobj_read_attr(gobj, "use_hash"),
            mount_element: $root
        },
        gobj
    );
    priv.shell = shell;

    gobj_subscribe_event(shell, "EV_TOGGLE_THEME", {}, gobj);
    gobj_subscribe_event(shell, "EV_SET_PALETTE",  {}, gobj);
    gobj_subscribe_event(shell, "EV_SET_LOCALE",   {}, gobj);
    gobj_subscribe_event(shell, "EV_OPEN_ABOUT",   {}, gobj);
    gobj_subscribe_event(shell, "EV_OPEN_SITEMAP", {}, gobj);
    gobj_subscribe_event(shell, "EV_OPEN_DEVELOPER", {}, gobj);
    gobj_subscribe_event(shell, "EV_ROUTE_CHANGED", {}, gobj);

    yui_shell_set_translator(shell, t);
}

/***************************************************************
 *          Framework Method: Start
 ***************************************************************/
function mt_start(gobj)
{
    let priv = gobj.priv;

    apply_theme(current_theme());
    apply_palette(current_palette());
    set_ui_language(current_locale());
    gobj_start_tree(priv.shell);
    show_choices(gobj);
    yui_shell_language_changed(priv.shell);

    build_strip(gobj);
    setup_media_session(function(action) {
        gobj_send_event(gobj, "EV_MEDIA_KEY", {action: action}, gobj);
    });

    diag_watch(function() {
        let v = sounding();
        let pr = progress();
        let th = thumbs_held();
        return {
            playing: is_sounding(),
            track: v ? ((v.show ? v.show + " — " : "") + v.title) : "",
            dur: Math.round(pr.duration || 0),
            pos: Math.round(pr.current || 0),
            thumbs: th.count,
            thumb_kb: th.kb,
        };
    });

    /*  The store's notifications enter the machine as events. */
    priv.unsub = subscribe(function(channel) {
        if(CHANNELS[channel]) {
            gobj_send_event(gobj, "EV_STORE", {channel: channel}, gobj);
        } else if(MEDIA_CHANNELS[channel]) {
            gobj_send_event(gobj, "EV_MEDIA", {what: channel}, gobj);
        }
    });
    priv.unsub_src = subscribe_sources(function() {
        gobj_send_event(gobj, "EV_STORE", {channel: "loading"}, gobj);
    });

    paint_strip(gobj);
    paint_scan(gobj);

    boot(gobj);
}

/***************************************************************
 *          Framework Method: Stop
 ***************************************************************/
function mt_stop(gobj)
{
    let priv = gobj.priv;
    if(priv.unsub) {
        priv.unsub();
        priv.unsub = null;
    }
    if(priv.unsub_src) {
        priv.unsub_src();
        priv.unsub_src = null;
    }
    if(priv.scan_timer) {
        clearInterval(priv.scan_timer);
        priv.scan_timer = 0;
    }
    if(priv.save_timer) {
        clearTimeout(priv.save_timer);
        priv.save_timer = 0;
    }
    if(priv.said_timer) {
        clearTimeout(priv.said_timer);
        priv.said_timer = 0;
    }
    if(priv.strips) {
        priv.strips.disconnect();
        priv.strips = null;
    }
    gobj_stop_children(gobj);
}

/***************************************************************
 *          Framework Method: Destroy
 ***************************************************************/
function mt_destroy(gobj)
{
    let priv = gobj.priv;
    if(priv.$root && priv.$root.parentNode) {
        priv.$root.parentNode.removeChild(priv.$root);
    }
    priv.$root = null;
}




                    /***************************
                     *      Local Methods
                     ***************************/




/***************************************************************
 *  Bring back what was remembered, then decide whether the
 *  welcome dialog is due. Neither blocks the first paint.
 ***************************************************************/
async function boot(gobj)
{
    let priv = gobj.priv;

    start_update_watch();
    start_install_watch();

    try {
        await load_playlists();
        await load_stats();
        await load_thumbs();
        await load_sources();
        let snap = await pref_get("queue", null);
        if(snap) {
            restore_queue(snap);
        }
    } catch(e) {
        /*  What was remembered could not all come back. The app goes on
            with what did, and says so where it can be read. */
        log_error(`${GCLASS_NAME}: boot could not restore everything: ${(e && e.stack) || e}`);
    } finally {
        set_deck_ready();
    }

    let dismissed = await welcome_dismissed();
    if(!dismissed) {
        open_about(gobj, priv.shell, true, () => offer_install_when_due(gobj, priv.shell));
    } else {
        offer_install_when_due(gobj, priv.shell);
    }
}

function save_deck_soon(gobj)
{
    let priv = gobj.priv;
    if(priv.save_timer) {
        return;
    }
    priv.save_timer = setTimeout(function() {
        gobj_send_event(gobj, "EV_SAVE_DECK", {}, gobj);
    }, 1500);
}


/***************************************************************
 *              Theme, palette, language
 ***************************************************************/
/*  "auto" takes the accent from the picture of what is playing, the
    way yunomúsica takes it from the cover. */
function current_palette()
{
    let p = "";
    try {
        p = localStorage.getItem("yunovideo:palette") || "";
    } catch(e) {
        p = "";
    }
    return PALETTES[p] ? p : "auto";
}

function apply_palette(name)
{
    let v = PALETTES[name] ? name : "auto";
    document.documentElement.setAttribute("data-palette", v);
    try {
        localStorage.setItem("yunovideo:palette", v);
    } catch(e) {
        /*  Private mode: the choice still holds for this page load. */
    }
    if(v !== "auto") {
        clear_accent();
    }
    return v;
}

function current_theme()
{
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function apply_theme(theme)
{
    let v = (theme === "dark") ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", v);
    try {
        localStorage.setItem("myst:theme", v);
    } catch(e) {
        /*  Private mode: the theme still applies for this page load. */
    }
    return v;
}

function mark_choice(shell, toolbar_id, key, value)
{
    let config = gobj_read_attr(shell, "config");
    let items = (config && config.toolbar && config.toolbar.items) || [];
    for(let it of items) {
        if(it.id !== toolbar_id || !it.action || !Array.isArray(it.action.items)) {
            continue;
        }
        for(let sub of it.action.items) {
            let kw = (sub.action && sub.action.kw) || {};
            sub.selected = kw[key] === value;
        }
    }
}

/*  The toolbar says what is in force: a check on the language and the
    palette, and the theme button shows the theme in force (the moon in
    dark) while its name says where a press goes. */
function show_choices(gobj)
{
    let shell = gobj.priv.shell;
    mark_choice(shell, "language", "locale", current_locale());
    mark_choice(shell, "palette", "palette", current_palette());
    let dark = current_theme() === "dark";
    yui_shell_set_toolbar_item_icon(shell, "theme", dark ? "yi-moon" : "yi-sun");
    let $c = gobj_read_attr(shell, "$container");
    let $btn = $c && $c.querySelector('[data-toolbar-item-id="theme"]');
    rename($btn, dark ? "to light theme" : "to dark theme");
}

function tint_from(gobj, v)
{
    let priv = gobj.priv;
    if(current_palette() !== "auto") {
        return;
    }
    let url = v ? thumb_url(v) : null;
    let key = url || "";
    if(priv.tint_key === key) {
        return;
    }
    priv.tint_key = key;
    if(!url) {
        clear_accent();
        return;
    }
    let img = new Image();
    priv.tint_img = img;
    img.onload = function() {
        gobj_send_event(gobj, "EV_TINT_READY", {key: key}, gobj);
    };
    img.onerror = function() {
        gobj_send_event(gobj, "EV_TINT_FAILED", {key: key}, gobj);
    };
    img.src = url;
}

/*  The accent, from the picture `tint_from` loaded. */
function tint_read(gobj)
{
    let img = gobj.priv.tint_img;
    try {
        let cv = document.createElement("canvas");
        cv.width = cv.height = 12;
        let ctx = cv.getContext("2d", {willReadFrequently: true});
        ctx.drawImage(img, 0, 0, 12, 12);
        let d = ctx.getImageData(0, 0, 12, 12).data;
        let best = null;
        let best_score = -1;
        for(let i = 0; i < d.length; i += 4) {
            let r = d[i];
            let g = d[i + 1];
            let b = d[i + 2];
            let mx = Math.max(r, g, b);
            let mn = Math.min(r, g, b);
            let sat = mx === 0 ? 0 : (mx - mn) / mx;
            let lum = (mx + mn) / 510;
            let score = sat * (1 - Math.abs(lum - 0.55));
            if(score > best_score) {
                best_score = score;
                best = [r, g, b];
            }
        }
        /*  A grey frame says nothing about colour: keep the palette's. */
        if(best && best_score > 0.12) {
            set_accent(readable(lift(best)));
        } else {
            clear_accent();
        }
    } catch(e) {
        log_warning(`${GCLASS_NAME}: cannot read the picture's colours: ${(e && e.name) || e}`);
        clear_accent();
    }
}

function lift([r, g, b])
{
    let mx = Math.max(r, g, b) || 1;
    let k = 235 / mx;
    let f = (v) => Math.round(Math.min(235, 60 + (v * k) * 0.78));
    return [f(r), f(g), f(b)];
}

/*  WCAG relative luminance and contrast. */
function luminance(rgb)
{
    let f = (v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(rgb[0]) + 0.7152 * f(rgb[1]) + 0.0722 * f(rgb[2]);
}

function contrast(a, b)
{
    let la = luminance(a);
    let lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/*  THE INK IS MEASURED, NOT ASSUMED (yunomúsica learned it on a pale
    cover). A colour lifted to glow on near-black is a pale wash on a
    white page: buttons drawn in it are drawn perfectly and seen by
    nobody. So it is pushed away from the page, keeping its hue, until
    it clears 3:1 against it. */
const PAGE_LIGHT = [255, 255, 255];
const PAGE_DARK = [20, 22, 26];

function readable(rgb)
{
    let dark = current_theme() === "dark";
    let page = dark ? PAGE_DARK : PAGE_LIGHT;
    let c = rgb.slice();
    for(let i = 0; i < 40 && contrast(c, page) < 3; i++) {
        c = dark
            ? c.map((v) => Math.round(v + (255 - v) * 0.08))
            : c.map((v) => Math.round(v * 0.92));
    }
    return c;
}

function set_accent(rgb)
{
    let root = document.documentElement.style;
    root.setProperty("--vid-accent", "rgb(" + rgb.join(",") + ")");
    /*  And what is written ON it: black or white, whichever reads. */
    let ink = contrast(rgb, [255, 255, 255]) >= contrast(rgb, [10, 12, 14])
        ? "#FFFFFF" : "#0A0C0E";
    root.setProperty("--vid-accent-ink", ink);
}

function clear_accent()
{
    document.documentElement.style.removeProperty("--vid-accent");
    document.documentElement.style.removeProperty("--vid-accent-ink");
}


/***************************************************************
 *              The strip under the shell
 ***************************************************************/
function build_strip(gobj)
{
    let priv = gobj.priv;
    const send = (ev, kw) => () => gobj_send_event(gobj, ev, kw || {}, gobj);

    let $strip = createElement2(
        ["div", {class: "VID_STRIP"}, [
            ["div", {class: "VID_STRIP_SEEK"}, [["i", {class: "VID_STRIP_FILL"}]], {
                click: (ev) => gobj_send_event(gobj, "EV_SEEK",
                    {fraction: fraction_at(ev, ev.currentTarget)}, gobj)
            }],
            ["div", {class: "VID_STRIP_BAR"}, [
                ["button", {class: "VID_STRIP_BOX", type: "button", ...named("player")}, [],
                    {click: send("EV_GO_TO_DECK")}],
                ["button", {class: "VID_STRIP_META", type: "button", ...named("player")}, [
                    ["span", {class: "VID_STRIP_TITLE"}, "—"],
                    ["span", {class: "VID_STRIP_SUB"}, ""]
                ], {click: send("EV_GO_TO_DECK")}],
                ["div", {class: "VID_STRIP_CTL"}, []]
            ]]
        ]]
    );
    priv.$strip = $strip;
    priv.$root.appendChild($strip);

    let $scan = createElement2(
        ["div", {class: "VID_SCANBAR", role: "status", "aria-live": "polite"}, [
            ["div", {class: "VID_SCAN_BODY"}, [
                ["div", {class: "VID_SCAN_LINE"}, [
                    ["span", {class: "VID_SPINNER", "aria-hidden": "true"}],
                    ["span", {class: "VID_SCAN_LABEL", i18n: "reading folder"}, t("reading folder")],
                    ["span", {class: "VID_SCAN_WHAT"}, ""],
                    ["span", {class: "VID_SCAN_CLOCK"}, "0:00"],
                    ["span", {class: "VID_SCAN_COUNT"}, ""],
                    ["button", {class: "VID_SCAN_STOP", type: "button", i18n: "stop",
                                ...named("stop")},
                        t("stop"), {click: send("EV_STOP_SCAN")}]
                ]],
                ["div", {class: "VID_BAR"}, [["i", {class: "VID_BAR_FILL"}]]],
                ["div", {class: "VID_SCAN_FILE"}, ""]
            ]]
        ]]
    );
    priv.$scan = $scan;
    priv.$root.appendChild($scan);

    priv.$said = createElement2(["div", {class: "VID_SAID", role: "status", "aria-live": "polite"}, []]);
    priv.$root.appendChild(priv.$said);

    /*  The strips are MEASURED, never guessed: a line wraps in German
        and not in Chinese, and a wrong guess clips the strip or eats
        the bottom nav. */
    if(typeof ResizeObserver !== "undefined") {
        priv.strips = new ResizeObserver(function() {
            priv.$root.style.setProperty("--vid-strip-h", $strip.offsetHeight + "px");
            priv.$root.style.setProperty("--vid-scan-h", $scan.offsetHeight + "px");
            let $nav = priv.$root.querySelector(".yui-zone-bottom");
            priv.$root.style.setProperty("--vid-nav-h", (($nav && $nav.offsetHeight) || 0) + "px");
        });
        priv.strips.observe($scan);
        priv.strips.observe($strip);
        let $nav = priv.$root.querySelector(".yui-zone-bottom");
        if($nav) {
            priv.strips.observe($nav);
        }
    }

    /*  The OS boundary: leaving, hiding, keys. Each becomes an event. */
    window.addEventListener("pagehide", function() {
        gobj_send_event(gobj, "EV_PAGE_HIDDEN", {}, gobj);
    });
    document.addEventListener("visibilitychange", function() {
        if(document.visibilityState === "hidden") {
            gobj_send_event(gobj, "EV_PAGE_HIDDEN", {}, gobj);
        }
    });
    document.addEventListener("keydown", function(e) {
        let tag = e.target && e.target.tagName;
        if(tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.ctrlKey ||
                e.metaKey || e.altKey) {
            return;
        }
        if(KEYS[e.code]) {
            if(e.code === "Space" && tag === "BUTTON") {
                return;             // space on a focused button presses IT
            }
            e.preventDefault();
            gobj_send_event(gobj, "EV_KEY", {code: e.code}, gobj);
        }
    });
}

const KEYS = {
    Space: 1, KeyK: 1, ArrowLeft: 1, ArrowRight: 1, KeyJ: 1, KeyL: 1,
    KeyF: 1, KeyM: 1, KeyN: 1, KeyP: 1, KeyC: 1,
};

function fraction_at(ev, node)
{
    let r = node.getBoundingClientRect();
    if(!r.width) {
        return 0;
    }
    let x = ev.clientX - r.left;
    let f = x / r.width;
    if(getComputedStyle(node).direction === "rtl") {
        f = 1 - f;
    }
    return Math.max(0, Math.min(1, f));
}

/*  The video goes where it can be seen. The deck docks it into its own
    stage when it is shown; everywhere else it is the strip's box. */
function dock(gobj)
{
    let priv = gobj.priv;
    if(priv.on_deck || !priv.$strip) {
        return;
    }
    let v = sounding();
    let $box = priv.$strip.querySelector(".VID_STRIP_BOX");
    if(v && $box) {
        dock_video($box);
    } else {
        dock_video(null);
    }
}

function paint_strip(gobj)
{
    let priv = gobj.priv;
    if(!priv.$strip) {
        return;
    }
    let temp = temp_track();
    let v = sounding();

    /*  Up when there is something on the element AND the player screen
        is not showing — or, while the temporary list plays, always:
        then this strip is the only sign that what is on screen is not
        the deck, and it carries the way back. */
    let show = !!v && (!priv.on_deck || !!temp);
    priv.$root.classList.toggle("has-strip", show);
    priv.$strip.classList.toggle("is-on", show);
    priv.$strip.classList.toggle("is-temp", !!temp);
    dock(gobj);

    let $box = priv.$strip.querySelector(".VID_STRIP_BOX");
    if($box) {
        /*  On the deck the video is in the deck's stage; the box shows
            its picture instead. */
        let $img = $box.querySelector(".VID_THUMB");
        if(priv.on_deck && v) {
            if(!$img || $img.__vid_uid !== v.uid) {
                if($img) {
                    $img.remove();
                }
                $img = document.createElement("span");
                $img.className = "VID_THUMB";
                $img.__vid_uid = v.uid;
                $box.appendChild($img);
                paint_thumb($img, v);
            }
        } else if($img) {
            $img.remove();
        }
    }

    if(!v) {
        priv.tint_key = null;
        clear_accent();
        return;
    }
    set_text(priv.$strip, ".VID_STRIP_TITLE", v.title);
    let sub = facts_of(v);
    if(temp) {
        let at = temp_position();
        sub = [t("temporary list"), (at.length > 1) ? `${at.index + 1} / ${at.length}` : ""]
            .concat(sub);
    }
    set_text(priv.$strip, ".VID_STRIP_SUB", sub.filter(Boolean).join(" · "));
    paint_strip_controls(gobj, !!temp);
    tint_from(gobj, v);
    paint_time(gobj);
}

function paint_strip_controls(gobj, temp)
{
    let priv = gobj.priv;
    let $ctl = priv.$strip.querySelector(".VID_STRIP_CTL");
    if(!$ctl) {
        return;
    }
    let playing = is_sounding();
    let want = (temp ? "T" : "D") + (playing ? "1" : "0");
    if($ctl.__vid_state === want) {
        return;
    }
    $ctl.__vid_state = want;
    clear($ctl);
    const send = (ev) => () => gobj_send_event(gobj, ev, {}, gobj);
    const ibtn = (cls, key, path, ev) => createElement2(
        ["button", {class: "VID_IBTN " + cls, type: "button", ...named(key)},
            svg(path, 20), {click: send(ev)}]);

    if(!temp) {
        $ctl.appendChild(ibtn("VID_STRIP_PREV", "previous", P.prev, "EV_PREV"));
    }
    $ctl.appendChild(ibtn("VID_STRIP_PLAY is-primary", playing ? "pause" : "play",
        playing ? P.pause : P.play, "EV_TOGGLE_PLAY"));
    $ctl.appendChild(ibtn("VID_STRIP_NEXT", "next", P.next, "EV_NEXT"));
    if(temp) {
        $ctl.appendChild(ibtn("VID_STRIP_KEEP", "add to queue", P.enqueue, "EV_KEEP_TEMP"));
        $ctl.appendChild(createElement2(
            ["button", {class: "VID_QBTN VID_BACKDECK button is-ghost", type: "button",
                        i18n: "back to the queue", ...named("back to the queue")},
                t("back to the queue"), {click: send("EV_BACK_TO_DECK")}]));
    }
}

function paint_time(gobj)
{
    let priv = gobj.priv;
    if(!priv.$strip) {
        return;
    }
    let $fill = priv.$strip.querySelector(".VID_STRIP_FILL");
    if($fill) {
        $fill.style.width = (progress().fraction * 100) + "%";
    }
}

/*  "It went to the deck", said for two seconds from wherever ＋ was
    pressed. A label and a figure, never a number welded into a
    sentence: a count in a sentence is a plural rule per language. */
function paint_said(gobj)
{
    let priv = gobj.priv;
    if(!priv.$said) {
        return;
    }
    if(priv.said_timer) {
        clearTimeout(priv.said_timer);
        priv.said_timer = 0;
    }
    let said = last_said();
    clear(priv.$said);
    let parts = [];
    if(said && said.added) {
        parts.push(["span", {class: "VID_SAID_BIT"}, [
            ["span", {i18n: "to the queue"}, t("to the queue")],
            ["b", {class: "VID_SAID_N"}, String(said.added)]
        ]]);
    }
    if(said && said.already) {
        parts.push(["span", {class: "VID_SAID_BIT VID_DIM"}, [
            ["span", {i18n: "already in the queue"}, t("already in the queue")],
            ["b", {class: "VID_SAID_N"}, String(said.already)]
        ]]);
    }
    if(!parts.length) {
        priv.$said.classList.remove("is-on");
        return;
    }
    priv.$said.appendChild(createElement2(["div", {class: "VID_SAID_CARD"}, parts]));
    priv.$said.classList.add("is-on");
    priv.said_timer = setTimeout(function() {
        gobj_send_event(gobj, "EV_SAID_EXPIRED", {}, gobj);
    }, 2400);
}

function paint_scan(gobj)
{
    let priv = gobj.priv;
    if(!priv.$scan) {
        return;
    }
    let st = store_state();
    let src = scanning_source();
    let preparing = is_preparing();
    let on = preparing || !!src || st.loading;

    priv.$root.classList.toggle("is-scanning", on);
    priv.$scan.classList.toggle("is-on", on);
    priv.$scan.classList.toggle("is-preparing", preparing);

    /*  The clock ticks on its own: a folder still being handed over
        produces no events at all, and a frozen clock is a hung app. */
    if(on && !priv.scan_timer) {
        priv.scan_t0 = Date.now();
        priv.scan_timer = setInterval(function() {
            gobj_send_event(gobj, "EV_SCAN_TICK", {}, gobj);
        }, 500);
    } else if(!on && priv.scan_timer) {
        clearInterval(priv.scan_timer);
        priv.scan_timer = 0;
        priv.scan_t0 = 0;
    }
    if(!on) {
        return;
    }

    let $label = priv.$scan.querySelector(".VID_SCAN_LABEL");
    if($label) {
        let key = preparing ? "preparing folder" : "reading folder";
        $label.textContent = t(key);
        $label.setAttribute("data-i18n", key);
    }
    set_text(priv.$scan, ".VID_SCAN_WHAT", (!preparing && src) ? src.name : "");

    let stopping = is_stopping();
    let $stop = priv.$scan.querySelector(".VID_SCAN_STOP");
    if($stop) {
        let key = stopping ? "stopping" : "stop";
        $stop.textContent = t(key);
        $stop.setAttribute("data-i18n", key);
        rename($stop, key);
        $stop.disabled = stopping;
    }

    let total = preparing ? 0 : (st.total || 0);
    let done = st.loaded || 0;
    set_text(priv.$scan, ".VID_SCAN_COUNT", total ? `${done} / ${total}` : "");
    let $fill = priv.$scan.querySelector(".VID_BAR_FILL");
    if($fill) {
        $fill.style.width = total ? ((done / total) * 100) + "%" : "";
        $fill.classList.toggle("is-indeterminate", !total);
    }
    priv.$scan.classList.toggle("is-waiting", !total);
    let $sub = priv.$scan.querySelector(".VID_SCAN_FILE");
    if($sub) {
        if(total) {
            $sub.textContent = st.load_name || "";
            $sub.removeAttribute("data-i18n");
        } else {
            $sub.textContent = t("this can take a while");
            $sub.setAttribute("data-i18n", "this can take a while");
        }
    }
}

/*  C cycles the subtitles: off, then each track, then off again. */
function cycle_subtitles()
{
    let tracks = subtitle_tracks();
    if(!tracks.length) {
        return;
    }
    let i = current_subtitle() + 1;
    set_subtitle(i >= tracks.length ? -1 : i);
}




                    /***************************
                     *      Actions
                     ***************************/




function ac_store(gobj, event, kw, src)
{
    let ch = kw.channel;
    if(ch === "time") {
        paint_time(gobj);
    } else if(ch === "loading") {
        paint_scan(gobj);
    } else if(ch === "said") {
        paint_said(gobj);
    } else {
        paint_strip(gobj);
    }
    if(ch === "queue" || ch === "playing") {
        save_deck_soon(gobj);
    }
    return 0;
}

function ac_toggle_theme(gobj, event, kw, src)
{
    apply_theme(current_theme() === "dark" ? "light" : "dark");
    show_choices(gobj);
    gobj.priv.tint_key = null;
    paint_strip(gobj);
    return 0;
}

function ac_set_palette(gobj, event, kw, src)
{
    apply_palette((kw && kw.palette) || "auto");
    show_choices(gobj);
    gobj.priv.tint_key = null;
    paint_strip(gobj);
    return 0;
}

function ac_set_locale(gobj, event, kw, src)
{
    let code = (kw && kw.locale) || "";
    if(!code || code === current_locale()) {
        return 0;
    }
    switch_locale(code);
    set_ui_language(code);
    show_choices(gobj);
    yui_shell_language_changed(gobj.priv.shell);
    refresh_language(gobj.priv.$root, t);
    paint_strip(gobj);
    return 0;
}

function ac_open_about(gobj, event, kw, src)
{
    open_about(gobj, gobj.priv.shell, false);
    return 0;
}

function ac_open_sitemap(gobj, event, kw, src)
{
    yui_shell_show_route_map(gobj.priv.shell, {t: t});
    return 0;
}

function ac_open_developer(gobj, event, kw, src)
{
    open_developer(gobj, gobj.priv.shell);
    return 0;
}

/*  A dialog this gobj opened (welcome, install, developer) speaks. */
function ac_dialog(gobj, event, kw, src)
{
    return dialog_action(gobj, kw);
}

function ac_route_changed(gobj, event, kw, src)
{
    let route = (kw && (kw.base || kw.route)) || "";
    gobj.priv.on_deck = (route === DECK_ROUTE);
    paint_strip(gobj);
    return 0;
}

function ac_go_to_deck(gobj, event, kw, src)
{
    yui_shell_navigate(gobj.priv.shell, DECK_ROUTE);
    return 0;
}

function ac_toggle_play(gobj, event, kw, src)
{
    toggle();
    return 0;
}

function ac_prev(gobj, event, kw, src)
{
    prev();
    return 0;
}

function ac_next(gobj, event, kw, src)
{
    step(1);
    return 0;
}

function ac_seek(gobj, event, kw, src)
{
    seek_fraction(Number(kw.fraction) || 0);
    return 0;
}

function ac_stop_scan(gobj, event, kw, src)
{
    stop_scan();
    return 0;
}

function ac_back_to_deck(gobj, event, kw, src)
{
    back_to_deck();
    return 0;
}

function ac_keep_temp(gobj, event, kw, src)
{
    let v = temp_track();
    if(v) {
        queue_add([v], "append");
    }
    return 0;
}

function ac_key(gobj, event, kw, src)
{
    switch(kw.code) {
        case "Space":
        case "KeyK":
            toggle();
            break;
        case "ArrowLeft":
        case "KeyJ":
            seek_by(-10);
            break;
        case "ArrowRight":
        case "KeyL":
            seek_by(10);
            break;
        case "KeyF":
            toggle_fullscreen();
            break;
        case "KeyM": {
            let el = get_video();
            el.muted = !el.muted;
            break;
        }
        case "KeyN":
            step(1);
            break;
        case "KeyP":
            prev();
            break;
        case "KeyC":
            cycle_subtitles();
            break;
        default:
            log_error(`${GCLASS_NAME}: key not handled: ${kw.code}`);
            break;
    }
    return 0;
}

/*  What the element said, answered (see video_store's channels). The
    end of a video is noted in the stats BEFORE the next one is loaded:
    the count belongs to the one that ended. */
function ac_media(gobj, event, kw, src)
{
    switch(kw.what) {
        case "metadata":
            on_metadata();
            break;
        case "canplay":
            on_canplay();
            break;
        case "ended":
            note_ended();
            on_ended();
            break;
        case "error":
            on_media_error();
            break;
        default:
            log_error(`${GCLASS_NAME}: unknown media event: ${kw.what}`);
            return -1;
    }
    return 0;
}

/*  A key of the system: a headset, the lock screen, the media keys. */
function ac_media_key(gobj, event, kw, src)
{
    if(!media_action(kw.action)) {
        log_error(`${GCLASS_NAME}: unknown media action: ${kw.action}`);
        return -1;
    }
    return 0;
}

function ac_save_deck(gobj, event, kw, src)
{
    gobj.priv.save_timer = 0;
    store_deck();
    return 0;
}

function ac_said_expired(gobj, event, kw, src)
{
    gobj.priv.said_timer = 0;
    clear_said();
    return 0;
}

/*  The clock ticks on its own: a folder still being handed over
    produces no events at all, and a frozen clock is a hung app. */
function ac_scan_tick(gobj, event, kw, src)
{
    let priv = gobj.priv;
    if(!priv.scan_t0) {
        return 0;       // the read ended and the timer with it: a tick in flight
    }
    set_text(priv.$scan, ".VID_SCAN_CLOCK", fmt_time((Date.now() - priv.scan_t0) / 1000));
    return 0;
}

/*  The picture of what plays has loaded: its colour, unless another
    one was asked for meanwhile. */
function ac_tint_ready(gobj, event, kw, src)
{
    if(kw.key !== gobj.priv.tint_key) {
        return 0;       // a newer picture was asked for: this one is stale
    }
    tint_read(gobj);
    return 0;
}

function ac_tint_failed(gobj, event, kw, src)
{
    if(kw.key !== gobj.priv.tint_key) {
        return 0;       // a newer picture was asked for: this one is stale
    }
    log_warning(`${GCLASS_NAME}: the picture for the accent did not load`);
    clear_accent();
    return 0;
}

/*  The tab can go away at any moment: the deck and the place inside
    the video go down now, not in a second and a half. */
function ac_page_hidden(gobj, event, kw, src)
{
    store_deck();
    flush_places();
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
            ["EV_TOGGLE_THEME",     ac_toggle_theme,    null],
            ["EV_SET_PALETTE",      ac_set_palette,     null],
            ["EV_SET_LOCALE",       ac_set_locale,      null],
            ["EV_OPEN_ABOUT",       ac_open_about,      null],
            ["EV_OPEN_SITEMAP",     ac_open_sitemap,    null],
            ["EV_OPEN_DEVELOPER",   ac_open_developer,  null],
            ["EV_DIALOG",           ac_dialog,          null],
            ["EV_ROUTE_CHANGED",    ac_route_changed,   null],
            ["EV_GO_TO_DECK",       ac_go_to_deck,      null],
            ["EV_TOGGLE_PLAY",      ac_toggle_play,     null],
            ["EV_PREV",             ac_prev,            null],
            ["EV_NEXT",             ac_next,            null],
            ["EV_SEEK",             ac_seek,            null],
            ["EV_STOP_SCAN",        ac_stop_scan,       null],
            ["EV_BACK_TO_DECK",     ac_back_to_deck,    null],
            ["EV_KEEP_TEMP",        ac_keep_temp,       null],
            ["EV_KEY",              ac_key,             null],
            ["EV_PAGE_HIDDEN",      ac_page_hidden,     null],
            ["EV_MEDIA",            ac_media,           null],
            ["EV_MEDIA_KEY",        ac_media_key,       null],
            ["EV_SAVE_DECK",        ac_save_deck,       null],
            ["EV_SAID_EXPIRED",     ac_said_expired,    null],
            ["EV_SCAN_TICK",        ac_scan_tick,       null],
            ["EV_TINT_READY",       ac_tint_ready,      null],
            ["EV_TINT_FAILED",      ac_tint_failed,     null]
        ]]
    ];

    const event_types = [
        ["EV_STORE",            0],
        ["EV_TOGGLE_THEME",     0],
        ["EV_SET_PALETTE",      0],
        ["EV_SET_LOCALE",       0],
        ["EV_OPEN_ABOUT",       0],
        ["EV_OPEN_SITEMAP",     0],
        ["EV_OPEN_DEVELOPER",   0],
        ["EV_DIALOG",           0],
        ["EV_ROUTE_CHANGED",    0],
        ["EV_GO_TO_DECK",       0],
        ["EV_TOGGLE_PLAY",      0],
        ["EV_PREV",             0],
        ["EV_NEXT",             0],
        ["EV_SEEK",             0],
        ["EV_STOP_SCAN",        0],
        ["EV_BACK_TO_DECK",     0],
        ["EV_KEEP_TEMP",        0],
        ["EV_KEY",              0],
        ["EV_PAGE_HIDDEN",      0],
        ["EV_MEDIA",            0],
        ["EV_MEDIA_KEY",        0],
        ["EV_SAVE_DECK",        0],
        ["EV_SAID_EXPIRED",     0],
        ["EV_SCAN_TICK",        0],
        ["EV_TINT_READY",       0],
        ["EV_TINT_FAILED",      0]
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
        STORE_TRACE_LEVELS,
        0
    );
    if(!__gclass__) {
        return -1;
    }
    return 0;
}

function register_c_yunovideo()
{
    return create_gclass(GCLASS_NAME);
}

export {register_c_yunovideo};
