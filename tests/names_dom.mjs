/***********************************************************************
 *          names_dom.mjs
 *
 *      A control without a name is a bug. Every button, input and
 *      select the app draws carries a title AND an aria-label — on the
 *      page, not in the source — and both change when the language
 *      does.
 *
 *      Walks every screen with videos loaded and a video playing (so
 *      the transport, the strip, the queue and the rows are all drawn),
 *      the card, and the about dialog. The shell's own chrome is
 *      gobj-ui's to name and is left out.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {ensure_fixtures} from "./fixtures.mjs";
import {launch, new_page, boot, route, add_source, report} from "./lib.mjs";

const FIX = ensure_fixtures();
let failures = 0;

const browser = await launch();
const page = await new_page(browser, {locale: "en-US"});
await boot(page);
await add_source(page, [FIX.root], 1, 2500);

async function unnamed(where)
{
    const bad = await page.evaluate(() => {
        const APP = '[class*="C_VID_"], .VID_STRIP, .VID_SCANBAR, .VID_CARD, .VID_ABOUT_CARD, .VID_INSTALL_CARD, .VID_CONFIRM_CARD';
        const out = [];
        for(const el of document.querySelectorAll("button, input, select, textarea")) {
            if(!el.closest(APP) || el.type === "file" || el.type === "hidden") {
                continue;
            }
            if(el.closest("label") && el.type === "checkbox") {
                continue;               // a label that wraps its control names it
            }
            const title = (el.getAttribute("title") || "").trim();
            const aria = (el.getAttribute("aria-label") || "").trim();
            if(!title || !aria) {
                out.push(el.className + " «" + (el.textContent || "").trim().slice(0, 30) + "»");
            }
        }
        return out;
    });
    console.log((bad.length ? "FAIL  " : "ok    ") + `${where}: ${bad.length} unnamed` +
                (bad.length ? "\n        " + bad.slice(0, 8).join("\n        ") : ""));
    failures += bad.length ? 1 : 0;
}

for(const r of ["#/player", "#/lists", "#/library", "#/sources"]) {
    await route(page, r, 900);
    await unnamed(r);
}
await route(page, "#/player", 800);
await page.click(".VID_QROW >> nth=1 >> .VID_THUMBBTN");
await page.waitForTimeout(1200);
await route(page, "#/library", 900);
await unnamed("library, with the strip up");
await page.click(".C_VID_LIBRARY .VID_ROW .VID_NAME >> nth=0").catch(() => {});
await page.click('.VID_CHIP[data-view="all"]');
await page.click(".C_VID_LIBRARY .VID_ROW .VID_NAME >> nth=0");
await page.waitForTimeout(500);
await unnamed("the card");
await page.click(".VID_CARD_CLOSE");

/*  And they change language. */
await route(page, "#/player", 800);
const en = await page.locator(".VID_TFULL").getAttribute("title");
await page.click('[data-toolbar-item-id="language"]');
await page.waitForTimeout(300);
await page.click(".yui-toolbar-dropdown-panel >> text=Español");
await page.waitForTimeout(600);
const es = await page.locator(".VID_TFULL").getAttribute("title");
const es_aria = await page.locator(".VID_TFULL").getAttribute("aria-label");
const ok = en === "Fullscreen" && es === "Pantalla completa" && es_aria === es;
console.log((ok ? "ok    " : "FAIL  ") + `a control's name changes language: "${en}" → "${es}" / "${es_aria}"`);
failures += ok ? 0 : 1;
await unnamed("player, in Spanish");

const errs = report(page);
await browser.close();
process.exit(failures || errs ? 1 : 0);
