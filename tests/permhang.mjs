/***********************************************************************
 *          permhang.mjs
 *
 *      A folder whose permission question gets no answer, or a wrong
 *      one, must still end on the "authorise" bar. Never on a silent
 *      app.
 *
 *      2026-11-21, on the phone: no folders in Sources, no "authorise"
 *      bar, and a Diagnostics panel that stayed empty, here and in
 *      yunomúsica (same sources code). Every await on the browser
 *      assumed an answer would come. A queryPermission() that never
 *      settles left the start-up waiting for ever, before the folders
 *      reached the screen, and the Diagnostics panel showed nothing
 *      until every one of its checks had answered.
 *
 *      Act 1: queryPermission() never settles. The bar must come up,
 *      the folder must still be in Sources with its videos, and
 *      Diagnostics must finish and name the call that did not answer.
 *      On that phone requestPermission did nothing either, so the bar
 *      offers "Choose again" (the folder picker), and choosing the same
 *      folder takes the bar away.
 *
 *      Act 2: queryPermission() says "granted", but reading through the
 *      handle fails with NotAllowedError. The first read (the restored
 *      video, or play) must bring up the bar, not leave a player that
 *      does nothing.
 *
 *      Act 3: "Choose again" from Sources, and the wrong folder chosen.
 *      Nothing changes, and Sources and the player say which folder to
 *      choose. Then the right one.
 *
 *      Act 4: "Add folder" with the folder that is waiting. It takes
 *      the place of the waiting one; nothing is added twice. In "hang"
 *      mode isSameEntry() and resolve() do not answer either, which is
 *      the comparison "Add folder" makes before it adds anything.
 *
 *      The handles are real (origin private file system); only the
 *      permission calls and the picker are replaced. Same test as
 *      yunomúsica's.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {readFileSync} from "fs";
import {join} from "path";

import {ensure_fixtures} from "./fixtures.mjs";
import {BASE, OUT, launch, new_page, route, cue_source, report} from "./lib.mjs";

const FIX = ensure_fixtures();

let failed = 0;
const check = (label, ok) => {
    if(!ok) { failed++; }
    console.log(`   ${ok ? "ok " : ">>>"} ${label}`);
};

/*  What the permission calls do, chosen per launch through
    sessionStorage["perm"]:
        (unset)  the browser's own answer
        "hang"   queryPermission(), isSameEntry() and resolve() never settle
        "liar"   queryPermission() says "granted", reads fail NotAllowedError
    requestPermission() always answers "granted" and puts the browser's
    own behaviour back, which is what a user's "Allow" does. */
function folder_init()
{
    const mode = () => sessionStorage.getItem("perm") || "";
    const real_query = FileSystemHandle.prototype.queryPermission;
    FileSystemHandle.prototype.queryPermission = function(...args) {
        if(mode() === "hang") {
            return new Promise(() => {});
        }
        if(mode() === "liar") {
            return Promise.resolve("granted");
        }
        return real_query.apply(this, args);
    };
    for(const [proto, name] of [[FileSystemHandle.prototype, "isSameEntry"],
                                [FileSystemDirectoryHandle.prototype, "resolve"]]) {
        const real = proto[name];
        proto[name] = function(...args) {
            return mode() === "hang" ? new Promise(() => {}) : real.apply(this, args);
        };
    }
    FileSystemHandle.prototype.requestPermission = async function() {
        sessionStorage.removeItem("perm");
        return "granted";
    };
    const guard = (proto, name) => {
        const real = proto[name];
        proto[name] = function(...args) {
            if(mode() === "liar") {
                let e = new Error("the user did not grant read access");
                e.name = "NotAllowedError";
                return Promise.reject(e);
            }
            return real.apply(this, args);
        };
    };
    guard(FileSystemDirectoryHandle.prototype, "getFileHandle");
    guard(FileSystemDirectoryHandle.prototype, "getDirectoryHandle");
    window.showDirectoryPicker = async function() {
        let root = await navigator.storage.getDirectory();
        return await root.getDirectoryHandle(window.__pick || "Mis vídeos", {create: true});
    };
}

const CLIPS = ["clip one.webm", "clip two.webm"].map((name) => [
    name,
    readFileSync(join(FIX.root, "clips", name)).toString("base64")
]);

