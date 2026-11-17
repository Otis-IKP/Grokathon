# Shared API contract (Tobi ↔ Otis)

The Node bot in `messaging/` uses the REST contract in `messaging/README.md` (`GET /paths`, `POST /intros`, and the rest of that list). The routes below are the earlier Python bot contract. Match `messaging/README.md` if you are wiring Otis's API to the Grok bot we are demoing.



Base: `BACKEND_BASE_URL` (default `http://localhost:8000`)

Auth: optional `Authorization: Bearer <BACKEND_API_KEY>`

## Tools Grok calls (bot → backend)

### POST `/tools/resolve_club`
```json
{ "text": "YSIG" }
```
Response:
```json
{
  "ok": true,
  "club": {
    "id": "ysig",
    "name": "Yale Student Investment Group",
    "aliases": ["YSIG", "investment club"],
    "category": "finance"
  }
}
```

### POST `/tools/find_paths`
```json
{ "user_id": "user_maya", "club_id": "ysig", "limit": 3 }
```
Response:
```json
{
  "ok": true,
  "club": { "id": "ysig", "name": "..." },
  "count": 2,
  "paths": [
    {
      "hops": 1,
      "score": 100,
      "reason": "...",
      "connector": { "id": "user_jordan", "name": "Jordan Lee", "phone": "+1...", "relation": "friend" },
      "target": { "id": "user_jordan", "name": "Jordan Lee", "role": "member" }
    }
  ]
}
```

### POST `/tools/draft_intro`
```json
{
  "user_id": "user_maya",
  "connector_id": "user_jordan",
  "club_id": "ysig",
  "tone": "casual",
  "notes": ""
}
```
Response:
```json
{
  "ok": true,
  "intro_id": "intro_1",
  "to_name": "Jordan Lee",
  "to_phone": "+12035550101",
  "body": "Hey Jordan! ...",
  "from_name": "Maya Chen"
}
```

### GET `/users/lookup?phone=+1...` or `?user_id=...`
```json
{ "ok": true, "user": { "id": "user_maya", "name": "Maya Chen", "phone": "+1...", "class_year": 2029, "college": "JE", "clubs": [] } }
```

## Bot inbound / outbound

- Webhook: `POST {WEBHOOK_BASE_URL}/webhooks/{provider}`
- Local chat: `POST http://localhost:8787/chat` with `{ "text": "I want YSIG" }`
- Health: `GET http://localhost:8787/health`

Until Otis's API is up, set `USE_STUB_BACKEND=true` (default). Seeded demo matches the Maya → Jordan / Priya → Sam YSIG story in the plan.
