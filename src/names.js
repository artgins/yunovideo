/***********************************************************************
 *          names.js
 *
 *      What a video file's NAME says about it.
 *
 *      A video carries no tags anybody fills in. What it has is a name,
 *      and the names people keep are surprisingly regular:
 *
 *          The.Expanse.S02E05.Home.1080p.WEB-DL.x264.mkv
 *          Doctor Who - 3x07 - 42.mp4
 *          Fargo/Season 1/04 - Eating the Blame.mkv
 *          Arrival (2016).mkv
 *          VID_20230812_181502.mp4
 *
 *      So this reads the name and the folders above it, and nothing
 *      else. It never opens the file: the library has to be built from
 *      a folder walk alone, because opening thousands of videos to learn
 *      their titles is the wait this app refuses to make anybody sit
 *      through.
 *
 *      What comes out is a guess and is shown as one: the file name is
 *      always on the video's card, next to whatever this made of it.
 *      Nothing here is ever stored as if it were the truth — the cache
 *      keeps the PATH, and the guess can be made again by a later build
 *      that guesses better.
 *
 *      Pure functions, no DOM, no state: tests/names.mjs runs them in
 *      node.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/


/***************************************************************
 *              Constants
 ***************************************************************/
/*  What a browser MIGHT play. Recognised by extension and, below, by
    MIME type — Android hands over files whose display name carries no
    usable extension. Whether this particular browser can decode one is
    a different question, answered the first time the video is read
    (thumbs.js), and said on its row. */
const VIDEO_RE = /\.(mp4|m4v|webm|mkv|mov|ogv|avi|wmv|flv|3gp|3g2|mpe?g|ts|m2ts|mts)$/i;

/*  Subtitles that sit beside a video. Only the two text formats: an
    .ass or a .sub is something a browser has no way to show. */
const SUB_RE = /\.(srt|vtt)$/i;

/*  The tail of a release name: everything from the first of these on
    is about the encoding, not about the film. */
const NOISE_RE = new RegExp(
    "\\b(" + [
        "2160p", "1440p", "1080p", "1080i", "720p", "576p", "480p", "4k", "uhd",
        "hdr10?\\+?", "dv", "sdr", "x264", "x265", "h ?26[45]", "hevc", "avc",
        "xvid", "divx", "av1", "vp9", "10 ?bit",
        "web(?:[- ]?dl|[- ]?rip)?", "bluray", "blu[- ]ray", "brrip", "bdrip",
        "dvdrip", "dvd(?:scr|r)?", "hdtv", "hdrip", "hd ?cam", "telesync",
        "aac(?:2 0)?", "ac3", "eac3", "dts(?:-hd)?", "ddp?5 1", "atmos", "truehd",
        "proper", "repack", "remux", "extended", "unrated", "internal",
        "multi", "dual", "subbed", "dubbed", "nf", "amzn", "dsnp", "hmax",
    ].join("|") + ")\\b.*$",
    "i"
);

const EPISODE_PATTERNS = [
    /*  S01E02, s1e2, S01.E02, S01 E02, S01E02E03 (the first one) */
    /\b[Ss](\d{1,2})[ ._-]?[Ee](\d{1,3})(?:[Ee-]\d{1,3})?\b/,
    /*  1x02, 01x02 */
    /\b(\d{1,2})[xX](\d{2,3})\b/,
    /*  Season 1 Episode 2, Temporada 1 Capitulo 2 */
    /\b(?:season|temporada|saison|staffel|stagione)[ ._-]*(\d{1,2})[ ._-]*(?:episode|episodio|cap[ií]tulo|cap|[ée]pisode|folge|ep)[ ._-]*(\d{1,3})\b/i,
];

/*  A folder that IS a season: "Season 1", "Temporada 02", "S03". */
const SEASON_DIR_RE = /^(?:season|temporada|saison|staffel|stagione|series|serie|s)[ ._-]*(\d{1,2})$/i;

/*  An episode named by number inside a season folder: "04 - Eating
    the Blame", "E04", "Episode 4", "Capítulo 4". */
