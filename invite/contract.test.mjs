import test from "node:test";
import assert from "node:assert/strict";
import { buildCalendar, normalizedInvitation, parseInviteCode } from "./contract.mjs";

const CODE = "Abcd_efghijklmnopqrstuv0123456789";

test("accepts exactly one bounded code parameter", () => {
  assert.equal(parseInviteCode(`https://irlwithfriends.com/invite/?code=${CODE}`), CODE);
  assert.equal(parseInviteCode(`https://irlwithfriends.com/invite/?code=${CODE}&x=1`), null);
  assert.equal(parseInviteCode(`https://irlwithfriends.com/invite/?code=${CODE}&code=${CODE}`), null);
  assert.equal(parseInviteCode("https://irlwithfriends.com/invite/?code=short"), null);
});

test("normalizes an allowlisted multi-venue payload", () => {
  const result = normalizedInvitation({
    version: 1,
    status: "scheduled",
    invitation: {
      title: "Very long <script> title",
      description: "Text only",
      startsAt: "2026-11-01T05:30:00Z",
      places: [
        { name: "First", address: "One", latitude: 40.7, longitude: -74 },
        { name: "Second", latitude: 40.8, longitude: -73.9 },
      ],
      attendeeIds: ["secret"],
    },
  });
  assert.equal(result.places.length, 2);
  assert.equal(result.title, "Very long <script> title");
  assert.equal("attendeeIds" in result, false);
});

test("calendar is escaped, UTC, stable, and does not fabricate an end", () => {
  const invitation = normalizedInvitation({
    version: 1,
    status: "scheduled",
    invitation: {
      title: "Coffee, then art; yes",
      description: "Line one\nLine two",
      startsAt: "2026-11-01T05:30:00-04:00",
      places: [{ name: "Café", address: "1 Main St", latitude: 40.7, longitude: -74 }],
    },
  });
  const value = buildCalendar({
    invitation,
    inviteUrl: `https://irlwithfriends.com/invite/?code=${CODE}`,
    uid: "stable-id",
    now: new Date("2026-09-29T12:00:00Z"),
  });
  assert.match(value, /UID:stable-id@irlwithfriends\.com/);
  assert.match(value, /DTSTART:20261101T093000Z/);
  assert.doesNotMatch(value, /DTEND:/);
  assert.match(value, /SUMMARY:Coffee\\, then art\\; yes/);
  assert.match(value, /DESCRIPTION:Line one\\nLine two\\n\\nCurrent details:/);
  assert.ok(value.endsWith("\r\n"));
});
