/***********************************************************************
 *          run.mjs
 *
 *      Runs the suite against the built bundle and prints one line per
 *      test.
 *
 *      Against `dist/`, not the dev server, on purpose: half of what is
 *      under test here is what the build produces — the version stamp,
 *      the manifest, the bundled locales.
 *
 *      Serial, not parallel. Each test drives a real Chrome through
 *      real timeouts, and the failures that matter in this app are
 *      timing-shaped; five browsers competing for the same cores turn a
 *      regression into a flake.
 *
 *      Usage:
 *          npm test                # everything
 *          npm test -- select      # just the ones whose name matches
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {spawn, execFileSync} from "child_process";
import {existsSync} from "fs";
import {dirname, join} from "path";
import {fileURLToPath} from "url";
import {createConnection} from "net";

import {ensure_fixtures} from "./fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROJECT = join(HERE, "..");
const PORT = Number(new URL(process.env.YUNOVIDEO_URL || "http://localhost:4322/").port || 80);

/*  Order matters only in that the cheap ones go first: a broken build
    should not cost three minutes to discover. */
const TESTS = [
    {name: "names",     what: "what a file name says: show, season, episode, year"},
    {name: "locales",   what: "ten catalogues: no gaps, no lost placeholders"},
    {name: "e2e",       what: "the walk: add, library, play, queue, subtitles, reload"},
    {name: "resume",    what: "every video comes back where it was left, after a kill"},
    {name: "templist",  what: "playing from the library leaves the queue alone"},
    {name: "names_dom", what: "no control without title and aria-label, two languages"},
    {name: "fitmobile", what: "nothing runs off a phone's width"},
    {name: "offline",   what: "no network: it boots and plays from the device"}
];


function port_open(port)
{
    return new Promise((resolve) => {
        /*  "localhost", not 127.0.0.1: vite preview binds ::1 only, so
            probing IPv4 reports the port free and we then fail to bind
            it ourselves. */
        const s = createConnection({host: "localhost", port});
        s.on("connect", () => { s.destroy(); resolve(true); });
        s.on("error", () => resolve(false));
        setTimeout(() => { s.destroy(); resolve(false); }, 1500);
    });
}

async function wait_for_port(port, ms)
{
    const until = Date.now() + ms;
    while(Date.now() < until) {
        if(await port_open(port)) {
            return true;
        }
        await new Promise((r) => setTimeout(r, 250));
    }
    return false;
}

function run(file)
{
    return new Promise((resolve) => {
        const p = spawn(process.execPath, [join(HERE, file)], {cwd: PROJECT});
        let out = "";
        p.stdout.on("data", (d) => { out += d; });
        p.stderr.on("data", (d) => { out += d; });
        p.on("close", (code) => resolve({code, out}));
    });
}


/*  ---- build, fixtures, server ---------------------------------- */

if(!existsSync(join(PROJECT, "dist", "index.html"))) {
    console.log("no dist/: building…");
    execFileSync("npm", ["run", "build"], {cwd: PROJECT, stdio: "inherit"});
}

const fix = ensure_fixtures();
if(fix.built.length) {
    console.log(`fixtures built: ${fix.built.join(", ")}`);
}

let server = null;
if(!(await port_open(PORT))) {
    console.log(`starting vite preview on :${PORT}…`);
    server = spawn("npx", ["vite", "preview", "--port", String(PORT)],
        {cwd: PROJECT, stdio: "ignore", detached: true});
    if(!(await wait_for_port(PORT, 20000))) {
        console.error(`>>> the server did not start on :${PORT}`);
        process.exit(2);
    }
} else {
    console.log(`using the server already listening on :${PORT}`);
}


/*  ---- run ------------------------------------------------------ */

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const chosen = only.length ? TESTS.filter((t) => only.some((o) => t.name.includes(o))) : TESTS;

const results = [];
for(const t of chosen) {
    process.stdout.write(`  ${t.name.padEnd(10)} ${t.what.padEnd(54)} `);
    const started = process.hrtime.bigint();
    const r = await run(`${t.name}.mjs`);
    const secs = Number(process.hrtime.bigint() - started) / 1e9;
    const errs = (r.out.match(/=== ERRORS \((\d+)\)/) || [])[1];
    results.push({...t, ...r, secs, errs});
    console.log(`${r.code === 0 ? "ok " : ">>>"} ${secs.toFixed(0)}s` +
                (errs && errs !== "0" ? `  (${errs} console errors)` : ""));
}

if(server) {
    try { process.kill(-server.pid); } catch(e) { /* already gone */ }
}

const failed = results.filter((r) => r.code !== 0);
if(failed.length) {
    for(const f of failed) {
        console.log(`\n########## ${f.name} ##########\n${f.out}`);
    }
}
console.log(failed.length
    ? `\n>>> ${failed.length} of ${results.length} fail: ${failed.map((f) => f.name).join(", ")}`
    : `\n${results.length} of ${results.length} pass`);

process.exit(failed.length ? 1 : 0);
