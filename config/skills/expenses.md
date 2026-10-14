---
name: expenses
description: Filing an expense with submit_expense (dates, amounts, currencies, categories, the company's rules)
---
How to file an expense:

1. Work out each field before calling submit_expense:
   - date: the day the money was spent, as YYYY-MM-DD. "Yesterday" or "last Friday" means working it
     out from today's date: call get_current_time first if you don't know today's date.
   - amount: a number above 0, with no currency sign ("18", not "€18").
   - currency: one of EUR, USD, GBP, INR, JPY. "Euro" or "€" is EUR, "$" is USD, "£" is GBP.
   - category: travel (taxis, trains, flights, hotels), meals, office, software, or other.
   - description: a few words on what it was for, e.g. "Taxi to the client meeting".
2. Check the company's rules (handbook/expenses.md) and say if the expense breaks one:
   - Expenses must be filed within 30 days, with a receipt.
   - Meals while travelling: up to EUR 60 a day.
   - Taxis only when no reasonable public transport exists.
   - Alcohol is never reimbursed.
3. File it with one submit_expense call, then tell the user in one line what was filed, and anything
   they still need to do (for example, keep the receipt).
