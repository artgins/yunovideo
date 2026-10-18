/***********************************************************************
 *          focus.mjs
 *
 *      While a video plays the stats move every few seconds (a view
 *      counted, the place written). Each of those used to rebuild the
 *      screens that show them: the name of a list being typed lost the
 *      focus (on a phone the keyboard closed under the finger), so did
 *      a row's button and the card's, the library rebuilt itself while
 *      hidden, and its scroll went back to the top. The focus stays,
 *      the text with it, and a hidden screen draws nothing.
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
await page.click(".VID_QLINE .button >> text=Cancel");

/*  Hidden, the library draws nothing: the rows it had are the rows it
    has, however long the film plays on another screen. */
await route(page, "#/library", 700);
await page.click('.VID_CHIP[data-view="all"]');
await page.waitForTimeout(400);
await page.evaluate(() => {
    window.__row = document.querySelector(".C_VID_LIBRARY .VID_ROW[data-uid]");
});
await route(page, "#/player", 700);
await page.waitForTimeout(11000);
const kept = await page.evaluate(() => !!window.__row && window.__row.isConnected);
check(kept, "the library, hidden, did not rebuild while a video played");

/*  On screen, a row's button keeps the focus while the numbers move. */
await route(page, "#/library", 700);
await page.evaluate(() => {
    const b = document.querySelectorAll(".C_VID_LIBRARY .VID_ROW[data-uid] .VID_ADDQ")[2];
    b.focus();
    window.__btn = b;
});
let lost_row = null;
for(let i = 0; i < 12; i++) {
    await page.waitForTimeout(1000);
    const ok = await page.evaluate(() => document.activeElement === window.__btn && window.__btn.isConnected);
    if(!ok && !lost_row) {
        lost_row = i + 1;
    }
}
check(!lost_row, lost_row ? `a library row's button lost the focus after ${lost_row} s`
                          : "a library row's button kept the focus for 12 s");

/*  The card: a heart given leaves the focus on the heart, and the
    numbers moving after that do not take it away. */
await route(page, "#/player", 700);
await page.click(".VID_DECKTITLE");
await page.waitForTimeout(400);
await page.focus('.VID_CARD [data-act="heart"]');
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
const hearts = await page.textContent(".VID_CARD_NUM:nth-child(3) b");
let lost_card = null;
for(let i = 0; i < 12; i++) {
    const ok = await page.evaluate(() => {
        const a = document.activeElement;
        return !!a && a.getAttribute("data-act") === "heart";
    });
    if(!ok && !lost_card) {
        lost_card = i;
    }
    await page.waitForTimeout(1000);
}
const noun = await page.textContent(".VID_CARD_NUM:nth-child(3) span");
check(hearts === "1" && noun === "Heart", `the heart was counted on the card, in the singular: ${hearts} ${noun}`);
check(lost_card === null, lost_card === null ? "the card's heart button kept the focus, 12 s"
                                             : `the card's heart button lost the focus after ${lost_card} s`);
await page.keyboard.press("Escape");
await page.waitForTimeout(300);

/*  The scroll of a list survives a trip to the player. */
const small = await new_page(browser, {locale: "en-US", viewport: {width: 1280, height: 380}});
await boot(small);
await add_source(small, [FIX.root], 1, 2500);
await route(small, "#/library", 700);
await small.click('.VID_CHIP[data-view="all"]');
await small.waitForTimeout(400);
await small.evaluate(() => {
    document.querySelector("video.VID_VIDEO").loop = true;
});
await small.click(".C_VID_LIBRARY .VID_ROW[data-uid] >> nth=1 >> .VID_THUMBBTN");
await small.waitForTimeout(500);
const top = await small.evaluate(() => {
    const $l = document.querySelector(".C_VID_LIBRARY .VID_LIBLIST");
    $l.scrollTop = 120;
    return $l.scrollTop;
});
/*  Away while the video plays and the numbers move. */
await route(small, "#/player", 700);
await small.waitForTimeout(11000);
await route(small, "#/library", 700);
const back = await small.evaluate(() => document.querySelector(".C_VID_LIBRARY .VID_LIBLIST").scrollTop);
check(top > 0 && back === top, `the library's scroll came back: ${top} → ${back}`);
const small_errs = report(small);

const errs = report(page) + small_errs;
await browser.close();
process.exit(failures || errs ? 1 : 0);
