/***********************************************************************
 *          vite.config.js
 *
 *      Build config for yunovídeo.
 *
 *      @yuneta/gobj-js and @yuneta/gobj-ui come from the npm registry as
 *      ordinary versioned dependencies — no path alias, no `file:` link to
 *      a sibling checkout. gobj-ui publishes its `src/` and exports
 *      "./src/*", so the sub-path imports (/src/*.js, /src/*.css) resolve
 *      straight out of node_modules.
 *
 *      The build emits ./dist, which deploy_yunovideo.sh rsyncs to the
 *      static host (wattyzer, /yuneta/gui/yunovideo.com). No backend: a pure gobj tree with hash routing.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import { defineConfig } from "vite";
import { readFileSync, readdirSync } from "fs";
import {yunetaLicensesPlugin} from "@yuneta/gobj-ui/vite-plugin-yuneta-licenses.js";

/*  The version, and the moment this bundle was built, baked in as
    constants. Both are shown in the help dialog and in the Sources
    diagnostics, so "am I looking at the latest one?" is a question the
    app answers itself instead of one settled by clearing caches. */
const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));
const stamp = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";

/*  The same two constants, emitted as a tiny file the running app can
    fetch to find out whether it is still the current build. Without it a
    long-lived tab never learns that a deploy happened: this is a hash-
    routed SPA, so moving between screens reloads nothing. */
const version_file = {
    name: "yunovideo-version-file",
    generateBundle() {
        this.emitFile({
            type: "asset",
            fileName: "version.json",
            source: JSON.stringify({version: pkg.version, stamp: stamp}) + "\n",
        });
    },
};

/*  The service worker, without which "offline" was only ever half true.
 *
 *  The app never uploads anything, which is half of what the word says —
 *  but with no worker, LAUNCHING it is a plain request for index.html and
 *  the bundle. On a plane that is a blank screen, and the films sitting on
 *  the device cannot be reached by an app that will not open (yunomúsica
 *  learned this first). So the shell is precached at install time.
 *
 *  The list cannot be written by hand: the JS and the CSS carry a
 *  content hash. It is taken from the bundle Rollup just produced, plus
 *  whatever `public/` contributed (Vite copies those, so they never
 *  appear in `bundle`). version.json is excluded on purpose — see the
 *  worker itself. */
const service_worker = {
    name: "yunovideo-service-worker",
    generateBundle(options, bundle) {
        const hashed = Object.keys(bundle)
            .filter((f) => f !== "version.json" && f !== "index.html")
            .map((f) => "./" + f);

        /*  index.html is listed by hand: Vite emits it from its own
            generateBundle hook, so depending on plugin order it may not
            be in `bundle` yet when we look. It is always there in the
            output, and it is the one file the boot cannot do without. */
        const core = ["./index.html"].concat(hashed);

        const extra = readdirSync(new URL("./public", import.meta.url))
            .map((f) => "./" + f);

        const src = readFileSync(new URL("./sw_template.js", import.meta.url), "utf8")
            .replace("__CACHE_NAME__", "yunovideo-" + pkg.version + "-" + stamp)
            .replace("__CORE__", JSON.stringify(core, null, 4))
            .replace("__EXTRA__", JSON.stringify(extra, null, 4));

        this.emitFile({type: "asset", fileName: "sw.js", source: src});
    },
};

export default defineConfig({
    plugins: [version_file, service_worker, yunetaLicensesPlugin()],
    define: {
        __APP_VERSION__: JSON.stringify(pkg.version),
        __BUILD_STAMP__: JSON.stringify(stamp),
    },
    /*  Hosted from the domain root (/yuneta/gui/yunovideo.com on wattyzer). */
    base: "./",
    resolve: {
        /*
         *  Should a version skew ever give gobj-ui its own nested copy of
         *  a shared lib, a view would bind a second, uninitialised
         *  instance (i18next's module-level t() then renders blank). This
         *  app only uses i18next; keep it deduped.
         */
        dedupe: [
            "i18next",
        ],
    },
    build: {
        outDir: "dist",
        emptyOutDir: true,
        /*  One bundle on purpose: the shell is precached whole for the
            plane, and the only lazy chunk is the developer sheet's traces
            panel. Vite's default of 500 kB warned on every build, so the
            warning was read by nobody; this is today's size (~540 kB) with
            room, and it speaks again if the bundle grows by a third. */
        chunkSizeWarningLimit: 700,
    },
    server: {
        watch: {
            usePolling: true,
            interval: 300,
        },
    },
});
