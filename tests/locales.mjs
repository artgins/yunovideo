/***********************************************************************
 *          locales.mjs
 *
 *      The ten catalogues, read in node. validate-locales (prebuild)
 *      checks that they carry the same keys with the right plural
 *      forms; this checks what it does not:
 *
 *        - no value is empty;
 *        - every {{placeholder}} of the English text is in every
 *          translation ({{count}} excepted: a plural form may name its
 *          number rather than print it);
 *        - a non-English value equal to its key is a translation nobody
 *          wrote — except where the key IS the text in every language.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
const LANGS = ["en", "es", "zh", "hi", "ar", "pt", "ru", "ja", "de", "fr"];
const SAME_EVERYWHERE = new Set(["{{name}}, {{n}}", "i18n", "gclass", "ok"]);

const cat = {};
for(const l of LANGS) {
    const m = await import(`../src/locales/${l}.js`);
    cat[l] = m[l].translation;
}

const ph = (s) => (String(s).match(/\{\{\s*([a-z_]+)\s*\}\}/g) || [])
    .map((x) => x.replace(/[{}\s]/g, "")).filter((x) => x !== "count").sort().join(",");

let bad = 0;
const en = cat.en;
for(const l of LANGS) {
    for(const [k, v] of Object.entries(cat[l])) {
        const base = k.replace(/_(zero|one|two|few|many|other)$/, "");
        const ref = en[k] !== undefined ? en[k] : (en[base + "_other"] !== undefined ? en[base + "_other"] : en[base]);
        if(!String(v).trim()) {
            console.log(`FAIL  ${l}: "${k}" is empty`);
            bad++;
        }
        if(ref !== undefined && ph(ref) !== ph(v)) {
            console.log(`FAIL  ${l}: "${k}" placeholders {${ph(v)}} ≠ English {${ph(ref)}}`);
            bad++;
        }
        if(l !== "en" && v === k && !SAME_EVERYWHERE.has(k)) {
            console.log(`FAIL  ${l}: "${k}" is still its key`);
            bad++;
        }
    }
}
console.log(bad ? `>>> ${bad} problems` : `ok    ${LANGS.length} catalogues, ${Object.keys(en).length} keys`);
console.log("=== ERRORS (0) ===");
process.exit(bad ? 1 : 0);
