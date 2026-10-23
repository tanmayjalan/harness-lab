"""Adding up what one run used: its model calls, their tokens and cost, and the tools that didn't run as asked.

Compare adds up a run while it happens (compare.run_one); Re-run adds up a saved message from its events
(conversations.run_stats). Both use this, so the two sides of a re-run are counted the same way.
"""

# How a tool call can end without running (the outcomes loop._run_one gives, apart from "ran" and "error"):
# your settings blocked it, you declined it, your hook blocked it, it needed your OK and nobody could be asked,
# or it was never run (not offered on that call, a cut-off reply, or Stop)
NOT_RUN = ("blocked", "declined", "hook_blocked", "unattended", "not_run")


def plain_usage(usage):
    """A call's token counts as a plain dict: from the SDK's reply object, a saved event's dict, or nothing ({})."""
    if usage is None:
        return {}
    return usage if isinstance(usage, dict) else usage.model_dump()


class Tally:
    """The running totals for one run. Tell it each tool call, tool result and model reply, in order."""

    def __init__(self):
        self.tools = []   # each tool the model asked for: its name and input, and why it didn't run (if it didn't)
        self.calls = []   # each model call: its tokens, cost and time
        self.read = 0     # tokens in, all calls together (read from the cache or written to it included)
        self.wrote = 0    # tokens out
        self.spent = 0.0  # dollars
        self.priced = False  # whether any call had a price (without one, the cost is unknown, not 0)

    def tool_call(self, call_id, name, args):
        self.tools.append({"id": call_id, "name": name, "input": args})

    def tool_result(self, call_id, outcome):
        """Mark the tool this result answers when it didn't run as asked: "failed" for an error, otherwise
        "blocked", with the outcome itself to say why."""
        if outcome != "error" and outcome not in NOT_RUN:
            return
        for t in self.tools:
            if t["id"] == call_id:
                t["failed" if outcome == "error" else "blocked"] = True
                if outcome == "unattended":
                    t["unattended"] = True  # nobody to ask: shown as "(not run)", scored as blocked
                t["outcome"] = outcome

    def response(self, usage, cost, turn, sub, seconds):
        """One model reply: its token counts (`usage`), its cost in dollars (None if unknown), which turn it
        was, whether a helper made it (`sub`) and how long it took."""
        u = plain_usage(usage)
        self.read += ((u.get("input_tokens") or 0) + (u.get("cache_read_input_tokens") or 0)
                      + (u.get("cache_creation_input_tokens") or 0))
        self.wrote += u.get("output_tokens") or 0
        if cost is not None:
            self.spent += cost
            self.priced = True
        self.calls.append({"turn": turn, "sub": sub, "input_tokens": u.get("input_tokens") or 0,
                           "cache_read": u.get("cache_read_input_tokens") or 0,
                           "output_tokens": u.get("output_tokens") or 0, "cost": cost, "seconds": seconds})

    def figures(self):
        """The totals, as a side of a comparison shows them (each tool without its call id)."""
        return {"tools": [{k: v for k, v in t.items() if k != "id"} for t in self.tools], "calls": self.calls,
                "tokens_read": self.read, "tokens_written": self.wrote,
                "cost": self.spent if self.priced else None}
