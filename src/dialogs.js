/***********************************************************************
 *          dialogs.js
 *
 *      Where EV_DIALOG lands. A dialog's controls (and the answers that
 *      reach it late) send EV_DIALOG {dialog, act, ...} to the gobj
 *      that opened it; that gobj's action calls dialog_action(), which
 *      hands the kw to the dialog it names. The confirm dialog answers
 *      with what was chosen; the others with 0 or -1.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {log_error} from "@yuneta/gobj-js";

import {about_action} from "./about_dialog.js";
import {install_action} from "./install_dialog.js";
import {confirm_action} from "./confirm_replace.js";
import {dev_action} from "./dev_dialog.js";


function dialog_action(gobj, kw)
{
    switch(kw.dialog) {
        case "about":
            return about_action(kw);
        case "install":
            return install_action(kw);
        case "confirm":
            return confirm_action(kw);
        case "dev":
            return dev_action(kw);
        default:
            log_error(`dialogs: unknown dialog: ${kw.dialog}`);
            return -1;
    }
}


export {dialog_action};
