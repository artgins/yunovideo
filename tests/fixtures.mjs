/***********************************************************************
 *          fixtures.mjs
 *
 *      The video tree the suite plays against. GENERATED, not
 *      committed (gitignored): a few small WebM files made by ffmpeg,
 *      a subtitle written by hand, and one file that is not a video at
 *      all.
 *
 *      WebM (VP8 + Opus) because the suite runs Playwright's Chromium,
 *      which ships without the proprietary decoders: an .mp4 of H.264
 *      would be exactly the "cannot play here" case, and that case has
 *      a fixture of its own (broken.mkv).
 *
 *      The picture is ffmpeg's test card with a clock burnt in, so a
 *      frame is never black — a thumbnail test reading back a black
 *      frame could not tell a good one from a broken one.
 *
 *          videos/
 *              pelis/Arrival (2016).webm                       40 s
 *              series/Show Name/Season 1/Show.Name.S01E01.Pilot.webm
 *              series/Show Name/Season 1/Show.Name.S01E01.Pilot.es.srt
 *              series/Show Name/Season 1/Show.Name.S01E02.webm
 *              series/Show Name/Season 2/Show.Name.S02E01.webm
 *              clips/clip one.webm                             6 s
 *              clips/clip two.webm                             6 s
 *              clips/broken.mkv                                not a video
 *
 *      Usage:  node tests/fixtures.mjs [--force]
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {execFileSync} from "child_process";
import {existsSync, mkdirSync, writeFileSync, rmSync} from "fs";
import {dirname, join} from "path";
import {fileURLToPath} from "url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "fixtures");
const VIDEOS = join(ROOT, "videos");

const FILES = [
    ["pelis/Arrival (2016).webm", 40, 440],
    ["series/Show Name/Season 1/Show.Name.S01E01.Pilot.webm", 12, 523],
    ["series/Show Name/Season 1/Show.Name.S01E02.webm", 12, 587],
    ["series/Show Name/Season 2/Show.Name.S02E01.webm", 12, 659],
    ["clips/clip one.webm", 6, 698],
    ["clips/clip two.webm", 6, 784],
];

const SRT = `1
00:00:00,500 --> 00:00:09,000
Hola, ¿qué tal?

2
00:00:09,000 --> 00:00:12,000
Adiós.
`;

function make_video(path, seconds, hz)
{
    mkdirSync(dirname(path), {recursive: true});
    execFileSync("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", `testsrc=size=320x180:rate=10:duration=${seconds}`,
        "-f", "lavfi", "-i", `sine=frequency=${hz}:duration=${seconds}`,
        "-c:v", "libvpx", "-b:v", "120k", "-deadline", "realtime",
        "-c:a", "libopus", "-b:a", "24k",
        "-shortest", path,
    ]);
}

function ensure_fixtures(force)
{
    const built = [];
    if(force && existsSync(VIDEOS)) {
        rmSync(VIDEOS, {recursive: true, force: true});
    }
    for(const [rel, seconds, hz] of FILES) {
        const p = join(VIDEOS, rel);
        if(!existsSync(p)) {
            make_video(p, seconds, hz);
            built.push(rel);
        }
    }
    const srt = join(VIDEOS, "series/Show Name/Season 1/Show.Name.S01E01.Pilot.es.srt");
    if(!existsSync(srt)) {
        writeFileSync(srt, SRT);
        built.push("subtitle");
    }
    const broken = join(VIDEOS, "clips/broken.mkv");
    if(!existsSync(broken)) {
        writeFileSync(broken, Buffer.from("this is not a matroska file, only its name says so\n".repeat(40)));
        built.push("broken.mkv");
    }
    return {built: built, root: VIDEOS};
}

if(process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const r = ensure_fixtures(process.argv.includes("--force"));
    console.log(r.built.length ? `built: ${r.built.join(", ")}` : "fixtures up to date");
}

export {ensure_fixtures, VIDEOS};
