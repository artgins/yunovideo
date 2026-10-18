/***********************************************************************
 *          sub_label.js
 *
 *      How a subtitle track is named on screen.
 *
 *      The label is what followed the video's name in the subtitle's
 *      file name: "es", "en.forced", "Spanish", or nothing. A language
 *      code is shown as the language, in the language of the app
 *      ("es" reads "español" in Spanish and "Spanish" in English), via
 *      Intl.DisplayNames; anything else is shown as it was written,
 *      because it is the user's own word for it. No label at all is
 *      "Subtitles".
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import i18next, {t} from "i18next";

function sub_label(label)
{
    const s = String(label || "");
    if(!s) {
        return t("subtitles");
    }
    const m = /^([a-z]{2,3})(?:[-_]([a-z]{2,4}))?(?:\.(.+))?$/i.exec(s);
    if(m && typeof Intl !== "undefined" && Intl.DisplayNames) {
        try {
            const names = new Intl.DisplayNames([i18next.language || "en"], {type: "language"});
            const code = m[2] ? (m[1] + "-" + m[2]) : m[1];
            const name = names.of(code.toLowerCase());
            if(name && name.toLowerCase() !== code.toLowerCase()) {
                return m[3] ? (name + " (" + m[3] + ")") : name;
            }
        } catch(e) {
            /*  Not a code this engine knows: shown as written. */
        }
    }
    return s;
}

export {sub_label};
