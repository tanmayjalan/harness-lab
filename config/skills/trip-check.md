---
name: trip-check
description: Checking a city before a trip (its weather now and its local time), in one short answer
---
How to check a city before a trip:

1. Call get_weather for the city, and get_current_time for the city's time zone (for example
   "Europe/Paris" or "Asia/Tokyo"). Ask for both in the same reply if you can.
2. Answer in at most three lines:
   - the weather now, in the unit the user prefers (convert_temperature if needed)
   - the local time there, and whether it's morning, afternoon, evening or night
   - one practical tip that follows from both (for example "it's late there: call tomorrow", or
     "bring a coat")
3. If a tool fails, say which part you couldn't check instead of guessing it.
