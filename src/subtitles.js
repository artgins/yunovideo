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
    try {
        return new TextDecoder("utf-8", {fatal: true}).decode(buffer);
    } catch(e) {
        return new TextDecoder("windows-1252").decode(buffer);
    }
}

function srt_to_vtt(text)
{
    let body = String(text || "")
        .replace(/^﻿/, "")
        .replace(/\r\n?/g, "\n")
        .replace(/(\d{1,2}:\d{2}:\d{2}),(\d{1,3})/g, "$1.$2")
        .trim();
    if(/^WEBVTT/.test(body)) {
        return body + "\n";
    }
    return "WEBVTT\n\n" + body + "\n";
}

export {decode_text, srt_to_vtt};
