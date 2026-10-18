/***********************************************************************
 *          focus.mjs
 *
 *      Typing the name of a list while a video plays. The stats move
 *      every few seconds then (a view counted, the place written), and
 *      a queue rebuilt for each of them took the focus out of the name
 *      box: on a phone the keyboard closed under the finger. The focus
 *      must stay where it is, and the text with it.
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
await route(page, "#/player", 800);

/*  The fixtures last six seconds: looped, one plays past a view and a
    written place while the name is being typed. */
await page.evaluate(() => {
    document.querySelector("video.VID_VIDEO").loop = true;
});
await page.click(".VID_QROW >> nth=1 >> .VID_THUMBBTN");
await page.waitForTimeout(800);
await page.click(".VID_QSAVE");
await page.waitForTimeout(300);
await page.keyboard.type("my list");

let lost = null;
let played = 0;
for(let i = 0; i < 12; i++) {
    await page.waitForTimeout(1000);
    const s = await page.evaluate(() => {
        const a = document.activeElement;
        const v = document.querySelector("video.VID_VIDEO");
        return {focused: !!a && a.classList.contains("VID_SAVENAME"), t: v.currentTime,
                paused: v.paused};
    });
    if(!s.paused) {
        played++;
    }
    if(!s.focused && !lost) {
        lost = i + 1;
    }
}
check(played >= 10, `a video played the whole time: ${played} of 12 s`);
check(!lost, lost ? `the name box lost the focus after ${lost} s` : "the name box kept the focus for 12 s");

await page.keyboard.type(" two");
const name = await page.inputValue(".VID_SAVENAME");
check(name === "my list two", `and the typing went on in it: "${name}"`);

const errs = report(page);
await browser.close();
process.exit(failures || errs ? 1 : 0);