const BARE_EPISODE_RE = /^(?:e|ep|episode|episodio|cap[ií]tulo|cap|[ée]pisode|folge)?[ ._-]*(\d{1,3})(?:[ ._-]+(.*))?$/i;

/*  Greedy on purpose: the LAST year is the release, the first may be
    part of the name ("Blade Runner 2049 (2017)"). */
const YEAR_RE = /^(.*)[ ._([-]+((?:19|20)\d{2})(?:[)\]]|\b)(.*)$/;


/***************************************************************
 *              Helpers
 ***************************************************************/
function strip_ext(name)
{
    const i = name.lastIndexOf(".");
    return i > 0 ? name.slice(0, i) : name;
}

function ext_of(name)
{
    const m = /\.([^./]{1,5})$/.exec(name || "");
    return m ? m[1].toLowerCase() : "";
}

/*  "The.Expanse_S02" → "The Expanse S02". Dots are only separators
    when the name has no spaces of its own: "Mr. Robot" keeps its dot,
    "Mr.Robot.S01E01" was never meant to have one. */
function spaced(s)
{
    let out = String(s || "").replace(/_+/g, " ");
    if(out.indexOf(" ") < 0 && (out.match(/\./g) || []).length >= 1) {
        out = out.replace(/\.+/g, " ");
    }
    return out.replace(/\s+/g, " ").trim();
}

/*  A leading "[Group]" is who ripped it, never what it is. */
function unbracket(s)
{
    return String(s || "").replace(/^\s*\[[^\]]*\]\s*/, "");
}

