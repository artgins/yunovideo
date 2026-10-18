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
    /*  An underscore is the dotted style's other separator. */
    ["The.Expanse_S02E05.mkv", {show: "The Expanse", season: 2, episode: 5}],
    ["Movie.Name_2016_1080p.mkv", {title: "Movie Name", year: "2016"}],
    /*  Release tags that are also words are part of a name, unless
        they stand in the tail. */
    ["The Proper Way.mp4", {title: "The Proper Way", year: ""}],
    ["The Multi Dimension.mkv", {title: "The Multi Dimension"}],
    ["Show.S01E01.Proper.Goodbye.mkv", {season: 1, episode: 1, title: "Proper Goodbye"}],
    ["Show.S01E01.PROPER.1080p.mkv", {season: 1, episode: 1, title: "S01E01"}],
    ["Movie.2016.EXTENDED.1080p.BluRay.x264.mkv", {title: "Movie", year: "2016"}],
    ["Internal Affairs (1990).mkv", {title: "Internal Affairs", year: "1990"}],
    ["Charlotte's Web.mkv", {title: "Charlotte's Web"}],
    /*  A number ending a name is not always a release year. */
    ["Blade Runner 2049.mkv", {title: "Blade Runner 2049", year: ""}],
    ["Death Race 2000.mkv", {title: "Death Race 2000", year: ""}],
    ["Arrival.2016.mkv", {title: "Arrival", year: "2016"}],
    ["Arrival 2016 1080p WEB-DL.mkv", {title: "Arrival", year: "2016"}],
    ["Blade Runner 2049 (2017).mkv", {title: "Blade Runner 2049", year: "2017"}],
    /*  x264 is the codec, not episode 264. */
    ["Some.Show.S01E02.DDP5.1x264.mkv", {show: "Some Show", season: 1, episode: 2, title: "S01E02"}],
    ["Show.S01E01-E02.mkv", {show: "Show", season: 1, episode: 1, title: "S01E01"}],
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

const subs2 = pair_subtitles(["c/Movie.mkv", "c/Other.mkv"],
    ["c/movie.en.srt", "c/Movie_es.srt", "c/Movie-fr.srt", "c/Other.srt"]);
check(JSON.stringify((subs2.get("c/Movie.mkv") || []).map((x) => x.label)) === '["en","es","fr"]',
      "movie.en, Movie_es and Movie-fr go with Movie.mkv, with two videos in the folder");

check(is_video({name: "x.MKV"}) && is_video({name: "noext", type: "video/mp4"}) &&
      !is_video({name: "x.srt"}), "videos by extension and by type");
check(!is_video({name: "app.ts", size: 4000}) && is_video({name: "rec.ts", size: 50e6}) &&
      is_video({name: "app.ts", size: 4000, type: "video/mp2t"}),
      "a small .ts is TypeScript, a big one is a transport stream");

const vtt = srt_to_vtt("﻿1\r\n00:00:01,500 --> 00:00:02,000\r\nHi\r\n");
check(vtt === "WEBVTT\n\n1\n00:00:01.500 --> 00:00:02.000\nHi\n", "srt → vtt: header, dots, newlines");
const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xE9]);        // "café" in windows-1252
check(decode_text(latin1.buffer) === "café", "an .srt that is not UTF-8 is read as windows-1252");
const u16 = new Uint8Array([0xFF, 0xFE, 0x63, 0x00, 0x61, 0x00, 0x66, 0x00, 0xE9, 0x00]);
check(decode_text(u16.buffer) === "café", "an .srt in UTF-16 (Notepad's \"Unicode\") is read as such");
const u16be = new Uint8Array([0xFE, 0xFF, 0x00, 0x63, 0x00, 0xE9]);
check(decode_text(u16be.buffer) === "cé", "and in UTF-16 big-endian");
check(srt_to_vtt("1\n0:00:01,5 --> 0:00:02,25\nHi\n  \n2\n00:00:03,000 --> 00:00:04,000\nYo\n") ===
      "WEBVTT\n\n1\n00:00:01.500 --> 00:00:02.250\nHi\n\n2\n00:00:03.000 --> 00:00:04.000\nYo\n",
      "srt → vtt: short hours and milliseconds padded, a line of spaces ends a cue");

console.log("=== ERRORS (0) ===");
process.exit(failures ? 1 : 0);
