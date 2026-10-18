/***********************************************************************
 *          templist.mjs
 *
 *      Two lists, and only one of them is yours. Pressing play on a row
 *      of the library plays THAT list, from that row, and leaves the
 *      queue exactly as it was — same rows, same name, same place. The
 *      strip says what is playing is not the queue, and its "back to
 *      the queue" gives the queue back, playing only if it was.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {ensure_fixtures} from "./fixtures.mjs";
import {OUT, launch, new_page, boot, route, add_source, report} from "./lib.mjs";

const FIX = ensure_fixtures();
let failures = 0;
function check(ok, what)
{
    console.log((ok ? "ok    " : "FAIL  ") + what);
    if(!ok) {
        failures++;
    }
}

const browser = await launch();
const page = await new_page(browser, {locale: "en-US"});
await boot(page);
await add_source(page, [FIX.root], 1, 2500);

await route(page, "#/player", 800);
const before = await page.locator(".VID_QROW .VID_NAME").allTextContents();
const cued = await page.locator(".VID_DECKTITLE").textContent();

/*  Season 1 of the series, from its second episode. */
await route(page, "#/library", 800);
await page.click('.VID_CHIP[data-view="series"]');
await page.click(".VID_SHOWROW .VID_NAME");
await page.waitForTimeout(400);
await page.locator(".C_VID_LIBRARY .VID_ROW", {hasText: "S01E02"}).locator(".VID_THUMBBTN").click();
await page.waitForTimeout(1500);
const strip = await page.locator(".VID_STRIP.is-on.is-temp").count();
check(strip === 1, "the strip is up, and says it is not the queue");
const sub = await page.locator(".VID_STRIP_SUB").textContent();
check(/2 \/ 3/.test(sub), `it plays the list on screen, from that row: "${sub}"`);
const playing = await page.evaluate(() => !document.querySelector("video.VID_VIDEO").paused);
check(playing, "and it is playing");
await page.screenshot({path: `${OUT}/templist-strip.png`});

await route(page, "#/player", 800);
const during = await page.locator(".VID_QROW .VID_NAME").allTextContents();
check(JSON.stringify(during) === JSON.stringify(before), "the queue was not touched");
check(await page.locator(".VID_TEMPLINE").count() === 1, "the player says where this came from");

await page.click(".VID_TEMPLINE .VID_BACKDECK");
await page.waitForTimeout(1200);
const title = await page.locator(".VID_DECKTITLE").textContent();
check(title === cued, `back to the queue, on its own video: "${title}"`);
const paused = await page.evaluate(() => document.querySelector("video.VID_VIDEO").paused);
check(paused, "paused, because the queue was not playing before");
check(await page.locator(".VID_STRIP.is-temp").count() === 0, "the strip is no longer the temporary list's");

const errs = report(page);
await browser.close();
process.exit(failures || errs ? 1 : 0);
