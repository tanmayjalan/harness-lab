"""Your changes to the harness: the system prompt, tool descriptions, tool permissions, and
switches for trimming, summarising, thinking and prompt caching.

The defaults live in the code (core/loop.py and core/tools.py). data/lab_settings.json only
stores what you changed, so "reset to default" just removes your change.
"""
import json
import pathlib

from harness import paths

PATH = paths.DATA / "lab_settings.json"
RULES = ("allow", "ask", "block")
EFFORTS = ("low", "medium", "high", "xhigh", "max")


def empty():
    return {"system": None, "descriptions": {}, "permissions": {}, "trim": None, "compact": None,
            "thinking": None, "cache": None, "apply": None, "limits": None, "skills": None, "faults": None,
            "tools_at_once": None, "workflow": None, "run_code": None, "extra_tools": None}


def load(path=None):
    path = path or PATH
    try:
        data = json.loads(pathlib.Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        return empty()
    return {**empty(), **data}


def clean(settings, base_system, base_tools, default_permission):
    """Keep only real changes (anything equal to the default is dropped). Raises ValueError on bad input."""
    if not isinstance(settings, dict):
        raise ValueError("settings must be an object")
    defaults = {t["name"]: t.get("description", "") for t in base_tools}
    out = empty()

    system = settings.get("system")
    if system is not None:
        if not isinstance(system, str) or len(system) > 20000:
            raise ValueError("the system prompt must be text, at most 20,000 characters")
        if system.strip() and system.strip() != base_system.strip():
            out["system"] = system.strip()

    for name, text in (settings.get("descriptions") or {}).items():
        if name not in defaults:
            continue  # a tool that no longer exists
        if not isinstance(text, str) or len(text) > 4000:
            raise ValueError(f"the description for {name} must be text, at most 4,000 characters")
        if text.strip() and text.strip() != defaults[name].strip():
            out["descriptions"][name] = text.strip()

    for name, rule in (settings.get("permissions") or {}).items():
        if name not in defaults:
            continue
        if rule not in RULES:
            raise ValueError(f"permission for {name} must be one of {', '.join(RULES)}")
        if rule != default_permission(name):
            out["permissions"][name] = rule

    trim = settings.get("trim")  # off unless you turn it on
    if trim is not None:
        if not isinstance(trim, dict) or not isinstance(trim.get("keep_last", 2), int) \
                or not 0 <= trim.get("keep_last", 2) <= 20:
            raise ValueError("trim must be like {\"enabled\": true, \"keep_last\": 2} (keep_last 0-20)")
        if trim.get("enabled"):
            out["trim"] = {"enabled": True, "keep_last": trim.get("keep_last", 2)}
        elif trim.get("keep_last", 2) != 2:  # off, but keep the number you typed for when you turn it on
            out["trim"] = {"enabled": False, "keep_last": trim["keep_last"]}

    compact = settings.get("compact")  # summarising old history: off unless you turn it on
    if compact is not None:
        over = compact.get("over_chars", 40000) if isinstance(compact, dict) else None
        if not isinstance(over, int) or not 2000 <= over <= 1_000_000:
            raise ValueError("compact must be like {\"enabled\": true, \"over_chars\": 40000} (2,000-1,000,000)")
        if compact.get("enabled"):
            out["compact"] = {"enabled": True, "over_chars": over}
        elif over != 40000:  # off, but keep the number you typed for when you turn it on
            out["compact"] = {"enabled": False, "over_chars": over}

    thinking = settings.get("thinking")  # the model reasons before answering: off unless you turn it on
    if thinking is not None:
        budget = thinking.get("budget", 4000) if isinstance(thinking, dict) else None
        effort = thinking.get("effort", "medium") if isinstance(thinking, dict) else None
        if not isinstance(budget, int) or not 1024 <= budget <= 12000 or effort not in EFFORTS:
            raise ValueError("thinking must be like {\"enabled\": true, \"budget\": 4000, \"effort\": \"medium\"} "
                             "(1,024-12,000 tokens; effort low, medium, high, xhigh or max)")
        if thinking.get("enabled"):
            out["thinking"] = {"enabled": True, "budget": budget, "effort": effort}

    cache = settings.get("cache")  # prompt caching: off unless you turn it on
    if cache is not None:
        if not isinstance(cache, dict):
            raise ValueError("cache must be like {\"enabled\": true}")
        if cache.get("enabled"):
            out["cache"] = {"enabled": True}

    skill = settings.get("skills")  # skills (features/skills.py): off unless you turn them on
    if skill is not None:
        mode = skill.get("mode", "on_demand") if isinstance(skill, dict) else None
        if mode not in ("on_demand", "all_in_prompt"):
            raise ValueError('skills must be like {"enabled": true, "mode": "on_demand"} (or "all_in_prompt")')
        if skill.get("enabled"):
            out["skills"] = {"enabled": True, "mode": mode}

    at_once_setting = settings.get("tools_at_once")  # run a reply's tools at the same time: off unless you turn it on
    if at_once_setting is not None:
        if not isinstance(at_once_setting, dict):
            raise ValueError('tools_at_once must be like {"enabled": true}')
        if at_once_setting.get("enabled"):
            out["tools_at_once"] = {"enabled": True}

    flow = settings.get("workflow")  # answer each message with a fixed chain of agents: off unless you turn it on
    if flow is not None:
        if not isinstance(flow, dict):
            raise ValueError('workflow must be like {"enabled": true}')
        if flow.get("enabled"):
            out["workflow"] = {"enabled": True}

    run = settings.get("run_code")  # offer the run_python tool: off unless you turn it on
    if run is not None:
        if not isinstance(run, dict):
            raise ValueError('run_code must be like {"enabled": true}')
        if run.get("enabled"):
            out["run_code"] = {"enabled": True}

    extra = settings.get("extra_tools")  # 40 office tools, all sent or found on demand: off unless you turn it on
    if extra is not None:
        mode = extra.get("mode", "find") if isinstance(extra, dict) else None
        if mode not in ("all", "find"):
            raise ValueError('extra_tools must be like {"enabled": true, "mode": "find"} (or "all")')
        if extra.get("enabled"):
            out["extra_tools"] = {"enabled": True, "mode": mode}

    faults = settings.get("faults")  # practice: make the service look busy (Settings → Model)
    if faults is not None:
        if not isinstance(faults, dict) or not isinstance(faults.get("busy", False), bool):
            raise ValueError('faults must be like {"busy": true}')
        if faults.get("busy"):
            out["faults"] = {"busy": True}

    # When prompt and tool edits take effect: from your next message (the default) or only from
    # your next conversation, so a conversation keeps one fixed start (better for the cache)
    apply = settings.get("apply")
    if apply is not None:
        if apply not in ("message", "conversation"):
            raise ValueError('apply must be "message" or "conversation"')
        if apply == "conversation":
            out["apply"] = "conversation"

    # Limits: the longest reply (max_tokens) and the most model calls for one message (max_turns)
    lim = settings.get("limits")
    if lim is not None:
        if not isinstance(lim, dict):
            raise ValueError('limits must be like {"max_tokens": 16000, "max_turns": 20}')
        mt, turns = lim.get("max_tokens", DEFAULT_MAX_TOKENS), lim.get("max_turns", DEFAULT_MAX_TURNS)
        if not isinstance(mt, int) or not 256 <= mt <= 16000:
            raise ValueError("the longest reply must be 256-16,000 tokens")
        if not isinstance(turns, int) or not 2 <= turns <= 20:
            raise ValueError("the most calls per message must be 2-20")
        if (mt, turns) != (DEFAULT_MAX_TOKENS, DEFAULT_MAX_TURNS):
            out["limits"] = {"max_tokens": mt, "max_turns": turns}
    return out


DEFAULT_MAX_TOKENS, DEFAULT_MAX_TURNS = 16000, 20


def limits(settings):
    """(longest reply in tokens, most model calls per message)."""
    lim = settings.get("limits") or {}
    return lim.get("max_tokens", DEFAULT_MAX_TOKENS), lim.get("max_turns", DEFAULT_MAX_TURNS)


# Tools that never run alongside others: they write, ask you, start a helper, load a skill, run code, or
# change the tool list (find_tool)
ALONE = {"delegate", "write_file", "remember_fact", "load_skill", "run_python", "find_tool"}


def at_once(settings):
    """For loop.agent: name -> True if that tool may run at the same time as others, or None with the
    setting off (then a reply's tools always run one by one)."""
    if not (settings.get("tools_at_once") or {}).get("enabled"):
        return None
    return lambda name: name not in ALONE


def workflow(settings):
    """Each message goes through a fixed chain of agents (features/workflow.py) instead of one agent."""
    return bool((settings.get("workflow") or {}).get("enabled"))


def run_code(settings):
    """The model may run Python scripts (core/run_code.py): the run_python tool is offered."""
    return bool((settings.get("run_code") or {}).get("enabled"))


def extra_tools(settings):
    """The 40 office tools (features/tool_search.py): "all" (sent on every call), "find" (found on demand with
    find_tool), or None when they're off."""
    extra = settings.get("extra_tools") or {}
    return extra.get("mode", "find") if extra.get("enabled") else None


def busy(settings):
    """The practice switch: the first try of every call fails as if the service were busy."""
    return bool((settings.get("faults") or {}).get("busy"))


def per_conversation(settings):
    return settings.get("apply") == "conversation"


def thinking_budget(settings):
    """Tokens the model may spend thinking, or None when thinking is off."""
    t = settings.get("thinking") or {}
    return t.get("budget") if t.get("enabled") else None


def thinking_spec(settings, style, say_off=False):
    """What loop.agent sends for thinking with a provider of this style ("adaptive" or "budget"), or None.
    `say_off`: with thinking off, tell the model so ({"style": "off"}) rather than send nothing. Some models
    on your own server (gemma4 in Ollama) think unless told not to, which is slow and hides the streaming."""
    t = settings.get("thinking") or {}
    if not t.get("enabled"):
        return {"style": "off"} if say_off else None
    if style == "adaptive":
        return {"style": "adaptive", "effort": t.get("effort", "medium")}
    return {"style": "budget", "budget": t.get("budget", 4000)}


def caching(settings):
    return bool((settings.get("cache") or {}).get("enabled"))


def save(settings, base_system, base_tools, default_permission, path=None):
    path = path or PATH
    settings = clean(settings, base_system, base_tools, default_permission)
    path = pathlib.Path(path)
    if settings == empty():
        path.unlink(missing_ok=True)  # nothing changed: back to the defaults
        return settings
    path.parent.mkdir(parents=True, exist_ok=True)  # data/ may not exist yet
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(settings, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(path)
    return settings


def reset(path=None):
    path = path or PATH
    pathlib.Path(path).unlink(missing_ok=True)


def system_prompt(settings, base_system):
    return settings.get("system") or base_system


def tools(settings, base_tools):
    """The tool list with your descriptions swapped in."""
    changed = settings.get("descriptions") or {}
    return [{**t, "description": changed[t["name"]]} if t["name"] in changed else t for t in base_tools]


def offered_tools(settings, base_tools):
    """The tools the model is offered: the list with your descriptions, without run_python unless Run code
    is on. (Settings → Tools still lists it, so its rule and description stay yours while it's off.)"""
    return [t for t in tools(settings, base_tools) if t["name"] != "run_python" or run_code(settings)]


def permission(settings, default_permission):
    """name -> "allow" / "ask" / "block", using your setting if you made one."""
    chosen = settings.get("permissions") or {}
    return lambda name: chosen.get(name) or default_permission(name)


def what_changed(settings, kept=None):
    """A short list for the page, e.g. ["the system prompt", "1 tool description"]. With a kept
    conversation start (`kept`, from kept_start), the prompt and descriptions are the ones it kept."""
    out = []
    if kept["system_edited"] if kept else settings.get("system"):
        out.append("the system prompt")
    n = len(kept["descriptions"]) if kept else len(settings.get("descriptions") or {})
    if n:
        out.append(f"{n} tool description{'s' if n != 1 else ''}")
    n = len(settings.get("permissions") or {})
    if n:
        out.append(f"{n} permission{'s' if n != 1 else ''}")
    if (settings.get("trim") or {}).get("enabled"):
        out.append("trimming on")
    if (settings.get("compact") or {}).get("enabled"):
        out.append("summarising on")
    if thinking_budget(settings):
        out.append("thinking on")
    if caching(settings):
        out.append("caching on")
    if (settings.get("skills") or {}).get("enabled"):
        out.append("skills on")
    if (settings.get("tools_at_once") or {}).get("enabled"):
        out.append("tools at once")
    if workflow(settings):
        out.append("workflow on")
    if run_code(settings):
        out.append("run code on")
    if extra_tools(settings):
        out.append("extra tools: " + ("all sent" if extra_tools(settings) == "all" else "found on demand"))
    if busy(settings):
        out.append("practice: busy service")
    if per_conversation(settings):
        out.append("prompt fixed per conversation")
    if settings.get("limits"):
        out.append("limits changed")
    return out


def kept_start(frozen, default_system, base_tools):
    """What a kept conversation start sent ("From your next conversation"): whether its prompt was
    edited, which tools it re-described and how many facts about you it carried. Recorded when the
    start was kept; a start kept by an older save has only its text and tools, so it's read from those."""
    keys = ("system_edited", "descriptions", "facts_shared")
    if all(k in frozen for k in keys):
        return {k: frozen[k] for k in keys}
    from harness.features import memory
    system = frozen.get("system") or ""
    defaults = {t["name"]: t.get("description", "") for t in base_tools}
    return {"system_edited": not system.startswith(default_system),
            "descriptions": sorted(t["name"] for t in frozen.get("tools") or []
                                   if t.get("name") in defaults and t.get("description", "") != defaults[t["name"]]),
            "facts_shared": memory.count_in(system)}


def snapshot(settings, *, provider, label, model, system, facts_shared, tools, permission, source, kept=None):
    """Everything that shaped one run, as plain JSON: recorded with each model call so a past
    message can be compared with a re-run. `system` is the full prompt actually sent. With a kept
    conversation start (`kept`), the prompt and descriptions are reported as kept, not as set now."""
    return {
        "provider": provider, "label": label, "model": model,
        "system": system,
        "system_edited": kept["system_edited"] if kept else bool(settings.get("system")),
        "descriptions": kept["descriptions"] if kept else sorted(settings.get("descriptions") or {}),  # tools you re-described
        "permissions": dict(settings.get("permissions") or {}),       # only the ones you changed
        "trim": settings.get("trim"),
        "compact": settings.get("compact"),
        "thinking": settings.get("thinking"),
        "cache": settings.get("cache"),
        "apply": settings.get("apply") or "message",
        "limits": settings.get("limits"),
        "skills": settings.get("skills"),
        "faults": settings.get("faults"),
        "tools_at_once": settings.get("tools_at_once"),
        "workflow": settings.get("workflow"),
        "run_code": settings.get("run_code"),
        "extra_tools": settings.get("extra_tools"),
        "facts_shared": facts_shared,
        "edited": what_changed(settings, kept),
        "tools": [{"name": t["name"], "description": t.get("description", ""), "source": source(t["name"]),
                   "permission": permission(t["name"])} for t in tools],
    }


def badges(config):
    """Short labels for a list item, e.g. ["deepseek-flash", "prompt edited", "trimming on"]."""
    if not config:
        return []
    out = [config.get("model") or "?"]
    if config.get("system_edited"):
        out.append("prompt edited")
    n = len(config.get("descriptions") or [])
    if n:
        out.append(f"{n} description{'s' if n != 1 else ''}")
    n = len(config.get("permissions") or {})
    if n:
        out.append(f"{n} permission{'s' if n != 1 else ''}")
    if (config.get("trim") or {}).get("enabled"):
        out.append("trimming on")
    if (config.get("compact") or {}).get("enabled"):
        out.append("summarising on")
    if (config.get("thinking") or {}).get("enabled"):
        out.append("thinking on")
    if (config.get("cache") or {}).get("enabled"):
        out.append("caching on")
    if (config.get("skills") or {}).get("enabled"):
        out.append("skills on")
    if (config.get("tools_at_once") or {}).get("enabled"):
        out.append("tools at once")
    if (config.get("workflow") or {}).get("enabled"):
        out.append("workflow")
    if (config.get("run_code") or {}).get("enabled"):
        out.append("run code")
    if (config.get("extra_tools") or {}).get("enabled"):
        out.append("40 tools " + ("sent" if config["extra_tools"].get("mode") == "all" else "on demand"))
    if (config.get("faults") or {}).get("busy"):
        out.append("busy service (practice)")
    n = config.get("facts_shared") or 0
    if n:
        out.append(f"{n} fact{'s' if n != 1 else ''}")
    return out
