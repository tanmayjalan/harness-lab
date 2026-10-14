"""Forty small office tools for Northwind Labs, the made-up company in workspace/handbook.

They exist to make the tool list long. Every tool description goes with every model call, so forty more
tools make each call bigger and the model's choice harder (see features/tool_search.py, where find_tool
loads a tool's details only when the model needs it).

Each one is pretend: it checks that it got what it needs and answers with canned text. Nothing is booked,
ordered or sent, and nothing touches your files.
"""

PRACTICE = "(Practice only: nothing was really done.)"


def _tool(name, description, properties, required, reply):
    """A tool's description for the model, and its canned reply (a template filled from the input)."""
    schema = {"type": "object", "properties": properties, "required": list(required)}
    return {"name": name, "description": description, "input_schema": schema}, reply


def _text(description):
    return {"type": "string", "description": description}


def _number(description):
    return {"type": "number", "description": description}


def _choice(options, description=""):
    out = {"type": "string", "enum": list(options)}
    if description:
        out["description"] = description
    return out


DATE = "YYYY-MM-DD"

_TABLE = [
    # Rooms and desks
    _tool("book_room", "Book a meeting room at the Northwind Labs office for a date and time. Rooms A-F hold "
          "4 to 12 people; give how many are coming so a big enough room is held.",
          {"room": _text("Room letter, A to F"), "date": _text(DATE), "start_time": _text("HH:MM, 24-hour"),
           "people": _number("How many are coming"), "minutes": _number("How long; default 60")},
          ["room", "date", "start_time", "people"],
          "Booked room {room} on {date} at {start_time} for {people} people. Booking NW-R4821."),
    _tool("cancel_room_booking", "Cancel a meeting room booking by its booking number.",
          {"booking": _text("e.g. NW-R4821")}, ["booking"], "Cancelled booking {booking}."),
    _tool("list_free_rooms", "List the meeting rooms that are free at a date and time.",
          {"date": _text(DATE), "start_time": _text("HH:MM, 24-hour"), "people": _number("At least this many seats")},
          ["date", "start_time"], "Free on {date} at {start_time}: room B (6 seats), room E (12 seats)."),
    _tool("book_desk", "Reserve a hot desk for a day. Desks are first come, first served after 10:00.",
          {"date": _text(DATE), "floor": _number("Floor 1-4")}, ["date"], "Desk 3.14 is yours on {date}."),
    _tool("report_room_problem", "Report something wrong in a meeting room: a broken screen, no chairs, too cold.",
          {"room": _text("Room letter"), "problem": _text("What is wrong")}, ["room", "problem"],
          "Reported for room {room}: {problem}. Facilities will look today."),
    # Leave and time
    _tool("request_leave", "Ask for time off: annual, sick, parental or unpaid leave, from one date to another. "
          "Your manager approves it.",
          {"start_date": _text(DATE), "end_date": _text(DATE),
           "kind": _choice(["annual", "sick", "parental", "unpaid"]), "note": _text("Optional note for your manager")},
          ["start_date", "end_date", "kind"], "Asked for {kind} leave from {start_date} to {end_date}. Waiting for your manager."),
    _tool("check_leave_balance", "How many days of annual leave you have left this year.",
          {"year": _number("Default: this year")}, [], "You have 14 days of annual leave left."),
    _tool("submit_timesheet", "Submit your hours for a week (contractors and hourly staff). Due every Friday.",
          {"week_start": _text("The Monday, " + DATE), "hours": _number("Total hours worked")},
          ["week_start", "hours"], "Timesheet for the week of {week_start} submitted: {hours} hours."),
    _tool("log_overtime", "Record overtime worked on a day, with the reason, for time off in lieu.",
          {"date": _text(DATE), "hours": _number("Extra hours"), "reason": _text("Why")},
          ["date", "hours", "reason"], "Logged {hours} hours of overtime on {date}."),
    _tool("list_public_holidays", "The public holidays the office is closed on, for a year and country.",
          {"year": _number("Default: this year"), "country": _text("Default: the office's country")}, [],
          "Closed on: 1 Jan, Good Friday, Easter Monday, 1 May, 25-26 Dec."),
    # Supplies and equipment
    _tool("order_supplies", "Order office supplies (paper, pens, notebooks, sticky notes, printer toner) to your floor.",
          {"item": _text("What to order"), "quantity": _number("How many")}, ["item", "quantity"],
          "Ordered {quantity} x {item}. Delivered to your floor in 2 working days."),
    _tool("request_equipment", "Ask for work equipment: a monitor, keyboard, headset, chair or laptop stand.",
          {"item": _text("What you need"), "reason": _text("Why")}, ["item", "reason"],
          "Asked for: {item}. IT replies within 3 working days."),
    _tool("return_equipment", "Book the return of company equipment by its asset tag, e.g. when leaving.",
          {"asset_tag": _text("The sticker number, e.g. NW-0042")}, ["asset_tag"],
          "Return of {asset_tag} booked. Bring it to reception."),
    _tool("report_broken_equipment", "Report broken company equipment by its asset tag.",
          {"asset_tag": _text("The sticker number"), "problem": _text("What is wrong")}, ["asset_tag", "problem"],
          "Repair ticket opened for {asset_tag}: {problem}."),
    _tool("order_business_cards", "Order a box of business cards with your name and job title.",
          {"name": _text("Name as printed"), "title": _text("Job title as printed")}, ["name", "title"],
          "Ordered business cards for {name}, {title}."),
    # Access and security
    _tool("reset_badge", "Reset your office access badge when it stops opening doors, or block a lost one.",
          {"reason": _choice(["not working", "lost", "stolen"]), "employee_id": _text("Optional")}, ["reason"],
          "Badge reset ({reason}). Collect a new one at reception if it was lost."),
    _tool("request_visitor_pass", "Register a visitor so reception has a pass ready. Visitors are accompanied at all times.",
          {"visitor_name": _text("Full name"), "date": _text(DATE), "host": _text("Who they are visiting")},
          ["visitor_name", "date"], "Visitor pass ready for {visitor_name} on {date}."),
    _tool("request_building_access", "Ask for access to a restricted area: the server room, the lab or the roof.",
          {"area": _text("Which area"), "reason": _text("Why")}, ["area", "reason"],
          "Asked for access to {area}. Security replies within a day."),
    _tool("report_lost_item", "Report something you lost in the office, or ask lost and found about it.",
          {"item": _text("What"), "where": _text("Where you last had it")}, ["item"],
          "Reported lost: {item}. Lost and found will email you."),
    _tool("report_security_incident", "Report a security incident: a phishing email, a tailgater, a lost laptop.",
          {"summary": _text("What happened"), "severity": _choice(["low", "medium", "high"])}, ["summary", "severity"],
          "Security incident logged ({severity}): {summary}. The security team will contact you."),
    # IT
    _tool("reset_password", "Send a password reset link for a work system (email, VPN, HR portal).",
          {"system": _text("Which system")}, ["system"], "A reset link for {system} was sent to your phone."),
    _tool("request_software", "Ask for a software licence or an app to be installed on your laptop.",
          {"software": _text("Name"), "reason": _text("Why")}, ["software", "reason"],
          "Asked for {software}. IT replies within 2 working days."),
    _tool("open_it_ticket", "Open a ticket with the IT help desk for anything not covered by another tool.",
          {"summary": _text("The problem"), "urgency": _choice(["low", "normal", "urgent"])}, ["summary"],
          "IT ticket NW-IT-5517 opened: {summary}."),
    _tool("check_it_ticket", "The status of an IT help desk ticket.",
          {"ticket": _text("e.g. NW-IT-5517")}, ["ticket"], "{ticket}: in progress, assigned to the help desk."),
    _tool("request_vpn_access", "Ask for VPN access to work from outside the office.",
          {"reason": _text("Why")}, ["reason"], "VPN access requested. Setup steps will arrive by email."),
    # Facilities
    _tool("check_parking", "How many spaces are free in the office car park on a date.",
          {"date": _text(DATE)}, ["date"], "On {date}: 7 of 40 spaces free."),
    _tool("book_parking", "Reserve a space in the office car park for a day.",
          {"date": _text(DATE), "plate": _text("Car number plate")}, ["date", "plate"],
          "Space P-12 reserved on {date} for {plate}."),
    _tool("report_facility_issue", "Report a building problem: a leak, a light out, a broken lift, the heating.",
          {"location": _text("Where"), "issue": _text("What is wrong")}, ["location", "issue"],
          "Reported at {location}: {issue}."),
    _tool("request_locker", "Ask for a locker on your floor.",
          {"floor": _number("Floor 1-4")}, ["floor"], "Locker 27 on floor {floor} is yours. The key is at reception."),
    _tool("order_lunch", "Order lunch from the office canteen for a day: vegetarian, vegan, meat or fish.",
          {"date": _text(DATE), "choice": _choice(["vegetarian", "vegan", "meat", "fish"])}, ["date", "choice"],
          "Lunch ordered for {date}: {choice}."),
    # People and pay
    _tool("find_colleague", "Look up a colleague's team, desk and phone extension by name.",
          {"name": _text("Their name")}, ["name"], "{name}: Platform team, desk 2.08, extension 4417."),
    _tool("update_home_address", "Change the home address on your HR record.",
          {"address": _text("The new address")}, ["address"], "Home address updated."),
    _tool("request_payslip", "Get a copy of your payslip for a month.",
          {"month": _text("YYYY-MM")}, ["month"], "Your payslip for {month} was sent to your work email."),
    _tool("enrol_training", "Sign up for a training course from the Northwind Labs catalogue.",
          {"course": _text("Course name")}, ["course"], "You're enrolled in {course}."),
    _tool("submit_feedback", "Send anonymous feedback to People & Culture about any topic.",
          {"topic": _text("What it's about"), "text": _text("Your feedback")}, ["topic", "text"],
          "Feedback on {topic} sent anonymously."),
    # Travel and events
    _tool("book_travel", "Ask the travel desk to book a work trip: train or flights and a hotel.",
          {"destination": _text("City"), "depart_date": _text(DATE), "return_date": _text(DATE)},
          ["destination", "depart_date", "return_date"],
          "Travel request sent: {destination}, {depart_date} to {return_date}. The travel desk will email options."),
    _tool("request_travel_advance", "Ask for money in advance for a work trip's costs.",
          {"amount": _number("How much"), "currency": _text("e.g. EUR"), "trip": _text("Which trip")},
          ["amount", "currency", "trip"], "Advance of {amount} {currency} requested for {trip}."),
    _tool("register_for_event", "Sign up for a company event: the all-hands, a team day or the summer party.",
          {"event": _text("Which event")}, ["event"], "You're registered for {event}."),
    _tool("book_company_car", "Reserve one of the two company cars for a day trip.",
          {"date": _text(DATE), "destination": _text("Where to")}, ["date", "destination"],
          "Company car 1 reserved on {date} for a trip to {destination}."),
    _tool("request_mentor", "Ask to be matched with a mentor on a topic.",
          {"topic": _text("What you'd like help with")}, ["topic"],
          "Mentor request sent for {topic}. People & Culture will introduce you."),
]


class _Blank(dict):
    def __missing__(self, key):  # an optional detail the model left out
        return "?"


def _handler(definition, reply):
    def run(**args):
        missing = [k for k in definition["input_schema"]["required"] if args.get(k) in (None, "")]
        unknown = sorted(set(args) - set(definition["input_schema"]["properties"]))
        if missing or unknown:
            problems = ([f"missing {', '.join(missing)}"] if missing else []) + (
                [f"no such field: {', '.join(unknown)}"] if unknown else [])
            raise ValueError(f"{definition['name']}: {'; '.join(problems)}")
        return f"{reply.format_map(_Blank(args))} {PRACTICE}"
    return run


TOOLS = [definition for definition, _ in _TABLE]
HANDLERS = {definition["name"]: _handler(definition, reply) for definition, reply in _TABLE}
