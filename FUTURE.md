# Future

Work that has been studied and decided on, but deliberately left for later.

## Every callback through the automaton

[`docs/callbacks_outside_the_fsm.html`](docs/callbacks_outside_the_fsm.html)
(in Spanish; published as https://claude.ai/artifact/W72Kco5z4W9vmYWZkvzPbe)
counts, in yunovídeo and yunomúsica, the callbacks that enter a gobj as an
event and the ones that act directly: DOM listeners, store notifications,
timers, observers, media element events and the resumptions hidden behind
`await`. It explains why there are so many (the stores are plain modules,
not gobjs; `async`/`await` hides the completions the way io_uring would hide
them if there were no `yev_loop`) and proposes the deep change: stores
turned into service gobjs, thin adapters that only send events, and every
`await` chain rewritten as states.

Today none of those paths is a blind spot: the `stores` and `stores-time`
user trace levels write every call into a store, every channel it emits and
every browser callback it answers. The redesign is **FUTURE**: not started,
and waiting on three decisions listed at the end of the report — whether to
do it and in which order (yunovídeo's stores first), whether the code both
apps share moves into one package, and what stays outside on purpose (the
diagnostics, the visualizer's draw loop).
