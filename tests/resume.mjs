/***********************************************************************
 *          resume.mjs
 *
 *      Every video comes back where it was left — even when the app is
 *      killed rather than closed.
 *
 *      A phone's system reclaims a backgrounded app whenever it wants,
 *      and nothing fires on the way out. So the place has to be on disk
 *      BEFORE the death: it is written every ten seconds while a video
 *      plays. This plays a 40-second film for fourteen seconds, then
 *      opens the app in a SECOND page of the same browser without
 *      closing the first — no pagehide, no pause, nothing to write on —
 *      and checks the film is in "Continue watching" and starts again
 *      at the second it was left, saying so, with a way to start over.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {ensure_fixtures} from "./fixtures.mjs";
import {OUT, BASE, launch, new_page, boot, route, add_source, report} from "./lib.mjs";

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

/*  Arrival, from the library: the temporary list. */
await route(page, "#/library", 800);
await page.click('.VID_CHIP[data-view="all"]');
await page.waitForTimeout(300);
await page.locator(".C_VID_LIBRARY .VID_ROW", {hasText: "Arrival"}).locator(".VID_THUMBBTN").click();
await page.waitForTimeout(14000);
const t_kill = await page.evaluate(() => document.querySelector("video.VID_VIDEO").currentTime);
console.log(`played to ${t_kill.toFixed(1)} s, then a second page opens with the first still running`);

const page2 = await page.context().newPage();
const errors2 = [];
page2.on("pageerror", (e) => errors2.push("PAGEERROR: " + e.message));
page2.on("console", (m) => {
    if(m.type() === "error") {
        errors2.push(m.text());
    }
});
/*  What is ON DISK while the first page is still running and nothing
    has been paused or hidden: only the periodic write can have put it
    there. */
/*  The second copy of the app boots, which reads the stats and writes
    none of them. */
await page2.goto(BASE + "#/lists", {waitUntil: "networkidle"});
const on_disk = await page2.evaluate(() => new Promise((resolve) => {
    const req = indexedDB.open("yunovideo");
    req.onsuccess = () => {
        const tx = req.result.transaction("stats", "readonly");
        const all = tx.objectStore("stats").getAll();
        all.onsuccess = () => {
            const row = all.result.find((r) => r.key.indexOf("Arrival") >= 0);
            req.result.close();
            resolve(row ? row.pos : 0);
        };
    };
    req.onerror = () => resolve(-1);
}));
check(on_disk >= 10, `with the app still running, the place on disk is ${on_disk} s`);
const t_close = await page.evaluate(() => document.querySelector("video.VID_VIDEO").currentTime);
await page.close({runBeforeUnload: false});
await page2.reload({waitUntil: "networkidle"});
await page2.waitForTimeout(2500);
const cont = await page2.locator(".C_VID_LISTS .VID_ROW .VID_NAME").first().textContent().catch(() => "");
check(cont === "Arrival", `"Continue watching" holds the film: "${cont}"`);
const bar = await page2.locator(".C_VID_LISTS .VID_WATCHED i").first().getAttribute("style").catch(() => "");
check(/width:\s*[1-9]/.test(bar || ""), `its row draws how much was watched: ${bar}`);

await page2.locator(".C_VID_LISTS .VID_ROW", {hasText: "Arrival"}).first().locator(".VID_THUMBBTN").click();
await page2.waitForTimeout(1500);
const back = await page2.evaluate(() => document.querySelector("video.VID_VIDEO").currentTime);
check(back >= 9 && back <= t_close + 2, `it starts again where it was left: ${back.toFixed(1)} s`);
await route(page2, "#/player", 800);
const said = await page2.locator(".VID_RESUMED").count();
check(said === 1, "the player says it resumed, and offers to start over");
await page2.screenshot({path: `${OUT}/resume.png`});
await page2.click(".VID_STARTOVER");
await page2.waitForTimeout(800);
const zero = await page2.evaluate(() => document.querySelector("video.VID_VIDEO").currentTime);
check(zero < 2, `start over goes to the start: ${zero.toFixed(1)} s`);

console.log("=== ERRORS (" + errors2.length + ") ===");
errors2.slice(0, 6).forEach((e) => console.log("  " + e));
await browser.close();
process.exit(failures || errors2.length ? 1 : 0);
