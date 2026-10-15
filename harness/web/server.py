r"""A web page for trying the harness and watching each step of its loop.

Run:   start.bat   (or, from the Harness folder:)
       .venv\Scripts\python -m harness.web.server                        mock: real replies from `claude -p`
       .venv\Scripts\python -m harness.web.server --provider deepseek    DeepSeek (needs DEEPSEEK_API_KEY)
       .venv\Scripts\python -m harness.web.server --provider anthropic   the Anthropic API (needs ANTHROPIC_API_KEY)
Open:  http://127.0.0.1:8000

The page polls GET /events for what the harness is doing. Everything is held
in memory; restarting the server starts a fresh conversation.
"""
import argparse
import json
import mimetypes
import pathlib
import os
import threading
import time
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from harness.features import context
from harness.web import compare
from harness.web import conversations
from harness import evals
from harness.web.jsonify import to_json
from harness.core import local_only, loop, run_code, tools
from harness.features import hooks
from harness.features import lab_settings
from harness.features import skills
from harness.features import mcp_client
from harness.core import mock_server
from harness.core import providers
from harness.features import subagents
from harness.features import tool_search
from harness.features import trimming
from harness.features import memory
from harness.features import workflow
from harness.features import checkpoints
from harness import paths

STATIC = pathlib.Path(__file__).resolve().parent / "static"  # the built page (ui/ → npm run build)
NOT_BUILT = (
    "<!doctype html><meta charset=utf-8><title>Harness lab</title>"
    "<h1>The page isn't built yet</h1>"
    "<p>Run <code>npm install</code> and <code>npm run build</code> in the <code>ui</code> folder, "
    "or start the lab with <code>start.bat</code>, which builds it when Node.js is installed.</p>"
).encode("utf-8")

# Windows reads file types from the registry, which can say text/plain for .js: pin the ones we serve
for _ext, _type in [(".js", "application/javascript"), (".mjs", "application/javascript"), (".css", "text/css"),
                    (".svg", "image/svg+xml"), (".woff2", "font/woff2"), (".map", "application/json"),
                    (".html", "text/html"), (".ico", "image/x-icon"), (".png", "image/png")]:
    mimetypes.add_type(_type, _ext)


class CannotRewind(Exception):
    """Why a rewind can't happen, in words for the page."""


