/***********************************************************************
 *          plural.js
 *
 *      A count and the noun that goes with it.
 *
 *      In yunomúsica these were two nodes with the noun frozen in its
 *      plural form, on
 *      the reasoning that keeping them apart stopped "plural rules from
 *      leaking into a composed string". It did not avoid the plural. It
 *      made it wrong, everywhere, in every language that inflects:
 *      "1 pistas", "1 álbumes", "1 entradas", "1 carpetas dentro" — on
 *      the source rows, the album cards, the folder tree, the saved
 *      lists and the dialog that asks before it replaces the deck.
 *
 *      i18next resolves the CLDR category for the language in force, so
 *      the catalogues carry every form their own language actually has
 *      — six for Arabic, four for Russian, two for Spanish and German,
 *      one for Japanese — and no code here knows anything about any of
 *      it. A missing category does NOT fall back to another one in the
 *      same language: it falls through to English, or to the bare key.
 *      So every category a language declares has to be present, even
 *      where two of them carry the same word.
 *
 *      The noun node deliberately carries NO `i18n` attribute.
 *      refresh_language cannot pass a count, so re-translating one of
 *      these in place would look the key up without it and paint the
 *      bare key on the screen. The views that show counts re-render on
 *      a language change instead — which is what the runtime's own
 *      documentation prescribes for anything refresh_language cannot
 *      reach.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {t} from "i18next";


/*  The figure and its noun, as the pair of spans every count in this
    app is drawn with — the figure stays its own node so a stylesheet
    can still give it tabular numerals or an accent. `cls` lands on
    both, for the callers that tint a whole count. */
function count_pair(n, key, cls)
{
    /*  An attrs object each. Handing the same one to two elements makes
        them share whatever the builder writes into it. */
    return [
        ["span", cls ? {class: cls} : {}, String(n)],
        ["span", cls ? {class: cls} : {}, t(key, {count: n})]
    ];
}


/*  Just the noun, for a caller that draws its own figure — or for one
    that has no figure to draw and is naming a single thing. */
function count_noun(key, n)
{
    return t(key, {count: n});
}


export {count_pair, count_noun};
