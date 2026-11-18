import { PUBLIC_APP_URL, PUBLIC_BOT_PHONE, PUBLIC_GRAPH_SHARE_TOKEN } from "astro:env/client";

/** The app's origin without a trailing slash, or null until the app is deployed. */
export const appUrl: string | null = PUBLIC_APP_URL?.trim() ? PUBLIC_APP_URL.trim().replace(/\/+$/, "") : null;

export const graphShareToken: string | null = PUBLIC_GRAPH_SHARE_TOKEN?.trim() || null;

/** As shown to people: "+1 645 243 7121". */
export const botPhone = PUBLIC_BOT_PHONE;

/** `sms:` needs digits only. iOS and Android both accept `sms:+16452437121`. */
export const smsHref = `sms:${botPhone.replace(/[^\d+]/g, "")}`;

export const loginUrl = appUrl ? `${appUrl}/login` : null;
export const appPrivacyUrl = appUrl ? `${appUrl}/privacy` : null;
