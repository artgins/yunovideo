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
import {get_video} from "./video_store.js";

function in_fullscreen()
{
    return !!document.fullscreenElement;
}

function toggle_fullscreen()
{
    if(document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
        return;
    }
    const el = get_video();
    const $target = (el.closest && el.closest(".VID_PLAYER")) || el;
    if(!$target.requestFullscreen) {
        return;
    }
    $target.requestFullscreen().then(function() {
        if(el.videoWidth > el.videoHeight && screen.orientation && screen.orientation.lock) {
            screen.orientation.lock("landscape").catch(() => {});
        }
    }).catch(() => {});
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
        document.exitPictureInPicture().catch(() => {});
        return;
    }
    const el = get_video();
    if(!el.getAttribute("src") || !el.requestPictureInPicture) {
        return;
    }
    el.requestPictureInPicture().catch(() => {});
}

export {in_fullscreen, toggle_fullscreen, pip_supported, in_pip, toggle_pip};