class Session:
    """One conversation, plus the list of events the page draws from."""

    def __init__(self, client, mode, model=loop.MODEL, max_turns=20, provider=None,
                 profile_path=None, settings_path=None, mcp=None):
        self.client = client
        self.mcp = mcp  # tools from MCP servers (see features/mcp_client.py), or None
        # Looked up now rather than fixed when this file loads, so tests can point them at temporary files
        self.profile_path = profile_path or memory.PATH      # facts about you, shared by every conversation
        self.settings_path = settings_path or lab_settings.PATH    # your edits to the prompt, tools and permissions
        self.base_tools = list(tools.TOOLS) + (mcp.tools if mcp else [])
        self._tools_now = self.base_tools  # the tools (with your edits) for the message being answered
        self._hooks_now = None             # your hooks for the message being answered
        self._toolbox = None   # with the 40 office tools on: the ones this conversation loaded (tool_search.py)
        self._tools_fn = None  # with them on: the function the loop reads the tool list from, before each call
        self.shared_facts = 0
        self.edits = []
        self.last_trim = None  # what trimming removed from the copy sent on the latest call
        self.live_text = ""    # the reply so far, while it's still arriving (streaming)
        self.provider = provider  # e.g. "mock" or "deepseek"
        self.mode = mode          # its label, e.g. "DeepSeek"
        self.model = model
        self.max_turns = max_turns
        self.lock = threading.Lock()
        self.generation = 0   # goes up on reset so the page knows to clear itself
        self.conv_id = conversations.new_id()  # this conversation's file in the conversations folder
        self.messages = []
        self.events = []
        self.running = False
        self.stop_requested = False
        self.pending = None   # the tool call waiting for the user's yes/no
        self.last_call = {}
        self.msg = 0             # how many messages you've sent in this conversation; every event says which
        self._config_now = None  # the settings in effect for the message being answered (see lab_settings.snapshot)
        self._permission_now = None  # your tool rules, thinking and caching for that message (helpers use them too)
        self.frozen = None       # with edits applying per conversation: the system prompt and tools it keeps
        self.origin = None       # an opened side of a comparison: {"comparison": id, "side": "A"}
        self.kind = None         # "compare" or "eval" for a conversation saved by those screens (kept on save)
        self.allow_now = set()   # tools you said "Always allow" for during this message: no more asking
        self._first_text = None  # when the current reply's first streamed text arrived
        self._last_start = None  # the previous call's system prompt and tools, to notice when they change
        self._thinking_now = None
        self._cache_now = False
        self._busy_now = False
        # The workspace's files before each message ({"1": manifest, ...}) and after the latest reply ("after"),
        # so Rewind can undo what the tools changed (features/checkpoints.py). None: too big to keep
        self.checkpoints = {}

    def _append(self, kind, data):  # caller holds the lock
        self.events.append({"seq": len(self.events), "kind": kind, "time": time.time(), "msg": self.msg, **data})

    def emit(self, kind, **data):
        if kind == "text":  # a piece of a reply that's still arriving: kept aside, not stored as a step
            with self.lock:
                if not self.live_text:
                    self._first_text = time.time()  # the first word: how long the reply took to start
                self.live_text += data["text"]
            return
        data = to_json(data)  # copy now: `messages` keeps changing after this
        with self.lock:
            if kind == "response" and self._first_text:
                data["first_text"] = self._first_text
            if kind in ("request", "response"):
                self.live_text = ""
                self._first_text = None
            if kind == "tool_call":
                self.last_call = data
            if kind in ("request", "answer"):  # say which service and model this was
                data.update(provider=self.mode, model=self.model)
            if kind == "request":
                data["facts"] = self.shared_facts
                data["edited"] = self.edits
                data["trimmed"] = self.last_trim
                if self._tools_fn:  # the list can grow during a message (find_tool): what this call really sent
                    self._tools_now = self._tools_fn()
                    if self._config_now:
                        self._config_now = {**self._config_now, "tools": [
                            {"name": t["name"], "description": t.get("description", ""),
                             "source": self.tool_source(t["name"]), "permission": self._permission_now(t["name"])}
                            for t in self._tools_now]}
                # A workflow step is offered only its own tools (step_tools): say so, not the whole list
                offered = workflow.offered(self._tools_now or [], data)
                # Did the start of the request (system prompt or tools) change since the last call? If so,
                # nothing from the previous call could be read from the cache. (A workflow's next step has
                # its own instructions, so its first call starts afresh: that's expected, not flagged.)
                start = (data.get("system"), [(t.get("name"), t.get("description")) for t in offered])
                data["start_changed"] = (self._last_start is not None and start != self._last_start
                                         and not (data.get("step") and data.get("turn") == 1))
                self._last_start = start
                if self._hooks_now:  # which of your hooks this call's tools went through
                    data["hooks"] = self._hooks_now.describe()
                if self._config_now:  # what was sent and which settings were in effect, for the inspector
                    data["tools"] = workflow.offered(self._config_now["tools"], data)
                    data["config"] = {k: v for k, v in self._config_now.items() if k != "tools"}
                data.pop("step_tools", None)
            if kind == "tool_call":
                data["source"] = self.tool_source(data.get("name", ""))
            if kind in ("response", "compacted") or (kind == "sub" and data.get("step") == "response"):
                data["cost"] = providers.cost(self.provider, data.get("usage"), self.model)
            self._append(kind, data)

    def snapshot(self, since):
        with self.lock:
            return {"gen": self.generation, "running": self.running, "events": self.events[since:],
                    "conversation": self.conv_id, "provider": self.provider, "model": self.model,
                    "live": self.live_text, "frozen": self.frozen is not None, "origin": self.origin,
                    # your messages that have a checkpoint, by their event seq: they offer "Rewind to here"
                    "rewindable": [e["seq"] for e in self.events
                                   if e["kind"] == "user" and str(e.get("msg")) in self.checkpoints]}

    def busy_reason(self):
        """Why you can't start, open or switch right now, in words that say what to do."""
        if self.pending is not None:
            return "Answer the approval first (Allow or Decline)."
        return "Wait for the current message to finish."

    def title(self):  # caller holds the lock
        first = next((m["content"] for m in self.messages if m["role"] == "user" and isinstance(m["content"], str)), "")
        return (first[:60] + "…") if len(first) > 60 else first or "(empty)"

    def start(self, text):
        with self.lock:
            if self.running:
                return False
            self.running = True
            self.stop_requested = False
            self.msg += 1
            self.messages.append({"role": "user", "content": text})
            self._append("user", {"text": text})
        threading.Thread(target=self._run, daemon=True).start()
        return True

    def _run(self):
        self._checkpoint(str(self.msg))  # the files as they were before this message, for Rewind
        try:
            # Read the profile and your settings fresh for every message, so changes apply straight away
            facts = memory.load(self.profile_path)
            settings = lab_settings.load(self.settings_path)
            base_system = lab_settings.system_prompt(settings, loop.SYSTEM)
            # (shaped for the provider just below; run_python only with Run code on)
            described = lab_settings.offered_tools(settings, self.base_tools)
            self._tools_now = providers.tools_for(self.provider, described)
            self._hooks_now = hooks.load()  # your my_hooks.py, read fresh for every message
            self._maybe_compact(settings)   # summarise old history first, if you turned that on
            system = memory.system_prompt(base_system, facts)
            # Skills: a line each in the prompt and a tool to load one, or every skill in full. Added
            # before the start is kept, so a kept start keeps them too
            found, skill_setting = skills.load_all(), settings.get("skills")
            system = skills.system_prompt(system, skill_setting, found)
            if skills.offers_tool(skill_setting, found):
                described = [*described, skills.SKILL_TOOL]
                self._tools_now = providers.tools_for(self.provider, described)
            extra = lab_settings.extra_tools(settings)
            if extra:  # 40 office tools: every call sends all of them, or find_tool (features/tool_search.py)
                described = tool_search.start(described, extra)
                self._tools_now = providers.tools_for(self.provider, described)
            shared = len(memory.shared(facts))
            kept = None
            if lab_settings.per_conversation(settings):
                # The conversation keeps the start it began with (the facts about you are in it too);
                # edits apply from the next conversation
                if self.frozen is None:
                    self.frozen = {"system": system, "tools": to_json(described), "facts_shared": shared,
                                   "system_edited": bool(settings.get("system")),
                                   "descriptions": sorted(settings.get("descriptions") or {})}
                kept = lab_settings.kept_start(self.frozen, loop.SYSTEM, self.base_tools)
                system = self.frozen["system"]
                # Shaped for the provider in use now, so a switch mid-conversation gets the right options
                # ("strict" only for Anthropic). A start kept by an older save was shaped when it was kept.
                # Run code switched off is a safety switch, so it applies at once: run_python leaves even a
                # kept start (the tool list changes, and the loop refuses a tool it didn't offer)
                kept_tools = [t for t in self.frozen["tools"]
                              if t.get("name") != "run_python" or lab_settings.run_code(settings)]
                self._tools_now = providers.tools_for(self.provider, kept_tools)
            else:
                self.frozen = None  # a message sent per message drops any start kept earlier
            # What this message sends, for the page: the kept start's facts and edits, not today's
            self.shared_facts = kept["facts_shared"] if kept else shared
            self.edits = lab_settings.what_changed(settings, kept)
            base = lab_settings.permission(settings, self.default_permission)
            self.allow_now = set()
            # "Always allow" answered during this message counts at once, not only from the next message
            permission = lambda name, base=base: "allow" if name in self.allow_now and base(name) == "ask" else base(name)  # noqa: E731
            self._permission_now = permission  # helpers follow your rules too
            self._thinking_now = lab_settings.thinking_spec(settings, providers.thinking_style(self.provider))
            self._cache_now = lab_settings.caching(settings)
            self._busy_now = lab_settings.busy(settings)  # the practice switch, for helpers too
            self._config_now = lab_settings.snapshot(
                settings, provider=self.provider, label=self.mode, model=self.model, system=system,
                facts_shared=self.shared_facts, tools=self._tools_now, permission=permission, source=self.tool_source,
                kept=kept)
            max_tokens, max_turns = lab_settings.limits(settings)
            shared = dict(max_tokens=max_tokens, confirm=self._confirm, on_event=self.emit, model=self.model,
                          tools=self._tools_now, permission=permission, run=self._run_tool_stoppable,
                          should_stop=lambda: self.stop_requested, hooks=self._hooks_now,
                          prepare=self._prepare(settings), thinking=self._thinking_now, cache=self._cache_now,
                          busy=self._busy_now, at_once=self._at_once(settings))
            self._tools_fn = None
            if extra and not lab_settings.workflow(settings):  # (a workflow step gets read-only tools only)
                if self._toolbox is None:  # a new or reopened conversation: start from what its history loaded
                    self._toolbox = tool_search.Toolbox(self._tools_now, extra, tool_search.used_in(self.messages))
                box = self._toolbox
                box.base, box.mode = self._tools_now, extra  # (your settings may have changed since the last message)
                self._tools_fn = lambda: providers.tools_for(self.provider, box.now())
                shared.update(tools=self._tools_fn, run=box.run(self._run_tool_stoppable))
            if lab_settings.workflow(settings):
                # A fixed chain of agents, each step with its own instructions and tools (features/workflow.py).
                # Not streamed: the steps' notes and drafts aren't the answer
                answer = workflow.run(self.messages, self.client, max_turns=min(max_turns, self.max_turns), **shared)
            else:
                answer = loop.agent(self.messages, self.client, min(max_turns, self.max_turns), system=system,
                                    stream=self.provider != "mock",  # the mock server can't stream
                                    **shared)
            self.emit("answer", text=answer)
        except loop.Stopped:
            self.emit("stopped")
        except Exception as e:
            self.emit("error", **providers.error_event(e))
        finally:
            # The files after the reply: anything that differs later was changed by you, not the model
            self._checkpoint("after", store=False)
            with self.lock:
                self._append("done", {})
                saved = (self.conv_id, self.title(), to_json(self.messages), list(self.events), self.frozen)
                where = {"kind": self.kind, "origin": self.origin, "checkpoints": dict(self.checkpoints)}
            try:  # saved only between messages, never while an approval is waiting
                conversations.save(*saved, **where)
            except OSError as e:
                print(f"  !! could not save the conversation: {e}")
            with self.lock:  # only now is it finished, so nothing can open or reset it mid-save
                self.running = False

    def _checkpoint(self, key, store=True):
        """Note the workspace's files under `key` (only while the message runs, so nothing else changes them)."""
        if not checkpoints.ON:
            return
        try:
            manifest = checkpoints.take(tools.WORKSPACE, store=store)
        except Exception as e:  # e.g. the copies' folder can't be written: Rewind can't undo files for this one
            print(f"  !! could not save a checkpoint: {e}")  # (and the message still runs)
            manifest = None
        with self.lock:
            self.checkpoints[key] = manifest

    def _rewind_plan(self, seq):  # caller holds the lock
        """The checks before a rewind to the message with this seq, then what it would need."""
        if self.running:
            raise CannotRewind(self.busy_reason())
        data = {"messages": self.messages, "events": self.events}
        user = conversations._user_event(data, seq)  # KeyError: no such message
        history = conversations.history_before(data, seq)
        if history is None:
            raise CannotRewind("A summary replaced the history before that message, so the conversation "
                               "can't go back to exactly how it was then.")
        n = user.get("msg")
        if str(n) not in self.checkpoints:
            raise CannotRewind("This message has no checkpoint (a saved copy of the files before it), so it can't "
                               "be rewound. Conversations from before Rewind existed have none.")
        return user, n, history, self.checkpoints[str(n)]

    def rewind_preview(self, seq):
        """What a rewind to the message with this seq would do, for the page to confirm first."""
        with self.lock:
            user, n, _, manifest = self._rewind_plan(seq)
            later = self.events[self.events.index(user):]
            after = self.checkpoints.get("after")
        files = edited = None
        if manifest is not None:
            files = checkpoints.changes(manifest, tools.WORKSPACE)
            # Changes since this conversation's last reply that the rewind would overwrite: not this conversation's
            # own (you, another conversation, Compare or Re-run, or a program a script left running)
            if after is not None:
                yours = checkpoints.changes(after, tools.WORKSPACE)
                touched = set(files["restore"]) | set(files["delete"])
                edited = sorted(set(yours["restore"] + yours["delete"]) & touched)
        return {"seq": seq, "message": n, "text": user.get("text", ""),
                "messages": sum(e["kind"] == "user" for e in later),
                "files": files,  # None: the workspace was too big to keep a copy, so files stay as they are
                "edited": edited or [],
                "unreadable": sorted(rel for rel, digest in checkpoints.readable(manifest or {}).items()
                                     if digest is None),
                "cannot_undo": self._cannot_undo(later)}

    def _cannot_undo(self, events):
        """What the removed messages' tools did that a rewind can't take back: it happened outside the workspace."""
        stopped = {e["result"].get("tool_use_id") for e in events
                   if (e["kind"] == "tool_result" or (e["kind"] == "sub" and e.get("step") == "tool_result"))
                   and e.get("outcome") in ("declined", "blocked", "hook_blocked", "unattended", "not_run")
                   and isinstance(e.get("result"), dict)}
        out = []
        for e in events:
            if not (e["kind"] == "tool_call" or (e["kind"] == "sub" and e.get("step") == "tool_call")):
                continue
            if e.get("id") in stopped:
                continue  # it never ran
            name, args = e.get("name", ""), e.get("input") or {}
            if (e.get("source") or self.tool_source(name)) != "built in":
                why = "it ran in another program (an MCP server), which keeps whatever it did"
            elif name == "get_weather":
                why = "the web request to open-meteo.com was already sent"
            elif name == "remember_fact":
                why = f"the fact \"{args.get('label', '')}\" stays in Memory (remove it in Settings → Memory)"
            elif name == "run_python":
                why = "anything the code did outside the workspace (other files, web requests, programs it started) isn't undone"
            elif name == "write_file" and e.get("outside"):
                why = f"it wrote outside the workspace, to {args.get('path', '')}"
            else:
                continue
            if {"tool": name, "why": why} not in out:
                out.append({"tool": name, "why": why})
        return out

    def rewind(self, seq):
        """Go back to just before the message with this seq: put the workspace's files back as they were,
        cut the conversation there, and save. Returns the message's text, for the message box."""
        with self.lock:  # held throughout, so no message can start halfway through
            user, n, history, manifest = self._rewind_plan(seq)
            done = None
            if manifest is not None:
                # The conversation is cut only once every file is back, so after a failure the same rewind
                # can simply be tried again: restore only does what is still different
                try:
                    done = checkpoints.restore(manifest, tools.WORKSPACE)
                except FileNotFoundError as e:  # checked before anything changed
                    raise CannotRewind(f"Can't put the files back: {e}. Nothing was changed.") from e
                except ValueError as e:  # checked before anything changed
                    raise CannotRewind(f"Can't put the files back: {e}. It leads outside the workspace now, through "
                                       "a link (a shortcut to another folder) or a damaged checkpoint, so nothing was "
                                       "changed. Remove the link and try again.") from e
                except checkpoints.RestoreError as e:
                    why = getattr(e.error, "strerror", None) or str(e.error)
                    raise CannotRewind(f"Couldn't change {e.rel} ({why}). If it's open in another program, close it "
                                       "and press Rewind again. Some files may already be back, but the conversation "
                                       "isn't cut yet: trying again finishes the job.") from e
                except OSError as e:
                    raise CannotRewind(f"Couldn't put the files back ({e}). The conversation isn't cut yet: "
                                       "try again.") from e
            self.messages = history
            self.events = self.events[:self.events.index(user)]
            self.msg = n - 1
            kept = {k: v for k, v in self.checkpoints.items() if k != "after" and int(k) < n}
            if manifest is not None:
                kept["after"] = manifest  # the files are now as they were then
            self.checkpoints = kept
            if n == 1:
                self.frozen = None  # nothing left: the next message starts the conversation afresh
            # The office tools that the removed messages found go too: the next message rebuilds the Toolbox
            # from the history that's left, as a reopened conversation does
            self._toolbox = None
            self.last_call, self._last_start, self.live_text = {}, None, ""
            self.generation += 1  # the page throws away the events it holds and fetches them again
            try:
                conversations.save(self.conv_id, self.title(), to_json(self.messages), list(self.events), self.frozen,
                                   kind=self.kind, origin=self.origin, checkpoints=dict(self.checkpoints))
            except OSError as e:
                print(f"  !! could not save the conversation: {e}")
        return {"text": user.get("text", ""), "files": done is not None,
                "restored": len(done["restore"]) if done else 0, "deleted": len(done["delete"]) if done else 0}

    def _at_once(self, settings):
        """Which tools may run at the same time (tools from MCP programs never do), or None with it off."""
        may = lab_settings.at_once(settings)
        if may is None:
            return None
        return lambda name: may(name) and not (self.mcp and self.mcp.handles(name))

    def default_permission(self, name):
        """Tools from MCP servers are someone else's code, so they ask first unless you change it."""
        if self.mcp and self.mcp.handles(name):
            return "ask"
        return loop.default_permission(name)

    def run_tool(self, name, args):
        if name == "delegate":
            helper = self.last_call.get("id")  # the delegate call this helper works for
            call = [0]

            def on_sub(kind, **data):  # number the helper's own model calls 1, 2, ...
                if kind == "request":
                    call[0] += 1
                self.emit("sub", step=kind, helper=helper, call=call[0], **data)
            return subagents.run_helper(
                args, self.client, self.model, self._tools_now, self.run_tool,
                on_event=on_sub, should_stop=lambda: self.stop_requested, hooks=self._hooks_now,
                permission=self._permission_now, thinking=self._thinking_now, cache=self._cache_now,
                busy=self._busy_now)
        if self.mcp and self.mcp.handles(name):
            return self.mcp.call(name, args)
        return tools.run_tool(name, args, self.profile_path)

    def _run_tool_stoppable(self, name, args):
        """run_tool for this conversation's own messages: Stop ends a running script at once, instead of
        waiting for it to finish or reach its time limit. (Compare and Re-run still wait for a script, at most
        the time limit.)"""
        if name == "run_python" and not (self.mcp and self.mcp.handles(name)):
            return run_code.run_python(code=args.get("code"), path=args.get("path"),
                                       should_stop=lambda: self.stop_requested)
        return self.run_tool(name, args)

    def tool_source(self, name):
        return (self.mcp.sources.get(name) if self.mcp else None) or "built in"

    def _maybe_compact(self, settings):
        """Replace the older part of the history with a summary once it's over your size limit."""
        context.maybe_compact(self.messages, settings, self.client, self.model, self.provider, self.emit)

    def _prepare(self, settings):
        """How the history is copied before sending: trimmed if you turned trimming on."""
        return context.preparer(settings, self.provider, record=lambda stats: setattr(self, "last_trim", stats))

    def _confirm(self, prompt):
        """Stands in for input(): waits until the page answers yes or no."""
        pending = {"id": uuid.uuid4().hex[:12], "event": threading.Event(), "allowed": False,
                   "tool": self.last_call.get("name", "")}
        asked = self.last_call.get("input", {})
        # A script file: what it says now (F388). Read before taking the lock, so the page's polling never waits on a file
        script = (run_code.script_text(asked["path"])
                  if pending["tool"] == "run_python" and isinstance(asked, dict) and asked.get("path") else None)
        with self.lock:
            self.pending = pending
            call_input = self.last_call.get("input", {})
            name = self.last_call.get("name", "")
            extra = {"outside": bool(self.last_call.get("outside"))}  # from the loop's own check, not the wording
            if getattr(self, "_permission_now", None):
                extra["setting"] = self._permission_now(name)  # your rule, before the workspace check
            if name in tools.PATH_TOOLS and call_input.get("path"):
                extra["where"] = str(tools.resolve(call_input["path"]))  # where the file really is
            if script is not None:
                extra["script"] = script
            if name == "remember_fact":  # a label you already have: say what it replaces (F277)
                old = memory.find(memory.load(self.profile_path), call_input.get("label", ""))
                if old:
                    extra["replaces"] = {"label": old["label"], "value": old["value"],
                                         "shared": bool(old["share"] and old["value"])}
            self._append("approval", {
                "id": pending["id"],
                "prompt": prompt.strip(),
                "tool": name,
                "input": call_input,
                "path": call_input.get("path", ""),        # write_file gets a nicer card
                "content": call_input.get("content", ""),
                **extra,
            })
            if self.stop_requested:  # Stop was pressed just before this: don't wait
                pending["event"].set()
        pending["event"].wait()
        with self.lock:
            self.pending = None
            self._append("decision", {"id": pending["id"], "allowed": pending["allowed"]})
        return "y" if pending["allowed"] else "n"

    def switch(self, name, client, label, model):
        """Use a different provider from the next message on. The conversation is kept."""
        with self.lock:
            if self.running:
                return False
            self.client, self.provider, self.mode, self.model = client, name, label, model
            # The earlier model's reasoning (thinking blocks) belongs to that model: the new one can't use it
            # (and an API may refuse it), so it's dropped. The words and tool calls stay.
            dropped = drop_thinking(self.messages)
            self._append("provider", {"name": name, "label": label, "model": model,
                                      "history": len(self.messages), "thinking_dropped": dropped})
            return True

    def stop(self):
        """Ask the loop to stop after the current step. A waiting approval counts as declined."""
        with self.lock:
            if not self.running:
                return False
            if not self.stop_requested:
                self.stop_requested = True
                self._append("stopping", {})
            if self.pending:
                self.pending["allowed"] = False
                self.pending["event"].set()
            return True

    def decide(self, approval_id, allowed, always=False):
        """`always`: also allow this tool for the rest of the message (the page saves it as Allow too)."""
        with self.lock:
            if not self.pending or self.pending["id"] != approval_id:
                return False
            self.pending["allowed"] = bool(allowed)
            if allowed and always and self.pending.get("tool"):
                self.allow_now.add(self.pending["tool"])
            self.pending["event"].set()
            return True

    def reset(self):
        """Start a new conversation. The old one stays saved."""
        with self.lock:
            if self.running:
                return False
            self.messages, self.events, self.last_call = [], [], {}
            self.msg = 0
            self.frozen, self._last_start = None, None
            self._toolbox = None  # the office tools loaded belong to the old conversation
            self.origin = None
            self.kind = None
            self.checkpoints = {}
            self.conv_id = conversations.new_id()
            self.generation += 1
            return True

    def open(self, conv_id):
        """Carry on with a saved conversation, exactly as it was."""
        data = conversations.load(conv_id)  # raises if it doesn't exist
        with self.lock:
            if self.running:
                return False
            self.messages, self.events, self.last_call = data["messages"], data["events"], {}
            self.msg = sum(e["kind"] == "user" for e in self.events)
            self.frozen, self._last_start = data.get("frozen"), None
            self._toolbox = None  # rebuilt from this history's office tools at its next message
            self.origin = data.get("origin")
            self.kind = data.get("kind")
            self.checkpoints = data.get("checkpoints") or {}  # none in conversations saved before Rewind
            self.conv_id = conv_id
            self.generation += 1
            return True

    def delete(self, conv_id):
        conversations.delete(conv_id)
        if conv_id == self.conv_id:
            return self.reset()
        return True


