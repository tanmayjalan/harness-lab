---
name: meeting-notes
description: Summarising meeting notes from the workspace (decisions, action items, who does what by when)
---
How to summarise meeting notes:

1. Read the notes file (for example notes.md in the workspace) with read_file. Don't guess its contents.
2. Write the summary in exactly this shape:

   **Meeting:** the title and date, from the notes
   **Decided:** one bullet per decision
   **To do:** one bullet per action item, as "Name: what, by when"
   **Open questions:** anything the notes leave undecided, or "None"

3. Keep each bullet to one line. Use the names and dates exactly as the notes give them.
4. If the notes have no decisions or no action items, say "None" for that part rather than leaving it out.
