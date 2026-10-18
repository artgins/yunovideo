/***********************************************************************
 *          dialogs.mjs
 *
 *      The dialogs and the questions answer through the machine. The
 *      replace question (a saved list played over a queue): Escape
 *      cancels, "Add to queue" appends, "Replace and play" replaces.
 *      "Empty the queue?" is a state: its yes empties, its no keeps.
 *      The help dialog closes with Escape.
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
const qn = () => page.locator(".VID_QROW").count();
const n0 = await qn();

/*  Save the queue as a list, then cut the queue to two rows. */
await page.click(".VID_QSAVE");
await page.fill(".VID_SAVENAME", "all of it");
await page.keyboard.press("Enter");
await page.waitForTimeout(400);
while(await qn() > 2) {
    await page.click(".VID_QROW >> nth=-1 >> .VID_REMOVE");
    await page.waitForTimeout(150);
}
check(await qn() === 2, `a queue of two, a saved list of ${n0}`);

async function play_list()
{
    await route(page, "#/lists", 700);
    await page.click('.VID_LISTROW .VID_PLAYLIST');
    await page.waitForTimeout(400);
    return page.locator(".VID_CONFIRM_CARD").count();
}

check(await play_list() === 1, "playing the list over a queue asks first");
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
await route(page, "#/player", 700);
check(await page.locator(".VID_CONFIRM_CARD").count() === 0 && await qn() === 2,
      "Escape cancels: the dialog goes, the queue stays");

await play_list();
await page.click(".VID_CONFIRM_APPEND");
await page.waitForTimeout(400);
await route(page, "#/player", 700);
check(await qn() === n0, `"Add to queue" appends what was not there: ${await qn()} rows`);

/*  Back to two, then replace. */
while(await qn() > 2) {
    await page.click(".VID_QROW >> nth=-1 >> .VID_REMOVE");
    await page.waitForTimeout(150);
}
await play_list();
await page.click(".VID_CONFIRM_REPLACE");
await page.waitForTimeout(600);
await route(page, "#/player", 700);
const origin = await page.textContent(".VID_ORIGIN_NAME").catch(() => "");
check(await qn() === n0 && origin === "all of it", `"Replace and play" puts the list on the deck: "${origin}"`);

/*  "Empty the queue?" — no, then yes. */
await page.click(".VID_QCLEAR");
await page.waitForTimeout(200);
check(await page.locator(".VID_QCLEAR_YES").count() === 1, "emptying the queue asks, in place");
await page.click(".VID_QCLEAR_NO");
await page.waitForTimeout(200);
check(await qn() === n0 && await page.locator(".VID_QCLEAR").count() === 1, "no: nothing emptied, the button is back");
await page.click(".VID_QCLEAR");
await page.waitForTimeout(200);
await page.click(".VID_QCLEAR_YES");
await page.waitForTimeout(300);
check(await qn() === 0, "yes: the queue is empty");

/*  The help dialog. */
await page.click('[data-toolbar-item-id="more"]');
await page.waitForTimeout(300);
await page.click(".yui-toolbar-dropdown-panel >> text=Help and credits");
await page.waitForTimeout(400);
check(await page.locator(".VID_ABOUT_CARD").count() === 1, "help opens");
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
check(await page.locator(".VID_ABOUT_CARD").count() === 0, "and Escape closes it");

const errs = report(page);
await browser.close();
process.exit(failures || errs ? 1 : 0);