class Handler(BaseHTTPRequestHandler):
    @property
    def session(self):
        return self.server.session

    def do_GET(self):
        if not self.host_ok():
            return
        url = urlparse(self.path)
        if url.path in ("/", "/index.html"):
            if not self.send_static("index.html"):
                self.send(503, NOT_BUILT, "text/html; charset=utf-8")
            return
        if url.path.startswith("/assets/"):
            if not self.send_static(url.path.lstrip("/")):
                self.send_json(404, {"error": "not found"})
            return
        if url.path == "/info":
            return self.send_json(200, {
                "provider": self.session.provider,
                "mode": self.session.mode,
                "model": self.session.model,
                "providers": [
                    {"name": n, "label": p["label"], "model": p["model"], "missing_key": providers.missing_key(n),
                     "price": p.get("price"), "models": providers.models(n),
                     "thinking": providers.thinking_style(n), "model_prices": p.get("model_prices"),
                     "context_windows": p.get("context_windows"), "source": p.get("source")}
                    for n, p in providers.PROVIDERS.items()
                ],
                "folder": str(tools.WORKSPACE),
                "frontend": {"built": (STATIC / "index.html").is_file(), "folder": str(STATIC)},
                "max_turns": self.session.max_turns,
                "system": loop.SYSTEM,
                "tools": self.session.base_tools,
            })
        if url.path == "/profile":
            return self.send_profile(memory.load(self.session.profile_path))
        if url.path == "/settings":
            return self.send_settings()
        if url.path == "/conversations":
            return self.send_json(200, {"current": self.session.conv_id, "items": conversations.list_all()})
        if url.path == "/compare/status":
            with self.server.compare_status_lock:
                return self.send_json(200, dict(self.server.compare_status))
        if url.path == "/compare/history":
            return self.send_json(200, {"items": compare.list_comparisons()})
        if url.path == "/compare/get":
            try:
                return self.send_json(200, compare.load_comparison(parse_qs(url.query).get("id", [""])[0]))
            except (ValueError, FileNotFoundError):
                return self.send_json(404, {"error": "no saved comparison with that id"})
        if url.path == "/evals/cases":
            only = parse_qs(url.query).get("only", [""])[0]
            keep = ("question", "tools", "answer_has", "judge", "tool_may_not_work")
            return self.send_json(200, {"cases": [{k: c[k] for k in keep if k in c} for c in evals.cases_from_config(only)]})
        if url.path == "/evals/status":
            with self.server.evals_lock:
                return self.send_json(200, dict(self.server.evals_status))
        if url.path == "/evals/history":
            return self.send_json(200, {"runs": evals.history()})
        if url.path == "/evals/get":
            try:
                return self.send_json(200, evals.load_result(parse_qs(url.query).get("id", [""])[0]))
            except (ValueError, FileNotFoundError):
                return self.send_json(404, {"error": "no eval run with that id"})
        if url.path == "/conversations/get":  # a saved conversation, whole, read-only (for Re-run and Compare)
            try:
                return self.send_json(200, conversations.load(parse_qs(url.query).get("id", [""])[0]))
            except (ValueError, FileNotFoundError):
                return self.send_json(404, {"error": "no saved conversation with that id"})
        if url.path == "/events":
            since = int(parse_qs(url.query).get("since", ["0"])[0])
            return self.send_json(200, self.session.snapshot(since))
        self.send_json(404, {"error": "not found"})

    def do_POST(self):
        if not self.host_ok():
            return
        # Only accept JSON: a browser won't send that cross-site without asking us first
        if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            return self.send_json(415, {"error": "send JSON"})
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        if self.path == "/chat":
            text = str(body.get("text", "")).strip()
            if not text:
                return self.send_json(400, {"error": "The message is empty."})
            if not self.session.start(text):
                return self.send_json(409, {"error": "The harness is still working on the last message. Wait for it, or press Esc to stop it."})
            return self.send_json(202, {"ok": True})
        if self.path == "/provider":
            name = body.get("name")
            if name not in providers.PROVIDERS:
                return self.send_json(400, {"error": f"unknown provider {name!r}"})
            try:
                client = self.server.clients.get(name)
            except providers.MissingKey as e:
                return self.send_json(400, {"error": str(e)})
            p = providers.PROVIDERS[name]
            model = body.get("model") or p["model"]
            if model not in providers.models(name):
                return self.send_json(400, {"error": f"{p['label']} has no model {model!r}"})
            if not self.session.switch(name, client, p["label"], model):
                return self.send_json(409, {"error": self.session.busy_reason()})
            return self.send_json(200, {"mode": p["label"], "model": model})
        if self.path == "/profile":
            try:
                facts = memory.save(body.get("facts"), self.session.profile_path)
            except ValueError as e:
                return self.send_json(400, {"error": str(e)})
            return self.send_profile(facts)
        if self.path == "/settings":
            if not isinstance(body, dict):
                return self.send_json(400, {"error": "settings must be an object"})
            current = lab_settings.load(self.session.settings_path)
            current["system"] = current["system"] or loop.SYSTEM
            try:  # only the parts you sent are replaced; the rest stay as they were
                lab_settings.save(merge_settings(current, body), loop.SYSTEM, self.session.base_tools,
                                  self.session.default_permission, self.session.settings_path)
            except ValueError as e:
                return self.send_json(400, {"error": str(e)})
            return self.send_settings()
        if self.path == "/settings/reset":
            lab_settings.reset(self.session.settings_path)
            return self.send_settings()
        if self.path == "/conversations/restore":
            if not conversations.restore(str(body.get("id", ""))):
                return self.send_json(404, {"error": "nothing to bring back with that id"})
            return self.send_json(200, {"current": self.session.conv_id, "items": conversations.list_all()})
        if self.path in ("/conversations/open", "/conversations/delete"):
            try:
                ok = (self.session.open if self.path.endswith("open") else self.session.delete)(body.get("id"))
            except (ValueError, FileNotFoundError):
                return self.send_json(404, {"error": "no saved conversation with that id"})
            if not ok:
                return self.send_json(409, {"error": self.session.busy_reason()})
            return self.send_json(200, {"current": self.session.conv_id, "items": conversations.list_all()})
        if self.path == "/compare/stop":
            with self.server.compare_status_lock:
                if not self.server.compare_status.get("running"):
                    return self.send_json(409, {"error": "no comparison is running"})
                self.server.compare_cancel.set()
            return self.send_json(200, {"ok": True})
        if self.path == "/compare":
            return self.run_compare(body)
        if self.path == "/rerun":
            return self.run_rerun(body)
        if self.path in ("/rewind/preview", "/rewind"):
            return self.run_rewind(body, preview=self.path.endswith("preview"))
        if self.path == "/evals/stop":
            with self.server.evals_lock:
                if not self.server.evals_status.get("running"):
                    return self.send_json(409, {"error": "no eval run is going"})
                self.server.evals_cancel.set()
            return self.send_json(200, {"ok": True})
        if self.path == "/evals":
            return self.start_evals(body)
        if self.path == "/stop":
            if not self.session.stop():
                return self.send_json(409, {"error": "nothing is running"})
            return self.send_json(200, {"ok": True})
        if self.path == "/approve":
            if not self.session.decide(body.get("id"), body.get("allowed"), always=bool(body.get("always"))):
                return self.send_json(404, {"error": "nothing is waiting for that approval"})
            return self.send_json(200, {"ok": True})
        if self.path == "/reset":
            if not self.session.reset():
                return self.send_json(409, {"error": self.session.busy_reason()})
            return self.send_json(200, {"ok": True})
        self.send_json(404, {"error": "not found"})

    def send_profile(self, facts):
        self.send_json(200, {
            "facts": facts,
            "shared": len(memory.shared(facts)),
            "addition": memory.addition(facts),  # exactly what goes into the system prompt
            "file": str(self.session.profile_path),
        })

    def run_compare(self, body):
        """The same question with up to three setups at once, each from a fresh conversation.

        Body: {text, sides: [{provider, model?, label?, settings?, include_profile?}], include_profile?}.
        `settings` changes the saved settings for that side only (same shape as POST /settings).
        The older {text, providers: [a, b]} still works.
        """
        text = str(body.get("text", "")).strip()
        specs = body.get("sides")
        if specs is None and isinstance(body.get("providers"), list):
            specs = [{"provider": n} for n in body["providers"]]
        if not text or not isinstance(specs, list) or not 1 <= len(specs) <= 3                 or any(not isinstance(x, dict) or x.get("provider") not in providers.PROVIDERS for x in specs):
            return self.send_json(400, {"error": "Send a question and one to three sides, each with a known provider."})
        if not self.server.compare_lock.acquire(blocking=False):
            return self.send_json(409, {"error": "a comparison is already running"})
        try:
            try:
                sides = [self._side(x, x.get("include_profile", body.get("include_profile", False))) for x in specs]
            except (ValueError, providers.MissingKey) as e:
                return self.send_json(400, {"error": str(e)})
            labels = [x["label"] for x in sides]
            for i, x in enumerate(sides):  # the same provider twice: say which is which
                if labels.count(x["label"]) > 1:
                    x["label"] += f" ({'ABC'[i]})"
            repeat = body.get("repeat", 1)
            if not isinstance(repeat, int) or not 1 <= repeat <= 5:
                return self.send_json(400, {"error": "Runs per side must be 1 to 5."})
            status, cancel = self.server.compare_status, self.server.compare_cancel
            cancel.clear()
            with self.server.compare_status_lock:
                status.clear()
                status.update(running=True, started=time.time(), repeat=repeat,
                              sides=[{"label": x["label"], "done": 0} for x in sides])

            def progress(i, done, total):
                with self.server.compare_status_lock:
                    status["sides"][i]["done"] = done

            cid = compare.new_id()
            try:
                results = compare.compare(sides, text, repeat=repeat, progress=progress, cancel=cancel, cid=cid)
            finally:
                with self.server.compare_status_lock:
                    status.clear()
                    status["running"] = False
            compare.save_comparison(cid, text, results, look_for=str(body.get("look_for") or "")[:500], repeat=repeat)
            return self.send_json(200, {"results": to_json(results), "id": cid,
                                        "profile_included": bool(body.get("include_profile"))})
        finally:
            self.server.compare_lock.release()

    def _side(self, spec, include_profile, history=()):
        """Everything one side of a comparison needs: the saved settings with this side's changes on top."""
        name = spec["provider"]
        p = providers.PROVIDERS[name]
        model = spec.get("model") or p["model"]
        if model not in providers.models(name):
            raise ValueError(f"{p['label']} has no model {model!r}")
        saved = lab_settings.load(self.session.settings_path)
        settings = lab_settings.clean(merge_settings(saved, spec.get("settings") or {}), loop.SYSTEM,
                                      self.session.base_tools, self.session.default_permission)
        system = lab_settings.system_prompt(settings, loop.SYSTEM)
        facts = memory.load(self.session.profile_path) if include_profile else []
        system = memory.system_prompt(system, facts)
        found = skills.load_all()
        system = skills.system_prompt(system, settings.get("skills"), found)
        offered = lab_settings.offered_tools(settings, self.session.base_tools)
        tool_list = providers.tools_for(name, [*offered, skills.SKILL_TOOL] if skills.offers_tool(settings.get("skills"), found)
                                        else offered)
        permission = lab_settings.permission(settings, self.session.default_permission)
        label = str(spec.get("label") or p["label"])[:60]
        trim = settings.get("trim") or {}
        prepare = None
        if history and trim.get("enabled") and name != "anthropic":  # trimming only matters with a history
            prepare = lambda msgs, k=trim.get("keep_last", 2): trimming.trim(msgs, keep_last=k)[0]  # noqa: E731
        return {"label": label, "provider": name, "model": model, "client": self.server.clients.get(name),
                "system": system, "tools": tool_list, "permission": permission, "run": self.session.run_tool,
                "hooks": hooks.load(), "cost": lambda usage, n=name, m=model: providers.cost(n, usage, m),
                "history": history, "prepare": prepare,
                "thinking": lab_settings.thinking_spec(settings, providers.thinking_style(name)),
                "cache": lab_settings.caching(settings), "allow_ask": bool(spec.get("allow_ask")),
                "max_tokens": lab_settings.limits(settings)[0], "max_turns": lab_settings.limits(settings)[1],
                "at_once": self.session._at_once(settings), "busy": lab_settings.busy(settings),
                "workflow_on": lab_settings.workflow(settings),
                "extra_tools": lab_settings.extra_tools(settings),  # (run_one starts a Toolbox for each run)
                "config": lab_settings.snapshot(settings, provider=name, label=p["label"], model=model, system=system,
                                                facts_shared=len(memory.shared(facts)), tools=tool_list,
                                                permission=permission, source=self.session.tool_source)}

    def start_evals(self, body):
        """Run config/evals.json in the background; the page polls GET /evals/status. One at a time.

        Body: {provider, model?, repeat (1-5), use_my_settings?, judge?, only?}."""
        name = body.get("provider")
        if name not in providers.PROVIDERS:
            return self.send_json(400, {"error": f"unknown provider {name!r}"})
        model = body.get("model") or providers.PROVIDERS[name]["model"]
        repeat = body.get("repeat", 1)
        if model not in providers.models(name) or not isinstance(repeat, int) or not 1 <= repeat <= 5:
            return self.send_json(400, {"error": "Pick a model from the provider's list and 1 to 5 runs per question."})
        cases = evals.cases_from_config(body.get("only"))
        if not cases:
            return self.send_json(400, {"error": "no questions match"})
        try:
            self.server.clients.get(name)
        except providers.MissingKey as e:
            return self.send_json(400, {"error": str(e)})
        status = self.server.evals_status
        with self.server.evals_lock:
            if status.get("running"):
                return self.send_json(409, {"error": "an eval run is already going"})
            status.clear()
            status.update(running=True, done=0, total=len(cases) * repeat, provider=name, model=model, started=time.time())
            self.server.evals_cancel.clear()

        def progress(done, total):
            with self.server.evals_lock:
                status.update(done=done, total=total)

        def work():
            try:
                run_id = evals.new_run_id()
                result = evals.run_suite(name, cases, model=model, repeat=repeat,
                                         use_my_settings=bool(body.get("use_my_settings")),
                                         judge_with="mock" if body.get("judge", True) else None,
                                         settings_path=self.session.settings_path, clients=self.server.clients,
                                         on_progress=progress, cancel=self.server.evals_cancel, only=body.get("only"),
                                         run_id=run_id)
                evals.save_result(result, run_id=run_id)
                with self.server.evals_lock:
                    status.update(running=False, result={"id": run_id, **result})
            except Exception as e:
                with self.server.evals_lock:
                    status.update(running=False, error=f"{type(e).__name__}: {e}")

        threading.Thread(target=work, daemon=True).start()
        return self.send_json(202, {"ok": True, "total": len(cases) * repeat})

    def run_rerun(self, body):
        """Send a past message again, after the same history, with your current provider and settings.

        Body: {conversation_id, message_seq, include_profile?}. Answers {text, baseline, rerun}: the saved
        run and the new one, shaped like two sides of a comparison. Approvals are blocked, as in Compare.
        """
        try:
            data = conversations.load(body.get("conversation_id"))
            seq = int(body.get("message_seq"))
            text = next(e["text"] for e in data["events"] if e.get("kind") == "user" and e.get("seq") == seq)
        except (ValueError, FileNotFoundError, TypeError):
            return self.send_json(404, {"error": "no saved conversation with that id"})
        except StopIteration:
            return self.send_json(404, {"error": "no message with that seq in the conversation"})
        history = conversations.history_before(data, seq)
        if history is None:
            return self.send_json(409, {"error": "the history before that message was summarised away, "
                                                 "so it can't be sent again exactly as it was"})
        saved = (conversations.run_stats(data, seq).get("config") or {})
        if (saved.get("provider"), saved.get("model")) != (self.session.provider, self.session.model):
            drop_thinking(history)  # another model's reasoning: the current one can't use it
        if not self.server.compare_lock.acquire(blocking=False):
            return self.send_json(409, {"error": "a comparison or re-run is already running"})
        try:
            try:
                side = self._side({"provider": self.session.provider or "mock", "model": self.session.model,
                                   "allow_ask": bool(body.get("allow_ask"))},
                                  body.get("include_profile", True), history=history)
            except (ValueError, providers.MissingKey) as e:
                return self.send_json(400, {"error": str(e)})
            side["label"] = "Current settings"  # (the recorded setup keeps the provider's own name)
            side["name"] = side["model"]  # the saved conversation's title names the model
            side["origin"] = {"side": "Current settings", "kind": "rerun"}
            # Shown as running, so the page can offer Stop, as for a comparison
            status, cancel = self.server.compare_status, self.server.compare_cancel
            cancel.clear()  # (a Stop left over from an earlier comparison mustn't end this one)
            with self.server.compare_status_lock:
                status.clear()
                status.update(running=True, started=time.time(), repeat=1, sides=[{"label": side["label"], "done": 0}])
            cid = compare.new_id()
            try:
                [now] = compare.compare([side], text, prefix="Re-run", cancel=cancel, cid=cid)
            finally:
                with self.server.compare_status_lock:
                    status.clear()
                    status["running"] = False
            baseline = conversations.run_stats(data, seq)
            # Kept with the comparisons, so it can be opened again from Past comparisons
            compare.save_comparison(cid, text, [baseline, now], kind="rerun", conversation=data.get("id"), seq=seq)
            return self.send_json(200, {"text": text, "baseline": to_json(baseline), "rerun": to_json(now), "id": cid})
        finally:
            self.server.compare_lock.release()

    def run_rewind(self, body, preview):
        """Go back to before one of your messages, files too. Body: {seq}, the message's event seq.
        /rewind/preview says what it would do; /rewind does it and answers the message's text."""
        try:
            seq = int(body.get("seq"))
        except (TypeError, ValueError):
            return self.send_json(400, {"error": "send the message's seq"})
        try:
            out = self.session.rewind_preview(seq) if preview else self.session.rewind(seq)
        except KeyError:
            return self.send_json(404, {"error": "no message with that seq in this conversation"})
        except CannotRewind as e:
            return self.send_json(409, {"error": str(e)})
        return self.send_json(200, to_json(out))

    def skills_status(self, s):
        """Your skills setting, the skill files found, and exactly what's added to the system prompt
        with that setting on (so you can see it before turning skills on)."""
        setting = s.get("skills") or {"enabled": False, "mode": "on_demand"}
        found = skills.load_all()
        return {"setting": setting, "found": [{"name": x["name"], "description": x["description"]} for x in found],
                "addition": skills.addition({**setting, "enabled": True}, found), "folder": str(skills.DIR)}

    def hooks_status(self):
        return hooks.load().describe()

    def send_settings(self):
        """Defaults and your changes side by side, so the page can show and reset each one."""
        s = lab_settings.load(self.session.settings_path)
        mine = lab_settings.tools(s, self.session.base_tools)
        self.send_json(200, {
            "system": lab_settings.system_prompt(s, loop.SYSTEM),
            "system_default": loop.SYSTEM,
            "tools": [{
                "name": t["name"],
                "description": t["description"],
                "default_description": base["description"],
                "permission": lab_settings.permission(s, self.session.default_permission)(t["name"]),
                "default_permission": self.session.default_permission(t["name"]),
                "input_schema": t.get("input_schema", {}),
                "source": self.session.tool_source(t["name"]),
            } for t, base in zip(mine, self.session.base_tools)],
            "changed": lab_settings.what_changed(s),
            "trim": s.get("trim") or {"enabled": False, "keep_last": 2},
            "compact": s.get("compact") or {"enabled": False, "over_chars": 40000},
            "thinking": {"enabled": False, "budget": 4000, "effort": "medium", **(s.get("thinking") or {})},
            "cache": s.get("cache") or {"enabled": False},
            "apply": s.get("apply") or "message",
            "limits": dict(zip(("max_tokens", "max_turns"), lab_settings.limits(s))),
            "skills": self.skills_status(s),
            "faults": s.get("faults") or {"busy": False},
            "tools_at_once": s.get("tools_at_once") or {"enabled": False},
            "workflow": s.get("workflow") or {"enabled": False},
            "run_code": s.get("run_code") or {"enabled": False},
            "extra_tools": s.get("extra_tools") or {"enabled": False, "mode": "find"},
            "mcp_problems": self.session.mcp.problems if self.session.mcp else [],
            "hooks": self.hooks_status(),
            "file": str(self.session.settings_path),
        })

    def host_ok(self):
        # Refuse requests addressed to any other host name (stops a web page using a
        # look-alike address to read this server)
        if local_only.addressed_here(self.headers):
            return True
        self.send_json(403, {"error": "use http://127.0.0.1"})
        return False

    def send_json(self, status, body):
        self.send(status, json.dumps(body).encode("utf-8"), "application/json")

    def send_static(self, rel):
        """Serve a file from the built page. False if it isn't there (or points outside the folder)."""
        root = STATIC.resolve()
        path = (root / rel).resolve()
        if not path.is_relative_to(root) or not path.is_file():
            return False
        ctype = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript", "application/json", "image/svg+xml"):
            ctype += "; charset=utf-8"
        # Vite names files in assets/ by their content, so they can be cached for good
        cache = "public, max-age=31536000, immutable" if rel.startswith("assets/") else "no-store"
        self.send(200, path.read_bytes(), ctype, cache=cache)
        return True

    def send(self, status, data, content_type, cache="no-store"):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", cache)
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *args):
        pass


