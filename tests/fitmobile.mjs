/***********************************************************************
 *          fitmobile.mjs
 *
 *      Nothing runs off the side of a phone. At 360 px, in the longest
 *      language and in Arabic, every screen with videos loaded and the
 *      strip up: no horizontal scroll, and no control of the app whose
 *      right edge is past the screen's.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {ensure_fixtures} from "./fixtures.mjs";
import {OUT, launch, new_page, boot, route, add_source, report} from "./lib.mjs";

const FIX = ensure_fixtures();
let failures = 0;
const W = 360;

const browser = await launch();
const page = await new_page(browser, {viewport: {width: W, height: 740}, mobile: true, locale: "de-DE"});
await boot(page);
await add_source(page, [FIX.root], 1, 2500);
await route(page, "#/player", 800);
await page.click(".VID_QROW >> nth=1 >> .VID_THUMBBTN");
await page.waitForTimeout(1000);

async function fits(where)
{
    const r = await page.evaluate((w) => {
        const out = [];
        const APP = '[class*="C_VID_"], .VID_STRIP, .VID_SCANBAR';
        for(const el of document.querySelectorAll("button, input, select, .VID_NAME, .VID_T1")) {
            if(!el.closest(APP)) {
                continue;
            }
            const b = el.getBoundingClientRect();
            if(!b.width || !b.height) {
                continue;
            }
            if(b.right > w + 1 || b.left < -1) {
                out.push(el.className + " " + Math.round(b.left) + "→" + Math.round(b.right));
            }
        }
        return {scroll: document.documentElement.scrollWidth, out: out};
    }, W);
    const ok = r.scroll <= W && !r.out.length;
    console.log((ok ? "ok    " : "FAIL  ") + `${where}: page ${r.scroll}px` +
                (r.out.length ? "\n        " + r.out.slice(0, 6).join("\n        ") : ""));
    failures += ok ? 0 : 1;
}

for(const lang of ["Deutsch", "العربية"]) {
    if(lang !== "Deutsch") {
        await page.click('[data-toolbar-item-id="language"]');
        await page.waitForTimeout(300);
        await page.click(`.yui-toolbar-dropdown-panel >> text=${lang}`);
        await page.waitForTimeout(600);
    }
    for(const r of ["#/player", "#/lists", "#/library", "#/sources"]) {
        await route(page, r, 800);
        await fits(`${lang} ${r}`);
        await page.screenshot({path: `${OUT}/fit-${lang === "Deutsch" ? "de" : "ar"}-${r.slice(2)}.png`});
    }
}

const errs = report(page);
await browser.close();
process.exit(failures || errs ? 1 : 0);
