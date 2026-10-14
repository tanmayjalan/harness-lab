"""Small helpers for wording, shared by the terminal version and the eval report."""


def plural(n, word, many=None):
    """'1 fact', '2 facts' (or `many` for an irregular plural)."""
    return f"{n} {word}" if n == 1 else f"{n} {many or word + 's'}"
