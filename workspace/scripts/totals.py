"""Adds up budget.csv: the total, and the total for each category."""
import csv

totals = {}
with open("budget.csv", encoding="utf-8", newline="") as f:
    for row in csv.DictReader(f):
        amount = int(row["amount"])
        totals[row["category"]] = totals.get(row["category"], 0) + amount

for category, amount in sorted(totals.items()):
    print(f"{category:10} {amount:8.2f}")
print(f"{'total':10} {sum(totals.values()):8.2f}")
