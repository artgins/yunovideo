/***********************************************************************
 *          trace.mjs
 *
 *      What happens outside the machine is not a blind spot. With the
 *      root's `stores` level on — switched from the developer sheet, as
 *      a user would — a call into a store, a channel it emits and what
 *      the video element says are lines of the trace; off, none are.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {ensure_fixtures} from "./fixtures.mjs";
import {launch, new_page, boot, route, add_source, report} from "./lib.mjs";

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
const lines = [];
page.on("console", (m) => {
    if(m.text().indexOf("🗄") >= 0) {
        lines.push(m.text());
    }
});
await boot(page);
await add_source(page, [FIX.root], 1, 2500);
check(lines.length === 0, `off, the stores write nothing: ${lines.length} lines`);

async function chip(level)
{
    await page.click('[data-toolbar-item-id="more"]');
    await page.waitForTimeout(300);
    await page.click(".yui-toolbar-dropdown-panel >> text=Developer");
    await page.waitForTimeout(500);
    await page.click('.VID_DEV_TAB[data-pane="traces"]');
    await page.waitForTimeout(300);
    await page.click(`.VID_DEV_CHIP[data-level="${level}"]`);
    await page.waitForTimeout(200);
    const on = await page.getAttribute(`.VID_DEV_CHIP[data-level="${level}"]`, "aria-pressed");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    return on;
}

const on = await chip("stores");
check(on === "true", "the chip says the level is on");

await route(page, "#/player", 800);
lines.length = 0;
await page.click(".VID_QROW >> nth=1 >> .VID_THUMBBTN");
await page.waitForTimeout(2500);
const has = (re) => lines.some((l) => re.test(l));
check(has(/video_store: queue_play_at\(\)/), "a call into a store is traced");
check(has(/video_store: emit playing/), "a channel it emits is traced");
check(has(/video_store: element (play|loadedmetadata|canplay)/), "what the video element says is traced");
check(!has(/emit time|element timeupdate/), "and the clock stays out of it (its own level)");

/*  Kept across a reload: the yuno persists the level. */
await page.reload({waitUntil: "networkidle"});
await page.waitForTimeout(1500);
lines.length = 0;
await route(page, "#/player", 800);
await page.click(".VID_QROW >> nth=1 >> .VID_THUMBBTN");
await page.waitForTimeout(1500);
check(lines.length > 0, `the level survives a reload: ${lines.length} lines`);

const off = await chip("stores");
lines.length = 0;
await page.click(".VID_TPLAY");
await page.waitForTimeout(800);
check(off === "false" && lines.length === 0, `switched off, silent again: ${lines.length} lines`);

const errs = report(page);
await browser.close();
process.exit(failures || errs ? 1 : 0);
