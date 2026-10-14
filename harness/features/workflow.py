"""A workflow: a fixed chain of agents, where YOUR CODE decides the order, not the model.

With a helper (subagents.py) the model decides when to hand work off. Here every message goes
through the same steps, written below as ordinary Python:

    gather facts  ->  write  ->  check  --PASS-->  answer
                                   |
                                   +--problems--> fix -> check again (at most FIXES times)

Each step is a whole agent loop of its own (loop.agent: call the model, run its tools, call
again until it answers), with its own instructions, its own tools and an empty history. The
steps never see each other's conversations: they only get the text this code passes on. So
there are two loops, one inside the other:

    the outer chain   the steps, in an order fixed here; the code reads each result and decides what's next
    the inner loop    inside one step, the model decides which tools to use and when it's finished

Only the final answer is added to the main conversation, so the next message carries the
question and the answer, not the steps' working.
"""
import re

from harness.core import loop
from harness.features import subagents

FIXES = 2  # at most this many rewrites after the check finds problems

# The steps, for the page and the terminal: (name, label). "fix" repeats after a failed check.
STEPS = (("gather", "Gather facts"), ("write", "Write"), ("check", "Check"), ("fix", "Fix"))
LABEL = dict(STEPS)

GATHER = (
    "You are the fact-gathering step of a fixed workflow; another step will write the answer from your notes. "
    "Use your tools to collect the facts needed to answer the question: look at files instead of guessing. "
    "Reply with short notes, one fact per line, each saying where it came from. Don't write the answer itself. "
    "If you find nothing relevant, say so."
)
WRITE = (
    "You are the writing step of a fixed workflow. Answer the user's question using only the facts you are given. "
    "Be clear and brief. If the facts don't cover something, say so instead of guessing. Reply with the answer only."
)
CHECK = (
    "You are the checking step of a fixed workflow. Compare the draft answer with the facts and the question. "
    "If every claim in the draft is backed by the facts and the question is answered, reply with the single word PASS. "
    "Otherwise reply PROBLEMS on the first line, then one short line per problem."
)


def read_only(tools):
    """The gathering step's tools: the helpers' read-only ones (nothing that writes, asks you or starts a helper)."""
    return [t for t in tools if t["name"] in subagents.READ_ONLY]


def offered(tools, request):
    """The tools a call was really offered: a workflow step's own (its request names them in step_tools),
    otherwise all of them. For the page, which records the whole list with each call."""
    names = request.get("step_tools")
    return list(tools) if names is None else [t for t in tools if t.get("name") in names]


def verdict(text):
    """The check step's reply as ("pass" | "problems" | "unclear", the problems). Your code has to read it to
    decide what comes next, so it must say PASS or PROBLEMS first (bold, a full stop or another case is fine)."""
    m = re.match(r"[\W_]*(PASS|PROBLEMS?|FAIL)\b(.*)", text or "", re.IGNORECASE | re.DOTALL)
    if not m:
        return "unclear", ""
    if m.group(1).upper() == "PASS":
        return "pass", ""
    first, _, rest = m.group(2).partition("\n")  # "PROBLEMS:** ..." on the first line, the list below it
    first = first.strip(" \t*:.;,!-–—")
    return "problems", "\n".join(x for x in (first, rest.strip()) if x)


def _text(content):
    if isinstance(content, str):
        return content
    return "".join(getattr(b, "text", None) or (b.get("text", "") if isinstance(b, dict) and b.get("type") == "text" else "")
                   for b in content or [])


def earlier(messages):
    """The conversation before the last message, as plain text: your messages and the answers (no tool
    traffic), so a follow-up like "and for monthly plans?" still makes sense to the steps."""
    lines = []
    for m in messages[:-1]:
        if m["role"] == "user" and not isinstance(m["content"], str):
            continue  # tool results
        said = _text(m["content"]).strip()
        if said:
            lines.append(f"{'User' if m['role'] == 'user' else 'Assistant'}: {said}")
    return "\n".join(lines)


def run(messages, client, *, tools, max_turns=20, on_event=loop.ignore_event, **agent_args):
    """Answer the last message in `messages` with the chain of steps, append the answer to `messages` as the
    assistant's reply, and return it. `agent_args` go to every step's loop.agent (model, permission, confirm,
    run, hooks, should_stop, prepare, thinking, cache, busy, at_once, max_tokens). `max_turns` is the most
    model calls for the whole message, shared by the steps.

    Events: "step" when a step starts (what it was sent, its tools) and "step_done" when it ends (what it
    returned; for a check, the verdict). The steps' own calls and tools are the loop's usual events, and
    each "request" says which step it belongs to."""
    question = _text(messages[-1]["content"])
    before = earlier(messages)
    context = f"Earlier in this conversation:\n{before}\n\n" if before else ""
    used = [0]  # model calls so far, all steps together
    n = [0]

    def step(name, task, system, offered, **extra):
        n[0] += 1
        left = max_turns - used[0]
        if left <= 0:
            raise RuntimeError(f"Stopped: hit max_turns ({max_turns})")
        names = [t["name"] for t in offered]
        on_event("step", n=n[0], name=name, label=LABEL[name], sent=task, system=system, tools=names, **extra)

        def tagged(kind, **data):
            if kind == "request":
                used[0] += 1
                data.update(step=n[0], step_name=name, step_tools=names)
            on_event(kind, **data)
        try:
            text = loop.agent([{"role": "user", "content": task}], client, max_turns=left, system=system,
                              tools=offered, on_event=tagged, **agent_args)
        except RuntimeError as e:
            if "hit max_turns" in str(e):  # the steps share the message's limit: report that one
                raise RuntimeError(f"Stopped: hit max_turns ({max_turns})") from None
            raise
        return text

    def done(name, text, **extra):
        on_event("step_done", n=n[0], name=name, label=LABEL[name], text=text, chars=len(text), **extra)

    facts = step("gather", f"{context}Question: {question}\n\nCollect the facts needed to answer it.",
                 GATHER, read_only(tools))
    done("gather", facts)
    draft = step("write", f"{context}Question: {question}\n\nFacts:\n{facts}\n\nWrite the answer.", WRITE, [])
    done("write", draft)
    fixes = 0
    while True:
        reply = step("check", f"Question: {question}\n\nFacts:\n{facts}\n\nDraft answer:\n{draft}", CHECK, [])
        said, problems = verdict(reply)
        last = said == "problems" and fixes == FIXES  # problems, but no fixes left
        done("check", reply, verdict=said, problems=problems, fixes_left=FIXES - fixes, last=last)
        if said != "problems" or last:
            break  # PASS; or a reply the code can't read (it keeps the draft); or out of fixes
        fixes += 1
        draft = step("fix", f"{context}Question: {question}\n\nFacts:\n{facts}\n\nDraft answer:\n{draft}\n\n"
                            f"A checker found these problems:\n{problems}\n\nRewrite the answer to fix them. "
                            "Reply with the answer only.", WRITE, [], attempt=fixes)
        done("fix", draft, attempt=fixes)
    messages.append({"role": "assistant", "content": draft})
    return draft
