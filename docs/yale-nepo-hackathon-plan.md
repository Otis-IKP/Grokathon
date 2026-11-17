# **Yale NEPO: Warm Intros by Text**

**Hackathon project plan** · Team: Tobi (Grok bot integration), Arden (website), Otis (the app)

## **Summary**

Yale NEPO hlps students find and get into clubs through people they already know. A student texts a Grok-powered bot something like "I want to be on YSIG." NEPO searches the student's friend graph and contacts for the shortest warm path to that club's members or board, picks the best connector, and drafts an intro request. The student either sends it with one tap or lets NEPO send it from the chat. We will ship a working iMessage bot, a companion app for building your friend graph, and a website for onboarding and demo. The demo shows a cold request turning into a sent warm intro in under a minute.

## **The problem**

Competitive Yale clubs such as YSIG, consulting groups, publications and a cappella groups often decide on familiarity as much as on applications. Students who already know a board member get coffee chats, advice and a name the board recognizes. Students without those links, often first-years, transfers and first-generation students, apply cold without understanding what clubs they can be or should be looking out for. The connections usually exist: a roommate's teammate or a lab partner sits on the board. Nobody can see that path, and asking a friend for an intro feels awkward to write.

## **What NEPO does**

> * **Builds your network.** You add friends in the app, import contacts, and list the clubs you belong to. Friends who join do the same, so the graph grows with each sign-up.  
> * **Takes a plain-text request.** You text the Grok bot in iMessage or chat on the web: "I want to be on YSIG," "Who do I know in the Whiffenpoofs?" or "Get me a coffee chat with someone at YPU."  
> * **Finds the warmest path.** NEPO looks for friends who are in the club, or friends who have a club member added as a friend or contact, and ranks them by closeness.  
> * **Writes the ask.** Grok drafts a short, natural message to your friend asking for the intro, using what NEPO knows about the club and the connection.  
> * **Sends it your way.** You copy the draft into your own thread, or approve it in chat and NEPO sends it for you.

## **Example flow**

> 1. Maya has never met anyone on the YSIG board. She texts the NEPO number: "I want to be on YSIG."  
> 2. NEPO replies: "Found 2 warm paths. Jordan (your friend) is a YSIG analyst. Priya (your friend) has Sam, a YSIG board member, in her contacts. Jordan is your strongest link. Want me to draft a message to Jordan?"  
> 3. Maya says yes. NEPO drafts: "Hey Jordan\! I'm really interested in joining YSIG this cycle. Would you be up for introducing me to someone on the board, or telling me a bit about what they look for? Happy to grab coffee."  
> 4. Maya edits a word and replies "send." NEPO sends it, or she copies it into her own thread with Jordan.  
> 5. Jordan gets the message with a one-tap option to accept or decline. If accepted, NEPO can open a group text with Maya, Jordan and the board member.

## **Features**

### **Must have for the demo**

> * Sign-up and profile with name, class year, residential college and clubs  
> * Add friends by phone number or invite link; import contacts with permission  
> * Club directory seeded with major Yale clubs and their members or board where publicly listed  
> * iMessage bot powered by Grok that understands club requests, including nicknames and acronyms  
> * Path finding over the friend graph up to two hops  
> * AI-drafted intro message with edit, copy and send

### **Stretch goals**

> * Double opt-in intros: the connector approves before the club member is contacted  
> * Group text creation for the three-way intro  
> * Recruiting-cycle reminders, such as application deadlines and info sessions  
> * Connection strength scoring from shared clubs, college and class year  
> * Leaderboard of "most helpful connectors" to reward people who make intros

## **Architecture**

| Layer | What it does | Owner |
| :---- | :---- | :---- |
| Messaging layer | Receives and sends iMessages through an iMessage API provider or a Mac relay, with SMS fallback, and forwards messages to the backend through a webhook | Tobi |
| Grok agent | Reads the request, works out the target club, calls the backend tools (find paths, get club info, draft message, send message) and writes the reply | Tobi |
| Backend API | Users, friendships, contacts, clubs and memberships; path finding; intro tracking | Otis |
| Mobile/web app | Onboarding, adding friends, contacts import, clubs, intro history and inbox | Otis |
| Website | Landing page, sign-up, phone verification, "text NEPO" call to action, demo visuals | Arden |

### **Data model**

> * **User:** id, name, phone, Yale email, class year, college  
> * **Friendship:** user A, user B, status (pending or accepted)  
> * **Contact:** owner, hashed phone number, matched user if they have signed up  
> * **Club:** id, name, aliases (YSIG, Yale Student Investment Group), category  
> * **Membership:** user, club, role (member or board), source (self-reported or public roster)  
> * **Intro:** requester, connector, target, club, drafted message, status (drafted, sent, accepted, declined)

