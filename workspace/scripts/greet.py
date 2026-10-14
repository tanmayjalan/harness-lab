"""Greets each person on a list, and says good morning or good evening depending on the time."""
import datetime

PEOPLE = ["Priya", "Marco", "Lena"]


def greeting(hour):
    return "Good morning" if hour < 12 else "Good evening"


def main():
    hour = datetime.datetime.now().hour
    for name in PEOPLE:
        print(f"{greeting(hour)}, {name}!")


if __name__ == "__main__":
    main()
