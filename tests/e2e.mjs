/***********************************************************************
 *          e2e.mjs
 *
 *      The long one. Hand the app the fixture folder through the
 *      folder picker, then walk it: the library in its three views,
 *      a video cued on the deck and PLAYING (the clock moves, a frame
 *      is drawn), the subtitles beside it read and shown, a thumbnail
 *      made, the broken file said to be unplayable, the queue edited
 *      and saved as a list, and a reload that brings the deck back.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {ensure_fixtures} from "./fixtures.mjs";
import {OUT, launch, new_page, boot, route, add_source, report} from "./lib.mjs";

const FIX = ensure_fixtures();

const browser = await launch();
const page = await new_page(browser, {viewport: {width: 1280, height: 900}, locale: "en-US"});

let failures = 0;
function check(ok, what)
{
    console.log((ok ? "ok    " : "FAIL  ") + what);
    if(!ok) {
        failures++;
    }
}

const shot = (name) => page.screenshot({path: `${OUT}/e2e-${name}.png`});

await boot(page);
await shot("01-empty");

/*  The folder picker, with the whole tree. */
await add_source(page, [FIX.root], 1, 2500);
await shot("02-sources");
const count = await page.locator(".VID_SRCROW .VID_T2").first().textContent();
check(/7\s*videos/.test(count.replace(/\s+/g, " ")), `source row counts 7 videos: "${count}"`);

/*  Adding a source to an empty deck CUES it. */
await route(page, "#/player", 900);
const qrows = await page.locator(".VID_QROW").count();
check(qrows === 7, `the deck was cued with the folder: ${qrows} rows`);
await shot("03-deck-cued");

/*  Library: folders, series, all. */
await route(page, "#/library", 900);
const top = await page.locator(".VID_LIBLIST .VID_DIRROW .VID_NAME").allTextContents();
check(top.join("|") === "clips|pelis|series", `top level of the folder tree: ${top.join("|")}`);
await page.click('.VID_CHIP[data-view="series"]');
await page.waitForTimeout(400);
const shows = await page.locator(".VID_SHOWROW .VID_NAME").allTextContents();
check(shows.length === 1 && shows[0] === "Show Name", `one series, "Show Name": ${shows.join("|")}`);
await page.click(".VID_SHOWROW .VID_NAME");
await page.waitForTimeout(400);
const seasons = await page.locator(".VID_SEASONTITLE").count();
check(seasons === 2, `two seasons in it: ${seasons}`);
const eps = await page.locator(".C_VID_LIBRARY .VID_ROW .VID_NAME").allTextContents();
check(eps.join("|") === "Pilot|S01E02|S02E01", `episodes in order: ${eps.join("|")}`);
await shot("04-series");
await page.click('.VID_CHIP[data-view="all"]');
await page.waitForTimeout(400);
const all = await page.locator(".C_VID_LIBRARY .VID_ROW .VID_NAME").count();
check(all === 7, `all: 7 videos (${all})`);

/*  Thumbnails are made for the rows on screen. */
await page.waitForTimeout(4000);
const thumbs = await page.locator(".C_VID_LIBRARY .VID_THUMB img").count();
check(thumbs >= 5, `pictures made for the visible rows: ${thumbs}`);
const bad = await page.locator(".C_VID_LIBRARY .VID_BAD").count();
check(bad === 1, `the broken file is said to be unplayable: ${bad}`);
await shot("05-all");

/*  The name opens the card; Escape closes it. */
await page.click(".C_VID_LIBRARY .VID_ROW .VID_NAME >> nth=0");
await page.waitForTimeout(400);
check(await page.locator(".VID_CARD").count() === 1, "the name opens the card");
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
check(await page.locator(".VID_CARD").count() === 0, "Escape closes it");

/*  Search. */
await page.fill(".VID_SEARCH", "arriv");
await page.waitForTimeout(400);
const found = await page.locator(".C_VID_LIBRARY .VID_ROW .VID_NAME").allTextContents();
check(found.length === 1 && found[0] === "Arrival", `search "arriv": ${found.join("|")}`);
await page.fill(".VID_SEARCH", "");

