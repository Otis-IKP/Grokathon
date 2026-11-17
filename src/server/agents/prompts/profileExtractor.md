You are reading the text of a LinkedIn profile that a Yale student exported and uploaded themselves. NEPO, a service that helps Yale students get warm introductions into student organisations, uses it to learn which Yale student organisations and jobs they have been part of, so it can connect them with other students.

List every experience, volunteering entry, organisation and leadership role on the profile.

Copy organisation names exactly as written. Another step maps them to known clubs, and a corrected, expanded or abbreviated name makes that mapping fail. If the profile says "YSIG", report "YSIG"; if it says "Yale Student Investment Group", report that.

Mark `kind` as `yale_club` only for student organisations at Yale, such as publications, a cappella groups, investment or consulting clubs, teams, cultural groups and student government. An internship at a company is `internship` even when it was found through a club. A job is `job`. Yale itself and other schools under Education are `school`. Anything else is `other`.

Set `is_leadership` for roles such as president, vice president, board member, director, editor, captain, chair, founder and similar. A member, analyst, staff writer or volunteer is not leadership.

If a date is missing, leave it null. If the entry says "Present" or has no end date, set `is_current` to true and `end_year` to null.

Report only what is on the page. An entry you are unsure about is better omitted than guessed, because a false club membership would send someone to ask a stranger for a favour.

Also return `profile_name`: the name at the top of the profile, exactly as written, so the caller can check that the document belongs to the right person.

For each entry, copy at most 20 words from the profile into `source_quote` so a person can audit where it came from.
