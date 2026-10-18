/***********************************************************************
 *          install_prompt.js
 *
 *      Can this be installed, and has anyone offered?
 *
 *      Chrome decides on its own whether to show its install banner, and
 *      the heuristic behind that decision is not ours to read: once the
 *      mini-infobar has been dismissed — or once the app has been
 *      installed and removed — the browser goes quiet on this origin for
 *      about three months. The app then LOOKS uninstallable, when in
 *      fact it is only unadvertised, and the way in is buried in the
 *      browser menu. That is exactly what a reinstall runs into.
 *
 *      So the browser's own banner is refused (`preventDefault` in
 *      index.html, before this bundle even loads) and the event it came
 *      with is kept. Asking is then the app's job, at a moment the app
 *      chooses, and calling prompt() on that saved event opens the real
 *      system install dialog — the same one, just not on Chrome's
 *      schedule.
 *
 *      Installing is not cosmetic here: Chrome only offers persistent
 *      folder permissions ("Allow on every visit") to installed apps.
 *      An uninstalled yunovídeo re-asks for every folder on every
 *      launch.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {log_warning} from "@yuneta/gobj-js";

const listeners = new Set();

const S = {
    installed:  false,      // seen installed, this session
    bar_gone:   false,      // the bar was closed by hand, this session
};


function subscribe_install(fn)
{
    listeners.add(fn);
    return function unsubscribe() {
        listeners.delete(fn);
    };
}

function emit()
{
    for(const fn of listeners) {
        try {
            fn("install");
        } catch(e) {
            console.error("install_prompt listener failed", e);
        }
    }
}


/***************************************************************
 *  The deferred event, stashed by the snippet in index.html.
 *  It is single-use: once prompt() has been called on it the
 *  browser will not honour it again, so it is dropped there.
 ***************************************************************/
function deferred()
{
    return window.__yunovideo_install || null;
}


/***************************************************************
 *  Are we already running as an installed app? Two answers,
 *  because neither is complete on its own: the display mode is
 *  what the launcher gives us, and the flag is what we learned
 *  from installing during this very session (the window we are
 *  in was opened in a tab and does not change mode).
 ***************************************************************/
function is_installed()
{
    if(S.installed) {
        return true;
    }
    try {
        return !!(window.matchMedia &&
            window.matchMedia("(display-mode: standalone)").matches);
    } catch(e) {
        return false;
    }
}


/***************************************************************
 *  Is there a real install to offer? Never true on a browser
 *  that does not do this (Firefox, Safari): there is no event
 *  to save, so nothing is promised that cannot be delivered.
 ***************************************************************/
function can_install()
{
    return !!deferred() && !is_installed();
}


/***************************************************************
 *  Open the system install dialog. MUST be called from a user
 *  gesture — do not await anything before it.
 *
 *  Resolves to "accepted", "dismissed", or null when there was
 *  nothing to prompt with. A dismissal is not final: Chrome
 *  fires the event again on a later visit.
 ***************************************************************/
async function do_install()
{
    const ev = deferred();
    if(!ev) {
        return null;
    }
    window.__yunovideo_install = null;

    let outcome = null;
    try {
        ev.prompt();
        const choice = await ev.userChoice;
        outcome = choice ? choice.outcome : null;
    } catch(e) {
        log_warning(`install_prompt: the install prompt failed: ${(e && e.name) || e}`);
        emit();
        return null;
    }

    if(outcome === "accepted") {
        S.installed = true;
    }
    emit();
    return outcome;
}


/***************************************************************
 *  The bar on the player screen, closed by hand. Not stored:
 *  it is a "not on this screen, right now", not a decision, and
 *  the next launch may well be the one where installing is
 *  wanted.
 ***************************************************************/
function dismiss_install_bar()
{
    S.bar_gone = true;
    emit();
}

function install_bar_due()
{
    return can_install() && !S.bar_gone;
}


/***************************************************************
 *  Start listening. The event itself is caught in index.html —
 *  it can arrive before this bundle is parsed — and re-emitted
 *  under our own name, which is what we pick up here.
 ***************************************************************/
function start_install_watch()
{
    window.addEventListener("yunovideo:installable", function() {
        S.bar_gone = false;         // a fresh offer deserves a fresh bar
        emit();
    });
    /*  Installed from the browser menu, or from our dialog. Either way
        the offer is over and every trace of it goes. */
    window.addEventListener("appinstalled", function() {
        S.installed = true;
        window.__yunovideo_install = null;
        emit();
    });
}


export {
    subscribe_install,
    start_install_watch,
    can_install,
    is_installed,
    do_install,
    install_bar_due,
    dismiss_install_bar,
};
