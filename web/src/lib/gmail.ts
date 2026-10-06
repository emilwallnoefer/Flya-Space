import "server-only";

import { gmail as gmailApi } from "@googleapis/gmail";
import { OAuth2Client, type Credentials } from "google-auth-library";

const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/spreadsheets.readonly",
];

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export function getOAuthClient(redirectUri: string) {
  return new OAuth2Client(
    requiredEnv("GOOGLE_OAUTH_CLIENT_ID"),
    requiredEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
    redirectUri,
  );
}

export function getAuthUrl(redirectUri: string, state?: string) {
  const client = getOAuthClient(redirectUri);
  return client.generateAuthUrl({
    access_type: "offline",
    scope: GMAIL_SCOPES,
    prompt: "consent",
    // Anti-CSRF: echoed back to the callback and matched against a cookie.
    ...(state ? { state } : {}),
  });
}

export async function exchangeCodeForTokens(code: string, redirectUri: string) {
  const client = getOAuthClient(redirectUri);
  const { tokens } = await client.getToken(code);
  return tokens;
}

/**
 * Revoke a refresh token at Google, so disconnecting really ends the grant
 * rather than only forgetting our copy. Best-effort: a token Google already
 * considers revoked or expired is the goal state, so errors are only logged.
 */
export async function revokeGoogleRefreshToken(refreshToken: string): Promise<void> {
  try {
    const client = new OAuth2Client(requiredEnv("GOOGLE_OAUTH_CLIENT_ID"), requiredEnv("GOOGLE_OAUTH_CLIENT_SECRET"));
    await client.revokeToken(refreshToken);
  } catch (error) {
    console.warn("[gmail] token revoke failed", (error as Error)?.message);
  }
}

export async function getConnectedGmailEmail(tokens: Credentials, redirectUri: string) {
  const oauthClient = getOAuthClient(redirectUri);
  oauthClient.setCredentials(tokens);
  const gmail = gmailApi({ version: "v1", auth: oauthClient });
  const profile = await gmail.users.getProfile({ userId: "me" });
  return profile.data.emailAddress ?? null;
}

type InlineAttachment = {
  contentId: string;
  mimeType: string;
  base64: string;
};

type DraftPayload = {
  to?: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  html_body?: string;
  inline_attachments?: InlineAttachment[];
};

function base64urlEncode(input: string) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/** Encode non-ASCII subjects (emoji, en dash, etc.) for RFC 5322 headers. */
function encodeRfc2047Subject(subject: string) {
  if (!/[^\x00-\x7F]/.test(subject)) return subject;
  const b64 = Buffer.from(subject, "utf8").toString("base64");
  return `=?UTF-8?B?${b64}?=`;
}

function foldBase64(b64: string) {
  return b64.match(/.{1,76}/g)?.join("\r\n") ?? b64;
}

function buildRawMessage(payload: DraftPayload) {
  const subject = encodeRfc2047Subject(payload.subject);
  const plainB64 = foldBase64(Buffer.from(payload.body, "utf8").toString("base64"));
  const htmlStr = payload.html_body ?? payload.body.replaceAll("\n", "<br>");
  const htmlB64 = foldBase64(Buffer.from(htmlStr, "utf8").toString("base64"));

  const headerLines = [
    payload.to ? `To: ${payload.to}` : "",
    payload.cc ? `Cc: ${payload.cc}` : "",
    payload.bcc ? `Bcc: ${payload.bcc}` : "",
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
  ].filter(Boolean);

  const att = payload.inline_attachments?.[0];

  if (!att) {
    const boundaryAlt = "ma-alt-001";
    const body = [
      ...headerLines,
      `Content-Type: multipart/alternative; boundary="${boundaryAlt}"`,
      "",
      `--${boundaryAlt}`,
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      plainB64,
      "",
      `--${boundaryAlt}`,
      "Content-Type: text/html; charset=UTF-8",
      "Content-Transfer-Encoding: base64",
      "",
      htmlB64,
      "",
      `--${boundaryAlt}--`,
    ].join("\r\n");
    return base64urlEncode(body);
  }

  const boundaryRel = "ma-rel-001";
  const boundaryAlt = "ma-alt-002";
  const imgB64 = foldBase64(att.base64);

  const relatedBody = [
    `--${boundaryRel}`,
    `Content-Type: multipart/alternative; boundary="${boundaryAlt}"`,
    "",
    `--${boundaryAlt}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    plainB64,
    "",
    `--${boundaryAlt}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    htmlB64,
    "",
    `--${boundaryAlt}--`,
    "",
    `--${boundaryRel}`,
    `Content-Type: ${att.mimeType}`,
    "Content-Transfer-Encoding: base64",
    `Content-ID: <${att.contentId}>`,
    'Content-Disposition: inline; filename="feedback.png"',
    "",
    imgB64,
    "",
    `--${boundaryRel}--`,
  ].join("\r\n");

  const full = [
    ...headerLines,
    `Content-Type: multipart/related; boundary="${boundaryRel}"; type="multipart/alternative"`,
    "",
    relatedBody,
  ].join("\r\n");

  return base64urlEncode(full);
}

export async function createGmailDraft(refreshToken: string, payload: DraftPayload) {
  const oauthClient = getOAuthClient(requiredEnv("GOOGLE_OAUTH_REDIRECT_URI"));
  oauthClient.setCredentials({ refresh_token: refreshToken });

  const gmail = gmailApi({ version: "v1", auth: oauthClient });
  const raw = buildRawMessage(payload);

  const response = await gmail.users.drafts.create({
    userId: "me",
    requestBody: {
      message: { raw },
    },
  });

  return {
    draftId: response.data.id ?? "",
    messageId: response.data.message?.id ?? "",
  };
}