/*  The deck: play the Pilot, with its Spanish subtitles. */
await route(page, "#/player", 900);
const pilot = page.locator(".VID_QROW", {hasText: "Pilot"});
await pilot.locator(".VID_THUMBBTN").click();
await page.waitForTimeout(2500);
const st = await page.evaluate(() => {
    const v = document.querySelector(".VID_STAGE video");
    return v ? {t: v.currentTime, paused: v.paused, w: v.videoWidth,
                tracks: v.textTracks.length,
                showing: [...v.textTracks].filter((x) => x.mode === "showing").length} : null;
});
check(!!st, "the video element is docked in the stage");
check(st && !st.paused && st.t > 0.5, `it is playing: t=${st && st.t.toFixed(2)}`);
check(st && st.w === 320, `a picture is decoded: ${st && st.w}px`);
check(st && st.tracks === 1, `one subtitle track loaded: ${st && st.tracks}`);
const subs_ui = await page.locator(".VID_SUBS:not(.is-hidden)").count();
check(subs_ui === 1, "the subtitles selector is offered");
await page.selectOption(".VID_SUBS_SEL", "0");
await page.waitForTimeout(600);
const cue = await page.evaluate(() => {
    const v = document.querySelector(".VID_STAGE video");
    const tr = v.textTracks[0];
    return {mode: tr.mode, cues: tr.cues ? tr.cues.length : 0,
            active: tr.activeCues && tr.activeCues.length ? tr.activeCues[0].text : ""};
});
check(cue.mode === "showing" && cue.cues === 2, `subtitles showing, 2 cues: ${JSON.stringify(cue)}`);
check(cue.active === "Hola, ¿qué tal?", `the cue on screen, accents intact: "${cue.active}"`);
await shot("06-playing");

/*  Leaving the player: the video moves to the strip and goes on. */
const t0 = await page.evaluate(() => document.querySelector("video.VID_VIDEO").currentTime);
await route(page, "#/library", 1500);
const strip = await page.evaluate(() => {
    const v = document.querySelector("video.VID_VIDEO");
    return {in_strip: !!v.closest(".VID_STRIP_BOX"), paused: v.paused, t: v.currentTime};
});
check(strip.in_strip, "the video moved into the strip");
check(!strip.paused && strip.t > t0, `and went on playing: ${t0.toFixed(1)} → ${strip.t.toFixed(1)}`);
await shot("07-strip");
await route(page, "#/player", 900);

/*  Edit the queue and save it as a list. */
await page.click(".VID_QROW >> nth=6 >> .VID_REMOVE");
await page.waitForTimeout(300);
check(await page.locator(".VID_QROW").count() === 6, "a row taken out of the queue");
await page.click(".VID_QSAVE");
await page.fill(".VID_SAVENAME", "Para el finde");
await page.click(".VID_SAVE_YES");
await page.waitForTimeout(500);
const origin = await page.locator(".VID_ORIGIN").textContent();
check(origin.includes("Para el finde"), `the deck says it is the saved list: "${origin}"`);
check(await page.locator(".VID_QSAVE[disabled]").count() === 1, "save is off while the list is untouched");

/*  Reload: the deck, the list and the video come back. */
await page.evaluate(() => document.querySelector("video.VID_VIDEO").pause());
await page.waitForTimeout(800);
await page.reload({waitUntil: "networkidle"});
await page.waitForTimeout(2500);
const after = await page.locator(".VID_QROW").count();
check(after === 6, `after a reload the deck has its 6 rows: ${after}`);
const origin2 = await page.locator(".VID_ORIGIN").textContent();
check(origin2.includes("Para el finde"), `and is still the saved list: "${origin2}"`);
await route(page, "#/lists", 900);
const lists = await page.locator(".VID_LISTROW .VID_NAME").allTextContents();
check(lists.includes("Para el finde"), `the list is in Lists: ${lists.join("|")}`);
await shot("08-lists");

/*  Arabic mirrors the layout. */
await page.click('[data-toolbar-item-id="language"]');
await page.waitForTimeout(300);
await page.click(".yui-toolbar-dropdown-panel >> text=العربية");
await page.waitForTimeout(600);
const dir = await page.evaluate(() => document.documentElement.getAttribute("dir"));
check(dir === "rtl", `Arabic writes dir=rtl: ${dir}`);
await shot("09-arabic");

const errs = report(page);
await browser.close();
console.log(failures ? `>>> ${failures} checks failed` : "all checks passed");
process.exit(failures || errs ? 1 : 0);
