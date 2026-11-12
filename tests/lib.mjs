/***********************************************************************
 *          lib.mjs
 *
 *      What every test in this directory needs: a browser, a booted
 *      app, a way to hand it videos, and the two colour maths functions.
 *
 *      Playwright drives a real Chromium (`CHROME` below: the system's
 *      Chrome when there is one, Playwright's own build otherwise). The
 *      fixtures are WebM, which both of them decode.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {chromium} from "playwright";
import {mkdirSync, existsSync} from "fs";
import {dirname, join} from "path";
import {fileURLToPath} from "url";

const HERE = dirname(fileURLToPath(import.meta.url));

const CHROME = process.env.CHROME_PATH ||
    (existsSync("/usr/bin/google-chrome") ? "/usr/bin/google-chrome" : "/opt/pw-browsers/chromium");
const BASE   = process.env.YUNOVIDEO_URL || "http://localhost:4322/";
const OUT    = join(HERE, "out");

mkdirSync(OUT, {recursive: true});


function launch()
{
    return chromium.launch({executablePath: CHROME});
}


/***************************************************************
 *  A page with its console wired to an array. Every test ends
 *  by printing that array: a run that "passes" while the
 *  console fills with errors has not passed.
 ***************************************************************/
async function new_page(browser, opts = {})
{
    let ctx = await browser.newContext({
        viewport: opts.viewport || {width: 1280, height: 900},
        isMobile: opts.mobile || undefined,
        hasTouch: opts.mobile || undefined,
        locale:   opts.locale || "es-ES"
    });
    let page = await ctx.newPage();

    let errors = [];
    page.on("pageerror", (e) => errors.push("PAGEERROR: " + (e && e.message)));
    page.on("console", (m) => { if(m.type() === "error") { errors.push(m.text()); } });

    /*  Most tests want the loose-files path, which is what every
        non-Chromium engine gets anyway; hiding the directory picker is
        how you reach it from Chrome. */
    if(opts.no_fsa !== false) {
        await page.addInitScript(() => { delete window.showDirectoryPicker; });
    }
    if(opts.init) {
        await page.addInitScript(opts.init);
    }

    page.errors = errors;
    return page;
}


/*  Goto + dismiss the welcome dialog, ticking "do not show again" so it
    does not reappear after the reload some tests do. */
async function boot(page)
{
    await page.goto(BASE, {waitUntil: "networkidle"});
    await page.waitForTimeout(1100);
    if(await page.locator(".VID_ABOUT_CLOSE").count()) {
        await page.check(".VID_ABOUT_DONTSHOW");
        await page.click(".VID_ABOUT_CLOSE");
    }
    return page;
}


async function route(page, hash, wait = 700)
{
    await page.evaluate((h) => { location.hash = h; }, hash);
    await page.waitForTimeout(wait);
}


/***************************************************************
 *  Hand the app videos. The pickers live in Sources and nowhere
 *  else — that is deliberate, and a test that finds them
 *  elsewhere is reporting a regression, not a broken test.
 *
 *      which 1 = add folder, 2 = add files
 ***************************************************************/
async function add_source(page, files, which = 1, settle = 3000)
{
    await route(page, "#/sources", 600);
    /*  Chrome will not open a file dialog in a window under 400x300:
        it fires `cancel` on the input and says so on the console, and
        setFiles then waits for an `input` event that never comes. A
        phone-sized test widens the window for the pick only. */
    const vp = page.viewportSize();
    const small = vp && (vp.width < 400 || vp.height < 300);
    if(small) {
        await page.setViewportSize({width: Math.max(vp.width, 400), height: Math.max(vp.height, 300)});
    }
    const [chooser] = await Promise.all([
        page.waitForEvent("filechooser"),
        page.click(which === 1 ? ".VID_ADDDIR" : ".VID_ADDFILES")
    ]);
    await chooser.setFiles(files);
    if(small) {
        await page.setViewportSize(vp);
    }
    await page.waitForTimeout(settle);
}


/*  Put the first source on the deck. Adding a source does not cue it
    (the user decides what goes to the player), so a test that wants a
    deck asks for one, the way a user would: Sources' "add to queue".
    The settle outlasts the deck's save (1.5 s after the last change,
    save_deck_soon in c_yunovideo.js), so a reload right after it finds
    the deck on disk. */
async function cue_source(page, settle = 2000)
{
    await route(page, "#/sources", 600);
    await page.click(".VID_SRCROW .VID_ADDSRC");
    await page.waitForTimeout(settle);
}


/*  WCAG relative luminance and contrast ratio, over whatever
    getComputedStyle hands back. */
function lum(css)
{
    let m = css.match(/[\d.]+/g).map(Number);
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]);
}

function contrast(a, b)
{
    let l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}


/***************************************************************
 *  Palette and theme must be driven through the app's OWN
 *  controls.
 *
 *  Setting data-theme / data-palette from the test instead
 *  returns a style the browser has not recalculated: light and
 *  dark come back identical, which is impossible, and the test
 *  passes while the app is broken. This cost an afternoon.
 ***************************************************************/
async function set_theme(page, want)
{
    for(let i = 0; i < 3; i++) {
        let cur = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
        if(cur === want) {
            return;
        }
        await page.click('[data-toolbar-item-id="theme"]');
        await page.waitForTimeout(400);
    }
}

async function set_palette(page, label)
{
    await page.click('[data-toolbar-item-id="palette"]');
    await page.waitForTimeout(400);
    await page.click(`.yui-toolbar-dropdown-panel >> text=${label}`);
    await page.waitForTimeout(600);
}


/*  Every test ends the same way, so the runner can grep one line. */
function report(page)
{
    let errors = page.errors || [];
    console.log("=== ERRORS (" + errors.length + ") ===");
    errors.slice(0, 6).forEach((e) => console.log("  " + e));
    return errors.length;
}


export {
    BASE, OUT, CHROME,
    launch, new_page, boot, route, add_source, cue_source,
    lum, contrast, set_theme, set_palette, report,
};
