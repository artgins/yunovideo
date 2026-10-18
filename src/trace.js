/***********************************************************************
 *          trace.js
 *
 *      What happens OUTSIDE the machine, made visible in its trace.
 *
 *      The gobjs' events are traced by the framework (the `machine`
 *      level). The stores are not gobjs: they are plain modules, close to
 *      the browser, and some of what they do never crosses an automaton
 *      — the calls the gobjs make to them, the channels they emit, the
 *      browser callbacks they answer directly (a timer that writes, an
 *      observer that sees a row, a picker that hands over files, the
 *      video element). That is fine as long as it is not a BLIND SPOT:
 *      every one of those passes through store_trace(), and is written
 *      to the trace when the root gclass's user level is on:
 *
 *          stores        calls into the stores, what they emit, and the
 *                        browser callbacks they answer
 *          stores-time   the clock channel ("time"), four a second while
 *                        something plays — its own level, or it would
 *                        drown the rest
 *
 *      Both are set like any other trace level (`set-gclass-trace
 *      gclass_name=C_YUNOVIDEO level=stores`), from the developer sheet,
 *      and kept by the yuno across launches. Off, a call costs one bit
 *      test.
 *
 *          Copyright (c) 2026, ArtGins.
 *          All Rights Reserved.
 ***********************************************************************/
import {gobj_trace_level, trace_msg, trace_json} from "@yuneta/gobj-js";


/*  The root gclass's user trace levels, in bit order. */
const STORE_TRACE_LEVELS = [
    ["stores",      "Calls into the stores, the channels they emit, the browser callbacks they answer"],
    ["stores-time", "The stores' clock channel (time), four a second while something plays"],
];

const BIT_STORES = 1 << 0;
const BIT_TIME = 1 << 1;

let tracer = null;          // the root gobj, whose levels decide


function set_store_tracer(gobj)
{
    tracer = gobj;
}

function tracing(clock)
{
    return !!tracer && !!(gobj_trace_level(tracer) & (clock ? BIT_TIME : BIT_STORES));
}

/*  A value as it can be read in a trace line: a video by its uid and
    path, a list by its length, a File by its name. Never the objects
    themselves — they are big, and a File says nothing useful. */
function brief(v)
{
    if(v === null || v === undefined) {
        return v;
    }
    if(Array.isArray(v)) {
        return v.length > 3 ? `[${v.length} items]` : v.map(brief);
    }
    if(typeof File !== "undefined" && v instanceof File) {
        return `File(${v.name})`;
    }
    if(typeof v === "object") {
        if("uid" in v && "path" in v) {
            return {uid: v.uid, path: v.path};
        }
        if(typeof Node !== "undefined" && v instanceof Node) {
            return `<${v.nodeName}>`;
        }
        return v;
    }
    return v;
}

/***************************************************************
 *  One line: `store: what`, and the data under it when there is
 *  any. `clock` puts it under the stores-time level.
 ***************************************************************/
function store_trace(store, what, data, clock)
{
    if(!tracing(clock)) {
        return;
    }
    trace_msg(`🗄 ${store}: ${what}`);
    if(data !== undefined) {
        trace_json(brief(data));
    }
}

/*  A store's channel going out. "time" is the clock. */
function trace_emit(store, channel)
{
    store_trace(store, `emit ${channel}`, undefined, channel === "time");
}

/***************************************************************
 *  A store function as the gobjs call it: the same function,
 *  writing its name and arguments to the trace first. Exported
 *  in place of the bare one, so a call from the interface into a
 *  store is a line of the trace, while the store's calls to
 *  itself are not.
 ***************************************************************/
function traced(store, name, fn)
{
    return function(...args) {
        if(tracing(false)) {
            store_trace(store, `${name}()`, args.length ? args.map(brief) : undefined);
        }
        return fn.apply(this, args);
    };
}


export {
    STORE_TRACE_LEVELS,
    set_store_tracer,
    store_trace,
    trace_emit,
    traced,
};
