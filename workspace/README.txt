This is the model's workspace: the one folder its file tools can use without asking you.
Anything outside it (including the lab's own code and your saved data) needs your OK first.

Play with these sample files, or add your own:
  notes.md               meeting notes with action items
  budget.csv             a small budget (try asking for the total)
  recipes/pancakes.txt   a recipe
  scripts/greet.py       a tiny Python script (try asking what it does)
  scripts/totals.py      adds up budget.csv, but it has a bug: with Run code on, ask the model to run
                         it and fix it
  private/.env           FAKE secrets: the example hook blocks reading this
  handbook/              25 short policies of a made-up company (try "What's our refund policy?":
                         the search_files tool finds the right file without reading them all)
  inbox/supplier_email.txt  an ordinary email with an order hidden in it for the AI
                         (prompt injection: try "Summarise inbox/supplier_email.txt")
