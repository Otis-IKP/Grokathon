#!/usr/bin/env bash
# Runs the whole bot conversation against local seed data (milestone M2).
#   pnpm db:migrate && pnpm db:seed && pnpm dev      # in another terminal
#   ./scripts/bot-smoke.sh
set -euo pipefail

BASE="${APP_URL:-http://localhost:3000}"
SECRET="${BOT_API_SECRET:-dev-bot-secret}"
MAYA="+12035550101"
NEW_PHONE="+12035550199"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT

bot() { # bot METHOD PATH [JSON]
  if [ "$1" = GET ]; then
    curl -sS -H "Authorization: Bearer $SECRET" "$BASE$2"
  else
    curl -sS -X "$1" -H "Authorization: Bearer $SECRET" -H 'Content-Type: application/json' -d "${3:-{\}}" "$BASE$2"
  fi
}
field() { python3 -c "import json,sys; d=json.load(sys.stdin); print(eval('d'+sys.argv[1]))" "$1"; }
step() { printf '\n\033[1m%s\033[0m\n' "$1"; }

step "0. Wrong secret is refused"
code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H 'Authorization: Bearer nope' -H 'Content-Type: application/json' -d '{"phone":"'$MAYA'"}' "$BASE/api/bot/whoami")
[ "$code" = 401 ] && echo "401 as expected" || { echo "expected 401, got $code"; exit 1; }

step "1. An unknown number is not linked"
bot POST /api/bot/whoami '{"phone":"'$NEW_PHONE'"}'; echo

step "2. Link a phone: a signed-in user gets a code in the app, then texts it"
curl -sS -c "$JAR" -X POST -H 'Content-Type: application/json' -d '{"netid":"demo_priya"}' "$BASE/api/auth/dev-login" >/dev/null
CODE=$(curl -sS -b "$JAR" -X POST "$BASE/api/me/phone-code" | field "['code']")
echo "code shown in the app: $CODE"
bot POST /api/bot/link-phone '{"phone":"'$NEW_PHONE'","code":"'$CODE'"}'; echo
# Put Priya's seeded number back so the script can be re-run.
CODE=$(curl -sS -b "$JAR" -X POST "$BASE/api/me/phone-code" | field "['code']")
bot POST /api/bot/link-phone '{"phone":"+12035550103","code":"'$CODE'"}' >/dev/null

step "3. whoami for Maya"
bot POST /api/bot/whoami '{"phone":"'$MAYA'"}'; echo

step "4. \"I want to be on YSIG\" → resolve the club"
CLUB=$(bot POST /api/bot/resolve-club '{"text":"ysig"}')
echo "$CLUB"
CLUB_ID=$(echo "$CLUB" | field "['club']['id']")

step "5. find_paths"
PATHS=$(bot POST /api/bot/find-paths '{"phone":"'$MAYA'","club_id":"'$CLUB_ID'"}')
echo "$PATHS" | python3 -c "import json,sys; d=json.load(sys.stdin); [print(f\"  {r['rank']}. [{r['score']}] {r['why']}\") for r in d['results']]; print('  pending_research:', d['pending_research'])"
SEARCH_ID=$(echo "$PATHS" | field "['search_id']")
CONNECTOR=$(echo "$PATHS" | field "['results'][0]['connector']['netid']")
[ "$CONNECTOR" = demo_jordan ] || { echo "expected demo_jordan at rank 1, got $CONNECTOR"; exit 1; }
SECOND=$(echo "$PATHS" | field "['results'][1]['connector']['netid']")
[ "$SECOND" = demo_priya ] || { echo "expected demo_priya at rank 2, got $SECOND"; exit 1; }

step "6. draft_intro to $CONNECTOR"
DRAFT=$(bot POST /api/bot/draft-intro '{"phone":"'$MAYA'","search_id":"'$SEARCH_ID'","connector_netid":"'$CONNECTOR'"}')
echo "$DRAFT"
MESSAGE=$(echo "$DRAFT" | field "['message']")

step "7. Maya says \"send\" → create_intro"
BODY=$(python3 -c "import json,sys; print(json.dumps({'phone':sys.argv[1],'search_id':sys.argv[2],'connector_netid':sys.argv[3],'message':sys.argv[4]}))" "$MAYA" "$SEARCH_ID" "$CONNECTOR" "$MESSAGE")
INTRO=$(bot POST /api/bot/intros "$BODY")
echo "$INTRO"
INTRO_ID=$(echo "$INTRO" | field "['intro_id']")

step "8. mark_intro_sent"
bot POST "/api/bot/intros/$INTRO_ID/sent" '{"phone":"'$MAYA'"}'; echo

step "9. Jordan accepts in the app"
curl -sS -c "$JAR" -X POST -H 'Content-Type: application/json' -d '{"netid":"demo_jordan"}' "$BASE/api/auth/dev-login" >/dev/null
curl -sS -b "$JAR" -X POST -H 'Content-Type: application/json' -d '{"decision":"accept"}' "$BASE/api/intros/$INTRO_ID/respond" | field "['intro']['status']"

step "10. \"did Jordan reply?\" → list_intros"
bot GET "/api/bot/intros?phone=%2B12035550101" | python3 -c "import json,sys; d=json.load(sys.stdin); [print(f\"  {i['connector']['first_name']}: {i['status_label']} ({i['club']['short_name']})\") for i in d['intros'][:3]]"

printf '\n\033[1mBot smoke test passed.\033[0m\n'
