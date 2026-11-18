import type { IntroView } from "@/server/intros/service";

/** One intro as the bot reads it back. */
export function botIntroView(intro: IntroView) {
  return {
    intro_id: intro.id,
    status: intro.status,
    message: intro.message,
    club: intro.club,
    connector: intro.connector,
    created_at: intro.created_at,
    response_url: intro.response_url,
  };
}

/** One row of the bot's "did Jordan reply?" list. */
export function botIntroListItem(i: IntroView) {
  return {
    intro_id: i.id,
    status: i.status,
    status_label: i.status_label,
    club: i.club,
    connector: i.connector,
    target: i.target,
    message: i.message,
    created_at: i.created_at,
    sent_at: i.sent_at,
    responded_at: i.responded_at,
  };
}
