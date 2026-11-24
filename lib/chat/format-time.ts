/**
 * Polish chat timestamps from the server clock.
 *
 * Under 10 seconds: "przed chwilą".
 * Then seconds, then minutes.
 * After an hour, today's messages show "HH:MM" in Europe/Warsaw.
 * Earlier days show "dd.MM.yyyy HH:MM" in that same zone.
 * The last hour stays relative even when it crosses midnight.
 */

const WARSAW_TIME_ZONE = "Europe/Warsaw";
const JUST_NOW_MAX_SECONDS = 10;
const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 60 * 60;

const warsawPartsFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: WARSAW_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

interface WarsawFields {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
}

function warsawFields(epochMs: number): WarsawFields | null {
  const parts = warsawPartsFormat.formatToParts(epochMs);
  const read = (type: Intl.DateTimeFormatPartTypes): string => {
    const value = parts.find((part) => part.type === type)?.value;
    return value ?? "";
  };

  let hour = read("hour");
  if (hour === "24") {
    hour = "00";
  }

  const fields = {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: hour.padStart(2, "0"),
    minute: read("minute").padStart(2, "0"),
  };

  if (Object.values(fields).some((value) => value.trim().length === 0)) {
    return null;
  }

  return fields;
}

function warsawDateClock(
  createdMs: number,
  nowMs: number,
): { sameDay: boolean; clock: string; dated: string } | null {
  const created = warsawFields(createdMs);
  const now = warsawFields(nowMs);
  if (created === null || now === null) {
    return null;
  }

  const clock = `${created.hour}:${created.minute}`;
  const sameDay = created.year === now.year && created.month === now.month && created.day === now.day;
  return {
    sameDay,
    clock,
    dated: `${created.day}.${created.month}.${created.year} ${clock}`,
  };
}

function polishAgo(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  let form = many;
  if (count === 1) {
    form = one;
  } else if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    form = few;
  }

  return `${count} ${form} temu`;
}

/** Full Warsaw date and clock. Fallback label before the server clock is known. */
export function formatChatAbsoluteTime(createdAt: string): string {
  const createdMs = Date.parse(createdAt);
  if (Number.isNaN(createdMs)) {
    return createdAt;
  }

  const fields = warsawFields(createdMs);
  if (fields === null) {
    return createdAt;
  }

  return `${fields.day}.${fields.month}.${fields.year} ${fields.hour}:${fields.minute}`;
}

/**
 * Label for one message at `nowMs`.
 * `nowMs` should be the server clock, not an uncorrected client clock.
 */
export function formatChatTimestamp(createdAt: string, nowMs: number): string {
  const createdMs = Date.parse(createdAt);
  if (Number.isNaN(createdMs) || Number.isNaN(nowMs)) {
    return createdAt;
  }

  const ageSeconds = Math.floor((nowMs - createdMs) / 1000);
  if (ageSeconds < JUST_NOW_MAX_SECONDS) {
    return "przed chwilą";
  }

  if (ageSeconds < SECONDS_PER_MINUTE) {
    return polishAgo(ageSeconds, "sekundę", "sekundy", "sekund");
  }

  if (ageSeconds < SECONDS_PER_HOUR) {
    const minutes = Math.floor(ageSeconds / SECONDS_PER_MINUTE);
    return polishAgo(minutes, "minutę", "minuty", "minut");
  }

  const label = warsawDateClock(createdMs, nowMs);
  if (label === null) {
    return createdAt;
  }

  return label.sameDay ? label.clock : label.dated;
}

/**
 * Exact Warsaw clock revealed by dragging the thread.
 * Today's messages are `HH:MM`. Earlier Warsaw days include `dd.MM.yyyy`.
 * `nowMs` should be the server clock, not an uncorrected client clock.
 */
export function formatChatRevealTime(createdAt: string, nowMs: number): string {
  const createdMs = Date.parse(createdAt);
  if (Number.isNaN(createdMs) || Number.isNaN(nowMs)) {
    return createdAt;
  }

  const label = warsawDateClock(createdMs, nowMs);
  if (label === null) {
    return createdAt;
  }

  return label.sameDay ? label.clock : label.dated;
}
