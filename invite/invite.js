import {
  buildCalendar,
  normalizedInvitation,
  parseInviteCode,
  stableInviteUid,
} from "./contract.mjs";

const ENDPOINT = "https://rkxsopbsiaftjvjzvmqa.supabase.co/functions/v1/resolve-scene-invite";
const APP_STORE_URL = "https://apps.apple.com/us/app/irl-with-friends/id6757364077";
const REFRESH_MS = 120_000;
const code = parseInviteCode(window.location.href);
const root = document.querySelector("#invitation");
let currentInvitation = null;
let refreshTimer = null;

const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

function action(label, onClick, secondary = false) {
  const button = element("button", secondary ? "button button-secondary" : "button", label);
  button.type = "button";
  button.addEventListener("click", onClick);
  return button;
}

function clear() {
  root.replaceChildren();
  root.removeAttribute("aria-busy");
}

function stateView(title, message, { retry = false, ended = false } = {}) {
  clear();
  const panel = element("section", "state-panel");
  panel.append(
    element("div", "state-icon", ended ? "✓" : "↗"),
    element("h1", "state-title", title),
    element("p", "state-copy", message),
  );
  if (retry) panel.append(action("Try again", () => load({ foreground: true })));
  panel.append(appStoreLink());
  root.append(panel);
}

function loading() {
  clear();
  root.setAttribute("aria-busy", "true");
  const panel = element("section", "state-panel");
  const spinner = element("div", "spinner");
  spinner.setAttribute("aria-hidden", "true");
  panel.append(spinner, element("p", "state-copy", "Loading your invitation…"));
  root.append(panel);
}

function appStoreLink() {
  const link = element("a", "store-link", "Get IRL on the App Store");
  link.href = APP_STORE_URL;
  link.rel = "noopener noreferrer";
  link.target = "_blank";
  return link;
}

function render(invitation) {
  currentInvitation = invitation;
  if (invitation.status === "ended") {
    stateView("This scene has ended", "Location and scene details are no longer shown.", { ended: true });
    return;
  }
  if (invitation.status === "unavailable") {
    stateView("This invitation is unavailable", "The link may have expired, been replaced, or been disabled.");
    return;
  }

  clear();
  const card = element("article", "invite-card");
  if (invitation.imageUrl) {
    const image = element("img", "hero");
    image.src = invitation.imageUrl;
    image.alt = "Scene photo";
    image.referrerPolicy = "no-referrer";
    image.addEventListener("error", () => image.remove());
    card.append(image);
  }
  const content = element("div", "invite-content");
  content.append(
    element("p", "eyebrow", invitation.status === "live" ? "Live now" : "You’re invited"),
    element("h1", "invite-title", invitation.title),
  );
  if (invitation.description) content.append(element("p", "description", invitation.description));
  if (invitation.startsAt) {
    const time = element("section", "time-block");
    time.setAttribute("aria-label", "Scene time");
    time.append(
      element("p", "time-main", formatTime(invitation)),
      element("p", "time-zone", invitation.timeZone
        ? `Time zone: ${invitation.timeZone}`
        : `Shown in your timezone (${Intl.DateTimeFormat().resolvedOptions().timeZone || "local time"})`),
    );
    content.append(time);
  }
  const venues = element("section", "venues");
  venues.setAttribute("aria-label", "Locations");
  invitation.places.forEach((place, index) => {
    const venue = element("article", "venue");
    venue.append(element("p", "venue-number", invitation.places.length > 1 ? `Stop ${index + 1}` : "Location"));
    venue.append(element("h2", "venue-name", place.name));
    if (place.address) venue.append(element("p", "venue-address", place.address));
    const directions = element("a", "button button-secondary", "Get directions");
    directions.href = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${place.latitude},${place.longitude}`)}`;
    directions.target = "_blank";
    directions.rel = "noopener noreferrer";
    directions.setAttribute("aria-label", `Get directions to ${place.name}`);
    venue.append(directions);
    venues.append(venue);
  });
  content.append(venues);

  const actions = element("div", "actions");
  if (invitation.status === "scheduled" && invitation.startsAt) {
    actions.append(action("Add to calendar", () => downloadCalendar(invitation)));
  }
  actions.append(appStoreLink());
  content.append(actions);
  content.append(element(
    "p",
    "privacy-note",
    "This invitation is read-only. Viewing it does not RSVP, check you in, or connect your account. Anyone with the link can view these details.",
  ));
  card.append(content);
  root.append(card);
}

function formatTime(invitation) {
  const options = {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
    ...(invitation.timeZone ? { timeZone: invitation.timeZone } : {}),
  };
  const start = new Intl.DateTimeFormat(undefined, options).format(invitation.startsAt);
  if (!invitation.endsAt) return start;
  const end = new Intl.DateTimeFormat(undefined, {
    hour: "numeric", minute: "2-digit", ...(invitation.timeZone ? { timeZone: invitation.timeZone } : {}),
  }).format(invitation.endsAt);
  return `${start} – ${end}`;
}

async function downloadCalendar(invitation) {
  const uid = await stableInviteUid(code);
  const calendar = buildCalendar({ invitation, inviteUrl: window.location.href, uid });
  if (!calendar) return;
  const href = URL.createObjectURL(new Blob([calendar], { type: "text/calendar;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = href;
  link.download = "irl-invitation.ics";
  link.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
  const note = element("p", "calendar-note", "Downloaded calendar entries do not automatically sync later changes. Reopen this link for current details.");
  document.querySelector(".actions")?.append(note);
}

function refreshWarning() {
  if (document.querySelector(".refresh-warning")) return;
  const warning = element("p", "refresh-warning", "We couldn’t refresh this invitation. The displayed details may be out of date.");
  warning.setAttribute("role", "status");
  root.prepend(warning);
}

async function load({ foreground = false } = {}) {
  if (!code) {
    stateView("This invitation is unavailable", "Check that you opened the complete link.");
    return;
  }
  if (!foreground && !currentInvitation) loading();
  try {
    const response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
      cache: "no-store",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) throw new Error(`resolver_${response.status}`);
    render(normalizedInvitation(await response.json()));
  } catch {
    if (currentInvitation && foreground) {
      refreshWarning();
    } else {
      stateView(
        navigator.onLine ? "We couldn’t load this invitation" : "You’re offline",
        navigator.onLine ? "Try again in a moment." : "Reconnect to the internet, then try again.",
        { retry: true },
      );
    }
  }
}

function scheduleRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (document.visibilityState === "visible") load({ foreground: true });
  }, REFRESH_MS);
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") load({ foreground: true });
});
window.addEventListener("online", () => load({ foreground: true }));
load();
scheduleRefresh();