const bar_of = (page) => page.locator(".VID_AUTHBAR.VID_PENDBAR");

async function source_rows(page)
{
    await route(page, "#/sources", 700);
    return page.evaluate(() =>
        [...document.querySelectorAll(".C_VID_SOURCES .VID_SRCROW")].map((r) => ({
            name:  r.querySelector(".VID_T1").textContent.trim(),
            count: Number((r.querySelector(".VID_T2").textContent.match(/\d+/) || [0])[0]),
        })));
}

/*  Open Diagnostics and wait for it to finish: done when it is no
    longer only "…". Returns its text, or "" if it never finished. */
async function diagnostics(page, ms)
{
    await route(page, "#/sources", 700);
    if(!(await page.evaluate(() => document.querySelector(".VID_DIAG").open))) {
        await page.click(".VID_DIAG_SUM");
    }
    const until = Date.now() + ms;
    while(Date.now() < until) {
        let txt = await page.evaluate(() => document.querySelector(".VID_DIAG_BODY").textContent);
        if(txt && !txt.trim().endsWith("…")) {
            return txt;
        }
        await page.waitForTimeout(250);
    }
    return "";
}

const loaded = (page) => page.evaluate(() => {
    const v = document.querySelector("video.VID_VIDEO");
    return !!v && !!v.currentSrc && v.readyState > 0;
});


const browser = await launch();
const page = await new_page(browser, {
    viewport: {width: 412, height: 915}, mobile: true,
    no_fsa: false, init: folder_init
});

await page.goto(BASE, {waitUntil: "networkidle"});
await page.waitForTimeout(1100);
if(await page.locator(".VID_ABOUT_CLOSE").count()) {
    await page.check(".VID_ABOUT_DONTSHOW");
    await page.click(".VID_ABOUT_CLOSE");
}

