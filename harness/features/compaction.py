"""Summarising old history: when the conversation gets long, replace its older part with a summary.

Trimming (trimming.py) drops old tool results from the copy that's sent; the model loses
those details. Summarising asks the model to write down what matters first: goals,
facts learned, decisions, open tasks. The summary then replaces the older messages in
the stored history, so every later call is smaller. It costs one extra model call each
time it happens, and some detail is lost for good. Claude Code calls this "compacting".
"""
from harness.core import mock_server  # for its plain-text rendering of messages
from harness.core import providers

PROMPT = (
    "You summarise the earlier part of a conversation between a user and an AI assistant that uses tools, "
    "so the assistant can carry on without the full history. Keep: what the user wants, facts and results "
    "that were found (key points of file contents, not the whole text), decisions made, and anything still "
    "to do. Plain text, at most about 250 words. Don't add anything that wasn't in the conversation."
)
HEADER = "[Summary of the earlier conversation, written by the harness to save space]"


def size(messages):
    """A rough size: how many characters of content the history holds."""
    return sum(len(str(m["content"])) for m in messages)


def split_point(messages):
    """Where the recent part starts: the last message you typed yourself (not a tool result).
    Cutting there never separates a tool request from its result."""
    for i in range(len(messages) - 1, -1, -1):
        if messages[i]["role"] == "user" and isinstance(messages[i]["content"], str):
            return i
    return 0


def _plain(content):
    """Model replies in the history are SDK objects; turn them into plain dicts for rendering."""
    if isinstance(content, str):
        return content
    return [b.model_dump(mode="json", exclude_none=True) if hasattr(b, "model_dump") else b for b in content]


def compact(messages, client, model, effort=None):
    """`effort`: for models that think adaptively (Opus 5.5), keep the summary call cheap with "low"."""
    """Returns (new history, details) or (None, None) if there's nothing old enough to summarise."""
    cut = split_point(messages)
    old, recent = messages[:cut], messages[cut:]
    if not old:
        return None, None
    transcript = "\n\n".join(f"### {m['role']}\n{mock_server.content_to_text(_plain(m['content']))}" for m in old)
    extra = {"output_config": {"effort": effort}} if effort else {}
    reply = providers.with_quiet_retries(client).messages.create(  # (not the lesson here: retries stay quiet)
        model=model, max_tokens=4000, system=PROMPT, **extra,
        messages=[{"role": "user", "content": f"The earlier conversation:\n\n{transcript}\n\nWrite the summary."}])
    summary = "".join(b.text for b in reply.content if b.type == "text").strip()
    if not summary:
        raise RuntimeError("the model returned an empty summary")
    # Merge the summary into the first recent message, so user and assistant turns still alternate
    first = {"role": "user", "content": f"{HEADER}\n{summary}\n\n[The conversation continues]\n{recent[0]['content']}"}
    new = [first] + recent[1:]
    return new, {"summary": summary, "before": size(messages), "after": size(new),
                 "messages_before": len(messages), "messages_after": len(new),
                 "usage": getattr(reply, "usage", None)}
