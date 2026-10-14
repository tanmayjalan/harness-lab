"""Making long conversations cheaper: send a trimmed copy of the history.

Every call sends the whole history again, and tool results (whole files,
for example) are usually the biggest part. Old ones are rarely needed, so
trimming replaces their content with a short note before sending.

The real history is never changed: the trimmed copy is only what's sent.
Each tool result keeps its tool_use_id, so the model still sees which
request it answered; only the text inside is shortened.
"""

NOTE = ("[Trimmed by the harness to save space: {n:,} characters of this old tool result were removed. "
        "Run the tool again if you need it.]")


def trim(messages, keep_last=2, min_chars=200):
    """Returns (copy to send, {"count": results trimmed, "chars": characters removed}).

    The tool results from the last `keep_last` tool rounds are kept whole, and so is anything
    shorter than `min_chars` (not worth trimming).
    """
    rounds = [i for i, m in enumerate(messages) if _tool_results(m)]
    keep = set(rounds[-keep_last:]) if keep_last else set()
    out, count, chars = [], 0, 0
    for i, m in enumerate(messages):
        if i in keep or not _tool_results(m):
            out.append(m)
            continue
        blocks = []
        for b in m["content"]:
            text = b.get("content") if isinstance(b, dict) and b.get("type") == "tool_result" else None
            if isinstance(text, str) and len(text) >= min_chars:
                blocks.append({**b, "content": NOTE.format(n=len(text))})
                count += 1
                chars += len(text)
            else:
                blocks.append(b)
        out.append({**m, "content": blocks})
    return out, {"count": count, "chars": chars}


def _tool_results(message):
    return (message.get("role") == "user" and isinstance(message.get("content"), list)
            and any(isinstance(b, dict) and b.get("type") == "tool_result" for b in message["content"]))
