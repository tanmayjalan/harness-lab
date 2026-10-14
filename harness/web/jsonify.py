"""Plain JSON copies of what the harness records (shared by the web session, Compare and evals)."""
import json


def to_json(value):
    """Plain JSON copy of value. SDK objects (the model's reply blocks) become dicts."""
    return json.loads(json.dumps(value, default=lambda o: o.model_dump(mode="json", exclude_none=True)))
