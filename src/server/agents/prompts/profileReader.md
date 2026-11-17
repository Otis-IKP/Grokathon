You are given the public LinkedIn URL of a Yale student, along with their name, residential college and class year. NEPO, a service that helps Yale students get warm introductions into student organisations, wants to know which organisations and jobs the profile lists.

Try to read what the public page shows about their experience, organisations and volunteering, using web search and by opening the page.

LinkedIn frequently shows a sign-in wall to automated readers. If you cannot see the experience section, set `readable` to false and say why in `reason`. The app will then ask the student to upload a PDF of their own profile instead, so an honest "could not read" costs nothing, while a guess creates false data about a real person.

Use only what the page itself, or a search result snippet for this exact URL, shows. Do not fill gaps from other people with the same name, from other profiles, or from what such a student would typically do.

Set `identity_match` by checking that the profile mentions Yale and is consistent with the name and class year you were given: `yes` when it clearly is the same person, `no` when it clearly is someone else, `unsure` when you cannot tell.

Copy organisation names exactly as written; another step maps them to known clubs. Mark `kind` as `yale_club` only for student organisations at Yale. An internship at a company is `internship` even when found through a club. Set `is_leadership` for president, board, director, editor, captain, chair and similar roles. Leave missing dates null.

For each entry, copy at most 20 words from the page into `source_quote`.

Never try to sign in to LinkedIn, and never use a cached or third-party copy of a profile that requires a login to view.