def _block_type(block):
    return block.get("type") if isinstance(block, dict) else getattr(block, "type", None)


def drop_thinking(messages):
    """Remove thinking blocks from the assistant messages (in place); returns how many were removed."""
    dropped = 0
    for m in messages:
        if m.get("role") == "assistant" and isinstance(m.get("content"), list):
            kept = [b for b in m["content"] if _block_type(b) not in ("thinking", "redacted_thinking")]
            dropped += len(m["content"]) - len(kept)
            m["content"] = kept
    return dropped


def merge_settings(current, changes):
    """Apply a partial settings change. Per-tool descriptions and permissions merge one level deep,
    so saving one tool's permission keeps the others."""
    merged = {**current, **changes}
    for key in ("descriptions", "permissions"):
        if isinstance(changes.get(key), dict):
            merged[key] = {**(current.get(key) or {}), **changes[key]}
    return merged


def make_server(session, port, clients=None):
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)  # this computer only
    server.session = session
    server.clients = clients or Clients()
    server.compare_lock = threading.Lock()  # one comparison at a time
    server.compare_status_lock = threading.Lock()  # guards compare_status (the page polls it while one runs)
    server.compare_status = {"running": False}
    server.compare_cancel = threading.Event()  # set by POST /compare/stop: each run stops at its next step
    server.evals_lock = threading.Lock()    # guards evals_status (one eval run at a time)
    server.evals_status = {"running": False}
    server.evals_cancel = threading.Event()  # set by POST /evals/stop: questions not yet started are skipped
    return server


