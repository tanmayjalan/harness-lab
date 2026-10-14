"""Keeping the history small enough to send: trimming and summarising, as your settings say.

Shared by the web page (web/server.py) and the terminal version (cli.py), so both behave the same.
The two ideas themselves are in trimming.py and compaction.py.
"""
from harness.core import providers
from harness.features import compaction, trimming

ANTHROPIC_SKIPS_TRIMMING = ("Trimming is off with the Anthropic API: it refuses a request whose earlier messages "
                            "changed, and offers its own server-side option instead (context editing).")


def maybe_compact(messages, settings, client, model, provider, on_event=lambda kind, **data: None):
    """Replace the older part of `messages` (in place) with a summary once it's over your size limit.
    Tells `on_event` "compacting", then "compacted" (with the details, or `failed`)."""
    c = settings.get("compact") or {}
    if not c.get("enabled") or compaction.size(messages) <= c["over_chars"]:
        return
    # (Allowed with the Anthropic API too: the summary replaces the older turns with a new, valid
    # history; nothing already sent is edited in place, which is what trimming would do.)
    on_event("compacting", before=compaction.size(messages), limit=c["over_chars"])
    try:
        effort = "low" if providers.thinking_style(provider) == "adaptive" else None
        new, info = compaction.compact(messages, client, model, effort=effort)
    except Exception as e:
        on_event("compacted", failed=f"{type(e).__name__}: {e}")
        return
    if new is not None:
        messages[:] = new  # the stored history itself changes (unlike trimming)
        on_event("compacted", **info)


def preparer(settings, provider, record=lambda stats: None):
    """How the history is copied before each call: trimmed if you turned trimming on. `record` hears
    what each copy removed ({"count", "chars"}), why it was skipped ({"skipped": why}), or None."""
    trim = settings.get("trim") or {}
    record(None)
    if not trim.get("enabled"):
        return lambda msgs: msgs
    if provider == "anthropic":
        # Changing earlier turns can be refused by the Anthropic API (it checks that past turns are
        # unchanged), so trimming is left off there; it has its own server-side option.
        record({"skipped": ANTHROPIC_SKIPS_TRIMMING})
        return lambda msgs: msgs

    def prepare(msgs):
        copy, stats = trimming.trim(msgs, keep_last=trim.get("keep_last", 2))
        record(stats)
        return copy
    return prepare