function trim_seps(s)
{
    return String(s || "")
        .replace(/^[\s._\-–—:·|]+/, "")
        .replace(/[\s._\-–—:·|([]+$/, "")
        .trim();
}

function denoise(s)
{
    return trim_seps(String(s || "").replace(NOISE_RE, ""));
}

/*  Folder names along a path, without the file. */
function dirs_of(path)
{
    const parts = String(path || "").split("/").filter(Boolean);
    parts.pop();
    return parts;
}


/***************************************************************
 *  Is this file a video, or a subtitle beside one?
 ***************************************************************/
function is_video(f)
{
    const name = (f && f.name) || "";
    if(VIDEO_RE.test(name)) {
        return true;
    }
    return !!(f && f.type && f.type.indexOf("video/") === 0);
}

function is_subtitle(f)
{
    return SUB_RE.test((f && f.name) || "");
}


/***************************************************************
 *  Read a path. Returns:
 *
 *      {
 *          title,      what to call it on a row
 *          show,       the series, when it is an episode ("" if not)
 *          season,     number, 0 if not an episode
 *          episode,    number, 0 if not an episode
 *          ep_title,   the episode's own name, when the file has one
 *          year,       "2016", or ""
 *      }
 ***************************************************************/
function parse_name(path)
{
    const parts = String(path || "").split("/").filter(Boolean);
    const file = parts.length ? parts[parts.length - 1] : "";
    const dirs = dirs_of(path);
    const base = unbracket(spaced(strip_ext(file)));

    /*  1. The name says it is an episode. */
    for(const re of EPISODE_PATTERNS) {
        const m = re.exec(base);
        if(!m) {
            continue;
        }
        const season = parseInt(m[1], 10) || 0;
        const episode = parseInt(m[2], 10) || 0;
        let show = denoise(base.slice(0, m.index));
        const ep_title = denoise(base.slice(m.index + m[0].length));
        if(!show) {
            show = show_from_dirs(dirs);
        }
        /*  A year in a show's name ("Doctor Who 2005") says WHICH show,
            and stays part of it. */
        return {
            title: ep_title || code(season, episode),
            show: show,
            season: season,
            episode: episode,
            ep_title: ep_title,
            year: "",
        };
    }

    /*  2. The folder says it is a season, and the name is a number. */
    const parent = dirs.length ? spaced(dirs[dirs.length - 1]) : "";
    const sm = SEASON_DIR_RE.exec(parent);
    if(sm) {
        const em = BARE_EPISODE_RE.exec(base);
        if(em) {
            const season = parseInt(sm[1], 10) || 0;
            const episode = parseInt(em[1], 10) || 0;
            const ep_title = denoise(em[2] || "");
            return {
                title: ep_title || code(season, episode),
                show: show_from_dirs(dirs),
                season: season,
                episode: episode,
                ep_title: ep_title,
                year: "",
            };
        }
    }

    /*  3. A film, a clip, anything else. A year in the name is kept as
        a fact and taken out of the title — unless it IS the title
        ("1917", "2012"). */
    let title = denoise(base) || base;
    let year = "";
    const ym = YEAR_RE.exec(title);
    if(ym && trim_seps(ym[1])) {
        title = ym[1];
        year = ym[2];
    }
    title = denoise(title) || trim_seps(base) || file;
    return {
        title: title,
        show: "",
        season: 0,
        episode: 0,
        ep_title: "",
        year: year,
    };
}

/*  The show an episode belongs to, from the folders above it: the
    nearest one that is not a season folder. */
function show_from_dirs(dirs)
{
    for(let i = dirs.length - 1; i >= 0; i--) {
        const d = spaced(dirs[i]);
        if(SEASON_DIR_RE.test(d)) {
            continue;
        }
        const clean = denoise(unbracket(d));
        if(clean) {
            return clean;
        }
    }
    return "";
}

/*  S01E02, the one spelling every language reads. */
function code(season, episode)
{
    const p = (n) => String(n).padStart(2, "0");
    return "S" + p(season) + "E" + p(episode);
}


/***************************************************************
 *  Which subtitles belong to which video.
 *
 *  A subtitle is matched to a video in the SAME folder whose
 *  name it starts with, and what follows is its label:
 *
 *      Movie.mkv
 *      Movie.srt          → "" (no label: shown as "Subtitles")
 *      Movie.es.srt       → "es"
 *      Movie.en.forced.srt→ "en.forced"
 *
 *  The longest matching video wins, so "Movie 2.srt" goes with
 *  "Movie 2.mkv" and not with "Movie.mkv".
 *
 *  `videos` and `subs` are paths. Returns Map(video path → [{path,
 *  label}]).
 ***************************************************************/
function pair_subtitles(videos, subs)
{
    const by_dir = new Map();
    for(const v of videos) {
        const i = v.lastIndexOf("/");
        const dir = i < 0 ? "" : v.slice(0, i);
        const base = strip_ext(i < 0 ? v : v.slice(i + 1));
        let arr = by_dir.get(dir);
        if(!arr) {
            arr = [];
            by_dir.set(dir, arr);
        }
        arr.push({path: v, base: base});
    }
    for(const arr of by_dir.values()) {
        arr.sort((a, b) => b.base.length - a.base.length);
    }

    const out = new Map();
    for(const s of subs) {
        const i = s.lastIndexOf("/");
        const dir = i < 0 ? "" : s.slice(0, i);
        const sbase = strip_ext(i < 0 ? s : s.slice(i + 1));
        const cands = by_dir.get(dir) || [];
        let hit = null;
        for(const c of cands) {
            if(sbase === c.base || sbase.indexOf(c.base + ".") === 0) {
                hit = c;
                break;
            }
        }
        if(!hit && cands.length === 1) {
            /*  One video alone in its folder: a subtitle there is its
                subtitle, whatever the two files happen to be called. */
            hit = cands[0];
        }
        if(!hit) {
            continue;
        }
        let label = sbase === hit.base ? "" : sbase.slice(hit.base.length + 1);
        if(sbase !== hit.base && sbase.indexOf(hit.base + ".") !== 0) {
            label = sbase;
        }
        let arr = out.get(hit.path);
        if(!arr) {
            arr = [];
            out.set(hit.path, arr);
        }
        arr.push({path: s, label: label});
    }
    for(const arr of out.values()) {
        arr.sort((a, b) => a.label.localeCompare(b.label));
    }
    return out;
}


export {
    VIDEO_RE,
    SUB_RE,
    is_video,
    is_subtitle,
    parse_name,
    pair_subtitles,
    code,
    ext_of,
    strip_ext,
};
