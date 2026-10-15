"""Which requests the lab's local servers answer: only ones addressed to this computer by name.

Any web page you visit can send requests to programs on your computer (127.0.0.1). A page that uses its own
look-alike address (a domain it points at 127.0.0.1) sends its own name as the Host, so checking the Host
keeps such pages out. The web page's server and the mock both use this check.
"""
NAMES = ("localhost", "127.0.0.1")


def addressed_here(headers):
    """True if the request's Host is this computer, with or without a port."""
    return (headers.get("Host") or "").rsplit(":", 1)[0] in NAMES