await page.evaluate(async (files) => {
    let root = await navigator.storage.getDirectory();
    let dir = await root.getDirectoryHandle("Mis vídeos", {create: true});
    for(const [name, b64] of files) {
        let fh = await dir.getFileHandle(name, {create: true});
        let w = await fh.createWritable();
        await w.write(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
        await w.close();
    }
}, CLIPS);

await route(page, "#/sources", 600);
await page.click(".VID_ADDDIR");
await page.waitForTimeout(3000);
await cue_source(page);
let rows = await source_rows(page);
console.log(`0. carpeta añadida: ${rows.map((r) => r.name + " " + r.count).join(", ")}`);


                    /***************************
                     *  Act 1: no answer at all
                     ***************************/
console.log("1. queryPermission() no contesta");
await page.evaluate(() => sessionStorage.setItem("perm", "hang"));
await page.reload({waitUntil: "networkidle"});
await route(page, "#/player", 600);
/*  The wait is bounded at 4 s; give it 4 s more. */
await page.waitForTimeout(8000);
await page.screenshot({path: `${OUT}/permhang-bar.png`, fullPage: true});
check("sale la barra de autorizar", await bar_of(page).count() > 0);

rows = await source_rows(page);
check(`la carpeta sigue en Fuentes con sus vídeos: ${rows.map((r) => r.name + " " + r.count).join(", ") || "ninguna"}`,
      rows.length === 1 && rows[0].count === 2);

let diag = await diagnostics(page, 15000);
check("Diagnóstico termina", diag.length > 0);
check("y dice qué llamada no contestó", /queryPermission.*no answer/i.test(diag));
console.log(diag.split("\n").filter((l) => /source|readable|handle/.test(l)).map((l) => "      " + l).join("\n"));

await route(page, "#/player", 600);
check("la barra ofrece elegir la carpeta otra vez", await bar_of(page).locator(".VID_REPICK").count() === 1);
if(await bar_of(page).count()) {
    await bar_of(page).locator(".VID_QBTN").click();
    await page.waitForTimeout(2500);
}
check("elegir la misma carpeta quita la barra", await bar_of(page).count() === 0);


                    /***************************
                     *  Act 2: "granted", but nothing reads
                     ***************************/
console.log("2. queryPermission() dice que sí, pero no deja leer");
await page.evaluate(() => sessionStorage.setItem("perm", "liar"));
await page.reload({waitUntil: "networkidle"});
await route(page, "#/player", 600);
await page.waitForTimeout(2500);
/*  The deck reads its video as soon as it is restored, so the refusal
    usually puts the folder on the bar before anything is pressed. If
    it has not, play is what reads it. */
const at_restore = await bar_of(page).count() > 0;
if(!at_restore) {
    await page.click(".VID_TPLAY");
    await page.waitForTimeout(2000);
}
await page.screenshot({path: `${OUT}/permhang-liar.png`, fullPage: true});
check(`al no poder leer, sale la barra (${at_restore ? "al restaurar el vídeo" : "al pulsar play"})`,
      await bar_of(page).count() > 0);

if(await bar_of(page).count()) {
    await bar_of(page).locator(".VID_QBTN").click();
    await page.waitForTimeout(2500);
}
check("autorizar quita la barra y carga el vídeo",
      await bar_of(page).count() === 0 && await loaded(page));



                    /***************************
                     *  Act 3: the wrong folder, then the right one
                     ***************************/
console.log("3. elegir otra vez desde Fuentes: primero la carpeta equivocada");
await page.evaluate(async () => {
    let root = await navigator.storage.getDirectory();
    await root.getDirectoryHandle("Otra", {create: true});
    sessionStorage.setItem("perm", "hang");
});
await page.reload({waitUntil: "networkidle"});
await page.waitForTimeout(6000);
await route(page, "#/sources", 700);
await page.evaluate(() => { window.__pick = "Otra"; });
await page.click(".C_VID_SOURCES .VID_SRCROW .VID_REPICK");
await page.waitForTimeout(1500);
const note = await page.evaluate(() => {
    const n = document.querySelector(".C_VID_SOURCES .VID_SRCNOTE");
    return n ? n.textContent.trim() : "";
});
check(`dice qué carpeta hay que elegir: “${note.slice(0, 70)}”`, note.includes("Otra") && note.includes("Mis vídeos"));
check("y la carpeta sigue esperando", await page.locator(".C_VID_SOURCES .VID_SRCROW .VID_REPICK").count() === 1);
rows = await source_rows(page);
check(`no se ha añadido ninguna carpeta: ${rows.map((r) => r.name).join(", ")}`, rows.length === 1);
await route(page, "#/player", 600);
check("el reproductor también lo dice", await page.locator(".VID_WRONGBAR").count() === 1);
await route(page, "#/sources", 700);

await page.evaluate(() => { window.__pick = "Mis vídeos"; });
await page.click(".C_VID_SOURCES .VID_SRCROW .VID_REPICK");
await page.waitForTimeout(2500);
check("con la buena, deja de esperar", await page.locator(".C_VID_SOURCES .VID_SRCROW .VID_REPICK").count() === 0);
await route(page, "#/player", 1500);
check("y el vídeo se carga", await loaded(page));


                    /***************************
                     *  Act 4: "Add folder" with the waiting folder
                     ***************************/
console.log("4. «Añadir carpeta» con la carpeta que espera");
await page.evaluate(() => sessionStorage.setItem("perm", "hang"));
await page.reload({waitUntil: "networkidle"});
await page.waitForTimeout(6000);
await route(page, "#/sources", 700);
check("la carpeta espera", await page.locator(".C_VID_SOURCES .VID_SRCROW .VID_REPICK").count() === 1);
await page.evaluate(() => { window.__pick = "Mis vídeos"; });
await page.click(".VID_ADDDIR");
/*  isSameEntry does not answer: 4 s, then the name decides. */
await page.waitForTimeout(7000);
rows = await source_rows(page);
check(`sigue habiendo una carpeta: ${rows.map((r) => r.name + " " + r.count).join(", ")}`,
      rows.length === 1 && rows[0].count === 2);
check("y ya no espera",
      await page.locator(".C_VID_SOURCES .VID_SRCROW .VID_REPICK, .C_VID_SOURCES .VID_SRCROW .VID_AUTH").count() === 0);
await route(page, "#/player", 1500);
check("y el vídeo se carga", await loaded(page));

const bad = report(page);
await browser.close();
process.exit((bad || failed) ? 1 : 0);