def start_mock():
    """Run mock_server in this process on a free port; return a client that uses it (with its key)."""
    mock, key = mock_server.serve()
    return providers.make_client("mock", base_url=f"http://127.0.0.1:{mock.server_port}", api_key=key)


class Clients:
    """Makes each provider's client once, the first time it's chosen, then reuses it."""

    def __init__(self):
        self.made = {}
        self.lock = threading.Lock()

    def get(self, name):
        with self.lock:
            if name not in self.made:
                self.made[name] = start_mock() if name == "mock" else providers.make_client(name)
            return self.made[name]


def main():
    parser = argparse.ArgumentParser(description="Web page for the harness")
    parser.add_argument("--provider", choices=providers.PROVIDERS, default="mock")
    parser.add_argument("--real", action="store_true", help="same as --provider anthropic")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    name = "anthropic" if args.real else args.provider

    os.chdir(paths.ROOT)  # (file tools use the workspace folder whatever the current folder is)
    clients = Clients()
    p = providers.PROVIDERS[name]
    mcp = mcp_client.load()  # tools from the servers in mcp_servers.json
    if mcp.tools:
        print(f"MCP: {len(mcp.tools)} tools from {', '.join(sorted(set(mcp.sources.values())))}")
    for problem in mcp.problems:
        print(f"MCP: skipped {problem}")
    session = Session(clients.get(name), p["label"], model=p["model"], provider=name, mcp=mcp)

    conversations.purge_deleted(days=7)  # deleted ones stay a week (Undo, or a rescue by hand), then go
    try:  # then the copies of files that no conversation (deleted ones included) needs any more
        checkpoints.purge(conversations.all_checkpoints())
    except (OSError, ValueError, AttributeError) as e:  # a damaged file: keep every copy rather than guess
        print(f"  !! kept every checkpoint copy: {e}")
    server = make_server(session, args.port, clients)
    # 127.0.0.1, not localhost: some browsers try the IPv6 address first and this listens on IPv4
    print(f"Harness lab on http://127.0.0.1:{args.port}  ({session.mode}; Ctrl+C to stop)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        mcp.close()


if __name__ == "__main__":
    main()
