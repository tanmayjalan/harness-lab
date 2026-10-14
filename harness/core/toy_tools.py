"""Practice tools with no side effects: nothing here touches your files.

They give the model more to do, so you can watch it pick tools and chain them,
for example get_weather (Celsius) then convert_temperature (to Fahrenheit).

get_weather is the one that uses the internet: it asks Open-Meteo (open-meteo.com, free,
no key) for the real current weather, and its result lists the exact web requests it made,
so you can follow the city from the model's tool call, out to the web and back.
"""
import ast
import datetime
import json
import operator
import random
import urllib.parse
import urllib.request
import zoneinfo


def convert_temperature(value, from_unit, to_unit):
    to_celsius = {"celsius": lambda v: v, "fahrenheit": lambda v: (v - 32) * 5 / 9, "kelvin": lambda v: v - 273.15}
    from_celsius = {"celsius": lambda c: c, "fahrenheit": lambda c: c * 9 / 5 + 32, "kelvin": lambda c: c + 273.15}
    from_unit, to_unit = from_unit.lower(), to_unit.lower()
    if from_unit not in to_celsius or to_unit not in from_celsius:
        raise ValueError("units must be celsius, fahrenheit or kelvin")
    c = to_celsius[from_unit](float(value))
    if c < -273.15:
        raise ValueError(f"{value} {from_unit} is below absolute zero")
    return f"{value} {from_unit} = {round(from_celsius[to_unit](c), 2)} {to_unit}"


# The calculator walks the parsed expression itself instead of using eval(),
# so it can only do arithmetic, never run code.
_OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv,
        ast.FloorDiv: operator.floordiv, ast.Mod: operator.mod, ast.Pow: operator.pow,
        ast.USub: operator.neg, ast.UAdd: operator.pos}


def _evaluate(node):
    if isinstance(node, ast.Constant) and type(node.value) in (int, float):
        return node.value
    if isinstance(node, ast.UnaryOp) and type(node.op) in _OPS:
        return _OPS[type(node.op)](_evaluate(node.operand))
    if isinstance(node, ast.BinOp) and type(node.op) in _OPS:
        left, right = _evaluate(node.left), _evaluate(node.right)
        if isinstance(node.op, ast.Pow) and abs(right) > 100:
            raise ValueError("exponent too large (limit 100)")
        return _OPS[type(node.op)](left, right)
    raise ValueError("only numbers, + - * / // % ** and brackets are allowed")


def calculate(expression):
    result = _evaluate(ast.parse(expression.replace(",", ""), mode="eval").body)
    return f"{expression} = {round(result, 10) if isinstance(result, float) else result}"


def get_current_time(timezone="UTC"):
    now = datetime.datetime.now(zoneinfo.ZoneInfo(timezone))  # e.g. "Asia/Kolkata"; unknown names raise an error
    return f"{now:%A %d %B %Y, %H:%M} in {timezone} (UTC{now:%z})"


def roll_dice(sides=6, count=1):
    if not (2 <= sides <= 1000 and 1 <= count <= 20):
        raise ValueError("sides must be 2-1000 and count 1-20")
    rolls = [random.randint(1, sides) for _ in range(count)]
    return f"Rolled {count}d{sides}: {rolls} (total {sum(rolls)})"


GEOCODE = "https://geocoding-api.open-meteo.com/v1/search"
FORECAST = "https://api.open-meteo.com/v1/forecast"

# What Open-Meteo's weather codes mean (WMO codes), in plain words
WEATHER_CODES = {
    0: "clear sky", 1: "mainly clear", 2: "partly cloudy", 3: "overcast", 45: "fog", 48: "freezing fog",
    51: "light drizzle", 53: "drizzle", 55: "heavy drizzle", 56: "freezing drizzle", 57: "freezing drizzle",
    61: "light rain", 63: "rain", 65: "heavy rain", 66: "freezing rain", 67: "freezing rain",
    71: "light snow", 73: "snow", 75: "heavy snow", 77: "snow grains", 80: "light showers", 81: "showers",
    82: "heavy showers", 85: "snow showers", 86: "heavy snow showers", 95: "thunderstorm",
    96: "thunderstorm with hail", 99: "thunderstorm with heavy hail",
}


def fetch_json(url):
    """GET a URL and read the JSON reply. (Tests swap this out, so they never use the internet.)"""
    request = urllib.request.Request(url, headers={"User-Agent": "harness-lab (learning project)"})
    with urllib.request.urlopen(request, timeout=10) as reply:
        return json.loads(reply.read().decode("utf-8"))


