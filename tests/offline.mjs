/***********************************************************************
 *          offline.mjs
 *
 *      Offline has to mean the plane. Visit once with the network, so
 *      the service worker stores the shell; cut the network; reload.
 *      The app must come up — and still PLAY a video from the device,
 *      because painting its own shell while unable to reach the films
 *      would be no use at 30,000 feet.
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
await boot(page);
await add_source(page, [FIX.root], 1, 2500);
const ready = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return !!reg.active;
});
check(ready, "the service worker is active after the first visit");

await page.context().setOffline(true);
await page.reload({waitUntil: "domcontentloaded"});
await page.waitForTimeout(2500);
const up = await page.locator(".VID_ROOT .yui-shell .C_VID_SOURCES").count();
check(up === 1, "with no network, the app still comes up");
await route(page, "#/player", 800);
await page.click(".VID_QROW >> nth=1 >> .VID_THUMBBTN");
await page.waitForTimeout(2000);
const t = await page.evaluate(() => {
    const v = document.querySelector("video.VID_VIDEO");
    return {t: v.currentTime, paused: v.paused};
});
check(!t.paused && t.t > 0.5, `and plays a video from the device: t=${t.t.toFixed(2)}`);

const errs = report(page);
await browser.close();
process.exit(failures || errs ? 1 : 0);
