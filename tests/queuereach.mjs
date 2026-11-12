/***********************************************************************
 *          queuereach.mjs
 *
 *      The queue is always within reach, at 100% zoom. On a short
 *      window the picture and the transport take nearly all of the
 *      Player screen, and the queue, which scrolled only inside what
 *      was left, got a sliver: its rows could not be reached at all.
 *      At a phone in a desktop browser (440x643) and a laptop-tall
 *      wide window (1920x868), the last row of the queue has to be
 *      scrolled to, whole, inside the centre zone — above the icon-bar
 *      where there is one.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {ensure_fixtures} from "./fixtures.mjs";
import {OUT, launch, new_page, boot, route, add_source, cue_source, report} from "./lib.mjs";

const FIX = ensure_fixtures();
let failures = 0;
let errors = 0;

const browser = await launch();
for(const [w, h] of [[440, 643], [1920, 868]]) {
    const page = await new_page(browser, {viewport: {width: w, height: h}, locale: "es-ES"});
    await boot(page);
    await add_source(page, [FIX.root], 1, 2500);
    await cue_source(page);
    await route(page, "#/player", 800);

    const rows = await page.locator(".VID_QROW").count();
    /*  The way a user gets there: the wheel, over the queue. */
    await page.locator(".VID_QUEUEBOX").hover();
    for(let i = 0; i < 12; i++) {
        await page.mouse.wheel(0, 400);
        await page.waitForTimeout(80);
    }
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
        const zone = document.querySelector(".yui-zone-center").getBoundingClientRect();
        const all = document.querySelectorAll(".VID_QROW");
        const last = all[all.length - 1].getBoundingClientRect();
        const list = document.querySelector(".VID_QLIST").getBoundingClientRect();
        return {
            zone: [Math.round(zone.top), Math.round(zone.bottom)],
            last: [Math.round(last.top), Math.round(last.bottom)],
            list: Math.round(list.height)
        };
    });
    const ok = rows > 1 && r.last[0] >= r.zone[0] - 1 && r.last[1] <= r.zone[1] + 1;
    console.log((ok ? "ok    " : "FAIL  ") +
                `${w}x${h}: ${rows} rows, the last at ${r.last[0]}→${r.last[1]}, ` +
                `zone ${r.zone[0]}→${r.zone[1]}, list ${r.list}px tall`);
    failures += ok ? 0 : 1;
    await page.screenshot({path: `${OUT}/queuereach-${w}.png`});

    /*  And back up: the controls are still there to come back to. */
    await page.locator(".VID_DECKCARD").hover().catch(() => {});
    for(let i = 0; i < 12; i++) {
        await page.mouse.wheel(0, -400);
        await page.waitForTimeout(80);
    }
    await page.waitForTimeout(300);
    const top = await page.evaluate(() => {
        const zone = document.querySelector(".yui-zone-center").getBoundingClientRect();
        const b = document.querySelector(".VID_TRANSPORT, .VID_PLAYER").getBoundingClientRect();
        return b.bottom <= zone.bottom + 1;
    });
    console.log((top ? "ok    " : "FAIL  ") + `${w}x${h}: back at the top, the transport is in view`);
    failures += top ? 0 : 1;
    errors += report(page);
    await page.context().close();
}
await browser.close();
process.exit(failures || errors ? 1 : 0);