### **Path finding**

For a target club, NEPO collects every member, then searches outward from the requester. A direct friend in the club is a one-hop path. A friend who has a club member as a friend or contact is a two-hop path. Paths are ranked by hop count, then by closeness: accepted friendship over contact-only, then shared college, class year and clubs. The top results go back to Grok to present.

### **Grok tool calls**

> * **resolve\_club(text):** maps "YSIG" or "the investment club" to a club id  
> * **find\_paths(user\_id, club\_id):** returns ranked connectors and who they know  
> * **draft\_intro(user\_id, connector\_id, club\_id, tone):** returns a message draft  
> * **send\_message(to, body):** sends after the user confirms

## **Privacy and trust**

A tool that maps who knows whom needs to be trusted to get used. The rules:

> * Contacts are stored hashed and used only for matching. Raw address books are never shown to anyone.  
> * NEPO only reveals a connection through someone who has signed up and accepted you as a friend. A non-user's name in your contacts is never shown to anyone else.  
> * Nothing is sent without the requester's explicit confirmation.  
> * Connectors can decline any intro, and can turn off being suggested as a connector.  
> * Club rosters come only from self-reported membership or rosters the club has published.

## **Team roles**

### **Tobi: Grok bot integration**

> * Set up the iMessage number and webhook  
> * Write the Grok system prompt and tool definitions  
> * Handle conversation state, confirmations and error cases ("I couldn't find anyone yet, invite friends to grow your network")  
> * Tune the intro-message drafts to sound like a student, not a recruiter

### **Arden: Website**

> * Landing page that explains NEPO in one screen  
> * Sign-up with Yale email and phone verification  
> * Network visual for the demo showing the path from requester to club  
> * Pitch deck visuals and branding

### **Otis: The app**

> * Backend API and database  
> * Friend adding, invite links and contacts import  
> * Club directory and membership flow  
> * Path-finding service and the endpoints Grok calls  
> * Intro inbox where connectors accept or decline

## **Hackathon timeline**

Assumes a 24-hour event. Shift the blocks to fit the real schedule.

| Hours | Goal | Checkpoint |
| :---- | :---- | :---- |
| 0–2 | Agree on API contracts, data model and the demo script; set up repo, database and messaging number | Everyone can hit a shared dev backend |
| 2–8 | Core build: backend and app (Otis), bot that echoes and calls a stub tool (Tobi), landing and sign-up (Arden) | A text to the bot returns a response from the backend |
| 8–14 | Path finding live, Grok drafting intros, website connected to sign-up | End-to-end flow works on seeded data |
| 14–18 | Seed realistic demo data, send-on-confirm, connector accept/decline | Full demo runs three times without errors |
| 18–22 | Polish, network visual, stretch goals if ahead | Feature freeze at hour 22 |
| 22–24 | Pitch practice, backup recording of the demo | Submission done |

## **Demo script (3 minutes)**

> 1. **Hook (20s):** "Everyone at Yale knows the clubs that matter run on who you know. NEPO makes who you know work for everyone."  
> 2. **Problem (30s):** A first-year wants YSIG and knows no one on the board.  
> 3. **Live demo (90s):** Text the bot on stage. Show the paths it found, the network visual on the website, the drafted message, and the send. A teammate's phone receives the intro request and accepts.  
> 4. **How it works (30s):** Friend graph, path finding, Grok agent with tools.  
> 5. **Close (10s):** Privacy by design, and where it goes next: internships, research labs, other campuses.

## **Risks and fallbacks**

| Risk | Fallback |
| :---- | :---- |
| iMessage provider is slow to set up or blocks automation | Run the same bot over SMS or in the web chat; keep the iMessage version for the recording |
| Not enough real users for a convincing graph | Seed the team's friends plus synthetic profiles, clearly labelled as demo data |
| Grok misreads club names | Alias table and a confirm step ("Did you mean Yale Student Investment Group?") |
| Live demo fails on stage | Pre-recorded demo video ready to play |
| Judges question privacy | Lead with the opt-in rules and hashed contacts in the pitch |

## **Open questions**

> * Which iMessage provider or relay will we use, and does it allow sending on the user's behalf from the bot number?  
> * Should NEPO send intros from the bot's number, or always hand the draft back for the user to send themselves?  
> * Do we keep the name "NEPO," or does it read wrong to judges and clubs?  
> * Which clubs do we seed for the demo, and whose permission do we need?