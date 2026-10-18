/***********************************************************************
 *          subtitles.js
 *
 *      A subtitle file, made into something a <track> will read.
 *
 *      Browsers read WebVTT and nothing else, and most subtitles in the
 *      world are SubRip (.srt). The two are close: a header, and a comma
 *      where VTT wants a dot in the timestamps. The cue numbers SRT puts
 *      before each block are legal VTT cue identifiers, so they stay.
 *
 *      The harder part is the ENCODING. An .srt carries no declaration
 *      of one, and a great many were written in a Windows code page by
 *      a tool that never heard of UTF-8. Read as UTF-8 they come out
 *      with every accent replaced by a question mark in a diamond. So
 *      the bytes are tried as UTF-8 first, strictly — a file that is
 *      not valid UTF-8 throws — and read as windows-1252 when they are
 *      not. That covers Western European text, which is most of what
 *      gets downloaded beside a film; a Cyrillic or Greek code page
 *      would still come out wrong, and nothing in the file says which
 *      one it was.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/

function decode_text(buffer)
{
    /*  A byte-order mark says it outright. UTF-16 is what Windows
        Notepad writes when told "Unicode": read as anything else it is
        a NUL between every letter, and not one cue. */
    const b = new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength));
    if(b.length === 2 && b[0] === 0xFF && b[1] === 0xFE) {
        return new TextDecoder("utf-16le").decode(buffer);
    }
    if(b.length === 2 && b[0] === 0xFE && b[1] === 0xFF) {
        return new TextDecoder("utf-16be").decode(buffer);
    }
    try {
        return new TextDecoder("utf-8", {fatal: true}).decode(buffer);
    } catch(e) {
        return new TextDecoder("windows-1252").decode(buffer);
    }
}

/*  A timestamp as WebVTT wants it: two digits of hours at least, and
    exactly three of milliseconds — "0:00:01,5" is half a second past
    one, and a cue whose time is not written that way is dropped. */
function vtt_time(match, h, m, sec, ms)
{
    return h.padStart(2, "0") + ":" + m + ":" + sec + "." + ms.padEnd(3, "0");
}

function srt_to_vtt(text)
{
    let body = String(text || "")
        .replace(/^\uFEFF/, "")
        .replace(/\r\n?/g, "\n")
        /*  A line of spaces between two cues is the end of the first;
            left as it is, the next cue's number joins its text. */
        .replace(/^[ \t]+$/gm, "")
        .replace(/(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/g, vtt_time)
        .trim();
    if(/^WEBVTT/.test(body)) {
        return body + "\n";
    }
    return "WEBVTT\n\n" + body + "\n";
}

export {decode_text, srt_to_vtt};
