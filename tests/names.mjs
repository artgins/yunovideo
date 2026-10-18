/***********************************************************************
 *          names.mjs
 *
 *      What a file NAME is read as — in node, no browser: names.js and
 *      subtitles.js are pure. Each line here is a name somebody really
 *      keeps videos under, and what the library must make of it.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {parse_name, pair_subtitles, is_video} from "../src/names.js";
import {srt_to_vtt, decode_text} from "../src/subtitles.js";

let failures = 0;
function check(ok, what)
{
    console.log((ok ? "ok    " : "FAIL  ") + what);
    if(!ok) {
        failures++;
    }
}

const CASES = [
    ["tv/The.Expanse.S02E05.Home.1080p.WEB-DL.x264.mkv",
        {show: "The Expanse", season: 2, episode: 5, title: "Home"}],
    ["Doctor Who - 3x07 - 42.mp4", {show: "Doctor Who", season: 3, episode: 7, title: "42"}],
    ["Fargo/Season 1/04 - Eating the Blame.mkv",
        {show: "Fargo", season: 1, episode: 4, title: "Eating the Blame"}],
    ["Series/Dark/Temporada 2/E03.mkv", {show: "Dark", season: 2, episode: 3, title: "S02E03"}],
    ["pelis/Arrival (2016).mkv", {show: "", title: "Arrival", year: "2016"}],
    ["Blade.Runner.2049.2017.2160p.HDR.mkv", {title: "Blade Runner 2049", year: "2017"}],
    ["1917.mkv", {title: "1917", year: ""}],
    ["x/[Group] Some Anime - S01E03 [720p].mkv", {show: "Some Anime", season: 1, episode: 3}],
    ["Show Name/Season 2/Show.Name.S02E01.webm", {show: "Show Name", season: 2, episode: 1}],
    ["Mr. Robot S01E01.mkv", {show: "Mr. Robot", season: 1, episode: 1}],
];

for(const [path, want] of CASES) {
    const got = parse_name(path);
    const bad = Object.keys(want).filter((k) => got[k] !== want[k]);
    check(!bad.length, `${path} → ${JSON.stringify(got)}`);
}

const subs = pair_subtitles(
    ["a/Movie.mkv", "a/Movie 2.mkv", "b/clip.mp4"],
    ["a/Movie.es.srt", "a/Movie 2.srt", "a/Movie.srt", "b/whatever.vtt"]);
check(JSON.stringify(subs.get("a/Movie.mkv")) ===
      JSON.stringify([{path: "a/Movie.srt", label: ""}, {path: "a/Movie.es.srt", label: "es"}]),
      "Movie.srt and Movie.es.srt go with Movie.mkv");
check(subs.get("a/Movie 2.mkv").length === 1, "Movie 2.srt goes with Movie 2.mkv, not with Movie.mkv");
check(subs.get("b/clip.mp4")[0].label === "whatever",
      "a video alone in its folder takes the subtitle beside it");

check(is_video({name: "x.MKV"}) && is_video({name: "noext", type: "video/mp4"}) &&
      !is_video({name: "x.srt"}), "videos by extension and by type");

const vtt = srt_to_vtt("﻿1\r\n00:00:01,500 --> 00:00:02,000\r\nHi\r\n");
check(vtt === "WEBVTT\n\n1\n00:00:01.500 --> 00:00:02.000\nHi\n", "srt → vtt: header, dots, newlines");
const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xE9]);        // "café" in windows-1252
check(decode_text(latin1.buffer) === "café", "an .srt that is not UTF-8 is read as windows-1252");

console.log("=== ERRORS (0) ===");
process.exit(failures ? 1 : 0);
