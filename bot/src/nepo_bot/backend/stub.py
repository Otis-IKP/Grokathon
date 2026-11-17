"""In-memory demo graph so the bot works before Otis's API is live."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

CLUBS: dict[str, dict[str, Any]] = {
    "ysig": {
        "id": "ysig",
        "name": "Yale Student Investment Group",
        "aliases": ["YSIG", "investment club", "yale investment", "student investment"],
        "category": "finance",
    },
    "ypu": {
        "id": "ypu",
        "name": "Yale Political Union",
        "aliases": ["YPU", "political union"],
        "category": "debate",
    },
    "whiffs": {
        "id": "whiffs",
        "name": "The Whiffenpoofs",
        "aliases": ["Whiffs", "Whiffenpoofs", "whiffenpoofs"],
        "category": "a cappella",
    },
    "ycc": {
        "id": "ycc",
        "name": "Yale College Council",
        "aliases": ["YCC", "college council"],
        "category": "student government",
    },
}

USERS: dict[str, dict[str, Any]] = {
    "user_maya": {
        "id": "user_maya",
        "name": "Maya Chen",
        "phone": "+12035550100",
        "class_year": 2029,
        "college": "Jonathan Edwards",
        "clubs": [],
    },
    "user_jordan": {
        "id": "user_jordan",
        "name": "Jordan Lee",
        "phone": "+12035550101",
        "class_year": 2027,
        "college": "Jonathan Edwards",
        "clubs": [{"club_id": "ysig", "role": "member"}],
    },
    "user_priya": {
        "id": "user_priya",
        "name": "Priya Shah",
        "phone": "+12035550102",
        "class_year": 2028,
        "college": "Pierson",
        "clubs": [],
    },
    "user_sam": {
        "id": "user_sam",
        "name": "Sam Okonkwo",
        "phone": "+12035550103",
        "class_year": 2027,
        "college": "Trumbull",
        "clubs": [{"club_id": "ysig", "role": "board"}],
    },
}

# undirected accepted friendships
FRIENDSHIPS: set[frozenset[str]] = {
    frozenset({"user_maya", "user_jordan"}),
    frozenset({"user_maya", "user_priya"}),
    frozenset({"user_priya", "user_sam"}),
}

# contacts owned by a user that match another signed-up user
CONTACTS: dict[str, list[str]] = {
    "user_priya": ["user_sam"],
}

INTROS: dict[str, dict[str, Any]] = {}
_intro_counter = 0


def _friends_of(user_id: str) -> set[str]:
    out: set[str] = set()
    for edge in FRIENDSHIPS:
        if user_id in edge:
            out |= set(edge) - {user_id}
    return out


def resolve_club(text: str) -> dict[str, Any]:
    needle = text.strip().lower()
    for club in CLUBS.values():
        names = [club["name"].lower(), club["id"].lower(), * [a.lower() for a in club["aliases"]]]
        if any(needle == n or needle in n or n in needle for n in names):
            return {"ok": True, "club": deepcopy(club)}
    return {
        "ok": False,
        "candidates": [
            {"id": c["id"], "name": c["name"], "aliases": c["aliases"]}
            for c in CLUBS.values()
        ],
        "message": f"Could not uniquely resolve club from '{text}'. Ask the user to confirm.",
    }


def find_paths(user_id: str, club_id: str, limit: int = 3) -> dict[str, Any]:
    if user_id not in USERS:
        return {"ok": False, "error": f"unknown user {user_id}"}
    if club_id not in CLUBS:
        return {"ok": False, "error": f"unknown club {club_id}"}

    members = [
        uid
        for uid, u in USERS.items()
        if any(m["club_id"] == club_id for m in u.get("clubs", []))
    ]
    paths: list[dict[str, Any]] = []
    friends = _friends_of(user_id)

    for fid in friends:
        friend = USERS[fid]
        if any(m["club_id"] == club_id for m in friend.get("clubs", [])):
            role = next(m["role"] for m in friend["clubs"] if m["club_id"] == club_id)
            paths.append(
                {
                    "hops": 1,
                    "connector": {
                        "id": fid,
                        "name": friend["name"],
                        "phone": friend["phone"],
                        "relation": "friend",
                    },
                    "target": {
                        "id": fid,
                        "name": friend["name"],
                        "role": role,
                    },
                    "score": 100,
                    "reason": f"{friend['name']} is your friend and a {role} of {CLUBS[club_id]['name']}.",
                }
            )

    for fid in friends:
        friend = USERS[fid]
        # friend's friends in club
        for ffid in _friends_of(fid):
            if ffid == user_id or ffid not in members:
                continue
            target = USERS[ffid]
            role = next(m["role"] for m in target["clubs"] if m["club_id"] == club_id)
            paths.append(
                {
                    "hops": 2,
                    "connector": {
                        "id": fid,
                        "name": friend["name"],
                        "phone": friend["phone"],
                        "relation": "friend",
                    },
                    "target": {
                        "id": ffid,
                        "name": target["name"],
                        "role": role,
                    },
                    "score": 70,
                    "reason": (
                        f"{friend['name']} (your friend) knows {target['name']}, "
                        f"a {role} of {CLUBS[club_id]['name']}."
                    ),
                }
            )
        # friend's contacts in club
        for cid in CONTACTS.get(fid, []):
            if cid not in members:
                continue
            target = USERS[cid]
            role = next(m["role"] for m in target["clubs"] if m["club_id"] == club_id)
            paths.append(
                {
                    "hops": 2,
                    "connector": {
                        "id": fid,
                        "name": friend["name"],
                        "phone": friend["phone"],
                        "relation": "friend",
                    },
                    "target": {
                        "id": cid,
                        "name": target["name"],
                        "role": role,
                    },
                    "score": 55,
                    "reason": (
                        f"{friend['name']} (your friend) has {target['name']} "
                        f"({role}) in contacts."
                    ),
                }
            )

    # de-dupe by connector+target, keep highest score
    best: dict[tuple[str, str], dict[str, Any]] = {}
    for p in paths:
        key = (p["connector"]["id"], p["target"]["id"])
        if key not in best or p["score"] > best[key]["score"]:
            best[key] = p
    ranked = sorted(best.values(), key=lambda p: (-p["score"], p["hops"]))[:limit]
    return {
        "ok": True,
        "club": deepcopy(CLUBS[club_id]),
        "paths": ranked,
        "count": len(ranked),
    }


def draft_intro(
    user_id: str,
    connector_id: str,
    club_id: str,
    tone: str = "casual",
    notes: str = "",
) -> dict[str, Any]:
    global _intro_counter
    if user_id not in USERS or connector_id not in USERS or club_id not in CLUBS:
        return {"ok": False, "error": "unknown user/connector/club"}

    requester = USERS[user_id]
    connector = USERS[connector_id]
    club = CLUBS[club_id]
    first = connector["name"].split()[0]
    club_short = club["aliases"][0] if club["aliases"] else club["name"]

    if tone == "enthusiastic":
        body = (
            f"Hey {first}! I've been really into {club_short} this cycle and would love "
            f"any intro or coffee chat with someone on the inside. Totally get if you're "
            f"busy — even a quick pointer on what they look for would mean a lot."
        )
    elif tone == "polite":
        body = (
            f"Hi {first}, hope you're well. I'm exploring {club['name']} and wondered "
            f"whether you'd be open to introducing me to someone involved, or sharing "
            f"what the process is like. Happy to work around your schedule."
        )
    else:
        body = (
            f"Hey {first}! I'm really interested in joining {club_short} this cycle. "
            f"Would you be up for introducing me to someone on the board, or telling me "
            f"a bit about what they look for? Happy to grab coffee."
        )
    if notes.strip():
        body += f" ({notes.strip()})"

    _intro_counter += 1
    intro_id = f"intro_{_intro_counter}"
    INTROS[intro_id] = {
        "id": intro_id,
        "requester": user_id,
        "connector": connector_id,
        "club_id": club_id,
        "drafted_message": body,
        "status": "drafted",
        "to_phone": connector["phone"],
    }
    return {
        "ok": True,
        "intro_id": intro_id,
        "to_name": connector["name"],
        "to_phone": connector["phone"],
        "body": body,
        "from_name": requester["name"],
    }


def mark_intro_sent(intro_id: str) -> None:
    if intro_id in INTROS:
        INTROS[intro_id]["status"] = "sent"


def lookup_user(phone: str | None = None, user_id: str | None = None) -> dict[str, Any]:
    if user_id and user_id in USERS:
        return {"ok": True, "user": deepcopy(USERS[user_id])}
    if phone:
        for u in USERS.values():
            if u["phone"] == phone:
                return {"ok": True, "user": deepcopy(u)}
    return {"ok": False, "error": "user not found"}
