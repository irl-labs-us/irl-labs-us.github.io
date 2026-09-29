export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,128}$/;

export function parseInviteCode(url) {
  const parsed = new URL(url);
  const keys = [...parsed.searchParams.keys()];
  const values = parsed.searchParams.getAll("code");
  if (keys.length !== 1 || keys[0] !== "code" || values.length !== 1) return null;
  return TOKEN_PATTERN.test(values[0]) ? values[0] : null;
}

export function normalizedInvitation(payload) {
  if (!payload || payload.version !== 1) return { status: "unavailable" };
  if (payload.status === "ended" || payload.status === "unavailable") {
    return { status: payload.status };
  }
  if (payload.status !== "scheduled" && payload.status !== "live") {
    return { status: "unavailable" };
  }
  const source = payload.invitation && typeof payload.invitation === "object"
    ? payload.invitation
    : {};
  const places = Array.isArray(source.places)
    ? source.places.flatMap((place) => {
      if (!place || typeof place !== "object") return [];
      const latitude = Number(place.latitude);
      const longitude = Number(place.longitude);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
          latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return [];
      return [{
        name: typeof place.name === "string" && place.name.trim() ? place.name.trim() : "Location",
        address: typeof place.address === "string" ? place.address.trim() : "",
        latitude,
        longitude,
      }];
    })
    : [];
  return {
    status: payload.status,
    title: typeof source.title === "string" && source.title.trim() ? source.title.trim() : "Let’s meet IRL",
    description: typeof source.description === "string" ? source.description.trim() : "",
    imageUrl: safeHttpsUrl(source.imageUrl),
    startsAt: isoDate(source.startsAt),
    endsAt: isoDate(source.endsAt),
    timeZone: typeof source.timeZone === "string" && source.timeZone.trim() ? source.timeZone.trim() : null,
    places,
  };
}

export function safeHttpsUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function isoDate(value) {
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function escapeIcs(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("\r\n", "\\n")
    .replaceAll("\n", "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;");
}

function utcStamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function foldLine(line) {
  const encoder = new TextEncoder();
  const folded = [];
  let current = "";
  let limit = 75;
  for (const character of line) {
    const candidate = current + character;
    if (encoder.encode(candidate).length > limit && current) {
      folded.push(current);
      current = " " + character;
      limit = 75;
    } else {
      current = candidate;
    }
  }
  folded.push(current);
  return folded.join("\r\n");
}

export function buildCalendar({ invitation, inviteUrl, uid, now = new Date() }) {
  if (invitation.status !== "scheduled" || !invitation.startsAt) return null;
  const location = invitation.places[0]
    ? [invitation.places[0].name, invitation.places[0].address].filter(Boolean).join(", ")
    : "";
  const description = [invitation.description, `Current details: ${inviteUrl}`]
    .filter(Boolean)
    .join("\n\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//IRL Labs//Scene Invitation//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeIcs(uid)}@irlwithfriends.com`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART:${utcStamp(invitation.startsAt)}`,
    ...(invitation.endsAt ? [`DTEND:${utcStamp(invitation.endsAt)}`] : []),
    `SUMMARY:${escapeIcs(invitation.title)}`,
    ...(location ? [`LOCATION:${escapeIcs(location)}`] : []),
    `DESCRIPTION:${escapeIcs(description)}`,
    `URL:${escapeIcs(inviteUrl)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

export async function stableInviteUid(code) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return [...new Uint8Array(digest)]
    .slice(0, 16)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
