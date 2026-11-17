"""Grok tool schemas for NEPO (function calling)."""

from __future__ import annotations

from typing import Any

TOOLS: list[dict[str, Any]] = [
    {
        "type": "function",
        "function": {
            "name": "resolve_club",
            "description": (
                "Map free text (e.g. 'YSIG', 'the investment club', 'Whiffs') "
                "to a Yale club id, canonical name, and aliases."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "User's club mention or nickname",
                    }
                },
                "required": ["text"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "find_paths",
            "description": (
                "Find ranked warm paths from the requester to members of a club "
                "(one hop: friend in club; two hop: friend who knows a member)."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "user_id": {"type": "string"},
                    "club_id": {"type": "string"},
                    "limit": {
                        "type": "integer",
                        "description": "Max paths to return",
                        "default": 3,
                    },
                },
                "required": ["user_id", "club_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "draft_intro",
            "description": (
                "Draft a short, natural text message from the requester to a "
                "connector asking for an intro or coffee chat about the club."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "user_id": {"type": "string"},
                    "connector_id": {"type": "string"},
                    "club_id": {"type": "string"},
                    "tone": {
                        "type": "string",
                        "enum": ["casual", "polite", "enthusiastic"],
                        "default": "casual",
                    },
                    "notes": {
                        "type": "string",
                        "description": "Optional extra context from the user",
                    },
                },
                "required": ["user_id", "connector_id", "club_id"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "send_message",
            "description": (
                "Send a confirmed message to a phone number via the messaging "
                "layer. Only call after the user explicitly confirms."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "to": {
                        "type": "string",
                        "description": "E.164 phone number",
                    },
                    "body": {"type": "string"},
                    "intro_id": {
                        "type": "string",
                        "description": "Optional intro record id to mark sent",
                    },
                },
                "required": ["to", "body"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "lookup_user",
            "description": "Look up a NEPO user by phone number or user id.",
            "parameters": {
                "type": "object",
                "properties": {
                    "phone": {"type": "string"},
                    "user_id": {"type": "string"},
                },
            },
        },
    },
]
