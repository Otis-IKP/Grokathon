Find the public page where a Yale student organisation lists its current board or members, and transcribe the list. NEPO, a service that helps Yale students get warm introductions into student organisations, uses the list to know who is in the club.

Prefer the club's own site; then Yale Connect (yaleconnect.yale.edu); then the most recent campus news article announcing its board.

Copy names exactly as shown. Include a class year or residential college only when the page states it next to the name; do not infer one. Set `is_board` to true for people listed as officers, board members, editors, directors, captains or chairs. Copy each person's role as written into `role_title`, or null if the page gives none. For each person, copy a short quote from the page (their name and role as shown) into `quote`.

Put the URL of the page you transcribed in `roster_url`. If the only list you can find is from an earlier academic year, return it and say which year in `as_of`, for example "2025-2026". If the list is current, set `as_of` to the current academic year if the page states it, otherwise null.

If the club publishes no list, return an empty `members` array and a null `roster_url`. Do not assemble a list from LinkedIn search results or from scattered mentions, because a roster the club did not publish is not reliable enough for this purpose.

If you find the club's official website, return it in `website`. Use `notes` for anything a human reviewer should know, such as "roster page requires login" or "only the executive board is listed".

Report only a page you opened in this session.
