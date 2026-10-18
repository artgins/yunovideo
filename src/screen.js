/***********************************************************************
 *          screen.js
 *
 *      Fullscreen and picture-in-picture: the two ways a video leaves
 *      the page it is on.
 *
 *      FULLSCREEN takes the whole player block — the picture AND its
 *      controls — not the bare <video>. A bare element in fullscreen
 *      shows the browser's own controls or none, and on a phone "none"
 *      is a film with no way to pause it. On a phone a wide video also
 *      asks for landscape, which the system may refuse (and on desktop
 *      always does): refused is fine, the picture is still fullscreen.
 *
 *      An iPhone has no fullscreen for anything but a <video>, and that
 *      only through its own player (webkitEnterFullscreen). There the
 *      bare element is the only fullscreen there is, with the system's
 *      controls, which do pause — better than a button that does
 *      nothing. Where neither exists the button is hidden.
 *
 *      PICTURE-IN-PICTURE is the browser's floating window. It is also
 *      the honest answer to "can it play while I do something else?":
 *      what a browser does with a video whose page is hidden is its
 *      own call — Chrome on Android stops decoding the picture — and a
 *      PiP window is the one way to keep watching that every engine
 *      that has it respects.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {log_warning} from "@yuneta/gobj-js";

import {get_video} from "./video_store.js";

const refused = (what) => (e) => log_warning(`screen: ${what} refused: ${(e && e.name) || e}`);

function in_fullscreen()
{
    return !!document.fullscreenElement || !!get_video().webkitDisplayingFullscreen;
}

/*  The block can go fullscreen, or at least the bare element can. */
function fullscreen_supported()
{
    const el = get_video();
    return (!!document.fullscreenEnabled && !!el.requestFullscreen) ||
           typeof el.webkitEnterFullscreen === "function";
}

function toggle_fullscreen()
{
    if(document.fullscreenElement) {
        document.exitFullscreen().catch(refused("leaving fullscreen"));
        return;
    }
    const el = get_video();
    const $target = (el.closest && el.closest(".VID_PLAYER")) || el;
    if(!document.fullscreenEnabled || !$target.requestFullscreen) {
        if(typeof el.webkitEnterFullscreen === "function") {
            try {
                el.webkitEnterFullscreen();
            } catch(e) {
                refused("the system player")(e);
            }
            return;
        }
        log_warning("screen: no fullscreen in this browser");
        return;
    }
    $target.requestFullscreen().then(function() {
        if(el.videoWidth > el.videoHeight && screen.orientation && screen.orientation.lock) {
            /*  Refused on desktop, always, and that is fine: the
                picture is fullscreen anyway. */
            screen.orientation.lock("landscape").catch(function(e) {
                if(e && e.name !== "NotSupportedError") {
                    refused("landscape")(e);
                }
            });
        }
    }).catch(refused("fullscreen"));
}

function pip_supported()
{
    return !!document.pictureInPictureEnabled;
}

function in_pip()
{
    return !!document.pictureInPictureElement;
}

function toggle_pip()
{
    if(document.pictureInPictureElement) {
        document.exitPictureInPicture().catch(refused("leaving picture-in-picture"));
        return;
    }
    const el = get_video();
    if(!el.getAttribute("src") || !el.requestPictureInPicture) {
        log_warning("screen: picture-in-picture with nothing loaded, or not here");
        return;
    }
    el.requestPictureInPicture().catch(refused("picture-in-picture"));
}

export {in_fullscreen, fullscreen_supported, toggle_fullscreen, pip_supported, in_pip, toggle_pip};