def get_weather(city):
    """The real current weather, in two web requests: find the place, then ask for its weather."""
    city = str(city).strip()
    if not city:
        raise ValueError("give a city name")
    find = f"{GEOCODE}?{urllib.parse.urlencode({'name': city, 'count': 1, 'language': 'en', 'format': 'json'})}"
    try:
        places = fetch_json(find).get("results") or []
    except OSError as e:  # no internet, a timeout, the service down: the model gets told why
        raise RuntimeError(f"couldn't reach the weather service ({e})") from e
    if not places:
        raise ValueError(f"no place called {city!r} was found")
    place = places[0]
    name = ", ".join(x for x in (place.get("name"), place.get("admin1"), place.get("country")) if x)
    ask = f"{FORECAST}?" + urllib.parse.urlencode({
        "latitude": place["latitude"], "longitude": place["longitude"], "timezone": "auto",
        "current": "temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code"})
    try:
        now = fetch_json(ask)["current"]
    except OSError as e:
        raise RuntimeError(f"couldn't reach the weather service ({e})") from e
    condition = WEATHER_CODES.get(now.get("weather_code"), f"weather code {now.get('weather_code')}")
    return (f"{name}: {now['temperature_2m']} °C, {condition}, humidity {now['relative_humidity_2m']}%, "
            f"wind {now['wind_speed_10m']} km/h (measured {now['time'].replace('T', ' ')} local time).\n"
            "Live data from Open-Meteo. This tool made two web requests:\n"
            f"1. find the place: GET {find}\n"
            f"2. get its weather: GET {ask}")


CURRENCIES = ["EUR", "USD", "GBP", "INR", "JPY"]
CATEGORIES = ["travel", "meals", "office", "software", "other"]


def submit_expense(date, amount, currency, category, description=""):
    """Practice structured output: the input has a fixed shape, and the harness checks it.
    (With the Anthropic API and "strict": true the API guarantees the shape; other providers don't,
    so the check here is what catches a wrong one.)"""
    problems = []
    try:
        datetime.date.fromisoformat(str(date))
    except ValueError:
        problems.append(f"date must be YYYY-MM-DD, got {date!r}")
    if isinstance(amount, bool) or not isinstance(amount, (int, float)) or amount <= 0:
        problems.append(f"amount must be a number above 0, got {amount!r}")
    if currency not in CURRENCIES:
        problems.append(f"currency must be one of {', '.join(CURRENCIES)}, got {currency!r}")
    if category not in CATEGORIES:
        problems.append(f"category must be one of {', '.join(CATEGORIES)}, got {category!r}")
    if problems:
        raise ValueError("; ".join(problems))
    return (f"Saved (practice only, nothing is stored): {date}, {amount:.2f} {currency}, {category}"
            + (f", {description}" if description else "") + ".")


HANDLERS = {
    "submit_expense": submit_expense,
    "get_weather": get_weather,
    "convert_temperature": convert_temperature,
    "calculate": calculate,
    "get_current_time": get_current_time,
    "roll_dice": roll_dice,
}

TOOLS = [
    {
        "name": "submit_expense",
        "description": "File an expense in the expenses system. Fill every field exactly in the shape given: "
                       "an ISO date, a positive amount, a currency code and a category from the lists.",
        "strict": True,  # Anthropic API: the model's input is guaranteed to match the schema (others ignore it)
        "input_schema": {
            "type": "object",
            "properties": {
                "date": {"type": "string", "description": "YYYY-MM-DD"},
                "amount": {"type": "number", "description": "Above 0"},
                "currency": {"type": "string", "enum": CURRENCIES},
                "category": {"type": "string", "enum": CATEGORIES},
                "description": {"type": "string"},
            },
            "required": ["date", "amount", "currency", "category", "description"],
            "additionalProperties": False,
        },
    },
    {
        "name": "get_weather",
        "description": "The real current weather for a city, in Celsius (live from Open-Meteo).",
        "input_schema": {
            "type": "object",
            "properties": {"city": {"type": "string", "description": "City name, e.g. Paris"}},
            "required": ["city"],
        },
    },
    {
        "name": "convert_temperature",
        "description": "Convert a temperature between celsius, fahrenheit and kelvin.",
        "input_schema": {
            "type": "object",
            "properties": {
                "value": {"type": "number"},
                "from_unit": {"type": "string", "enum": ["celsius", "fahrenheit", "kelvin"]},
                "to_unit": {"type": "string", "enum": ["celsius", "fahrenheit", "kelvin"]},
            },
            "required": ["value", "from_unit", "to_unit"],
        },
    },
    {
        "name": "calculate",
        "description": "Work out an arithmetic expression exactly. Use this instead of doing maths in your head. "
                       "Supports + - * / // % ** and brackets, e.g. (2450 * 17) / 100.",
        "input_schema": {
            "type": "object",
            "properties": {"expression": {"type": "string"}},
            "required": ["expression"],
        },
    },
    {
        "name": "get_current_time",
        "description": "The current date and time in a time zone.",
        "input_schema": {
            "type": "object",
            "properties": {"timezone": {"type": "string", "description": 'IANA name, e.g. "Asia/Kolkata", "Europe/London". Default UTC.'}},
        },
    },
    {
        "name": "roll_dice",
        "description": "Roll dice and return each roll and the total.",
        "input_schema": {
            "type": "object",
            "properties": {
                "sides": {"type": "integer", "description": "Sides per die (default 6)"},
                "count": {"type": "integer", "description": "How many dice (default 1)"},
            },
        },
    },
]
