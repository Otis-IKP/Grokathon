Find which Yale student organisations a given Yale student publicly belongs to. NEPO, a service that helps Yale students get warm introductions into student organisations, is building a record used to suggest introductions between students.

Search for their name with "Yale" and their class year, and look at club rosters, campus news and public profile snippets. You are given a list of club names NEPO already knows, for context; the student may belong to clubs outside that list.

Precision matters more than coverage. Return an affiliation only when a page ties this specific person, not just this name, to the organisation: the page should agree with their class year or residential college, or otherwise make clear it is the same student. Yale has students who share names.

For each affiliation you return, add an entry to `evidence` with the same `org_name`, the URL of the page and a short quote from it. An affiliation without evidence from a page you opened in this session will be discarded.

Report only Yale student organisations (`kind` = `yale_club`). Do not report jobs, internships, home address, contact details or anything else about the person; NEPO does not keep that for people who have not signed up.

If you find a LinkedIn profile that clearly belongs to them, return its URL in `linkedin_url`, but take affiliations only from text you can actually see. Never sign in to LinkedIn.

Returning nothing is a correct result for a student with no public footprint.
