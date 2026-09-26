import { describe, it, expect } from "vitest";
import {
  addDays,
  dateLabel,
  dayLabel,
  daysLabel,
  isoWeekday,
  kigaliInstant,
  kigaliTime,
  kigaliToday,
  timeSlots,
  whenLabel,
} from "../src/schedule";

describe("Kigali time", () => {
  it("is UTC+2 whatever the phone says", () => {
    // 22:30 UTC on the 24th is already the 25th in Kigali.
    expect(kigaliToday(new Date("2026-09-24T22:30:00Z"))).toBe("2026-09-25");
    expect(kigaliInstant("2026-09-25", "07:30").toISOString()).toBe("2026-09-25T05:30:00.000Z");
    expect(kigaliTime("2026-09-25T05:30:00Z")).toBe("07:30");
  });

  it("walks the calendar across month ends", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(isoWeekday("2026-09-28")).toBe(1); // a Monday
    expect(isoWeekday("2026-09-27")).toBe(7); // a Sunday
  });
});

describe("labels", () => {
  it("says days the way people do", () => {
    expect(dayLabel("2026-09-25", "2026-09-25")).toBe("Today");
    expect(dayLabel("2026-09-26", "2026-09-25")).toBe("Tomorrow");
    expect(dayLabel("2026-09-28", "2026-09-25")).toBe("Mon 28");
    expect(whenLabel("2026-09-26T05:30:00Z", new Date("2026-09-25T10:00:00Z"))).toBe("Tomorrow, 07:30");
    expect(dateLabel("2026-10-24")).toBe("Sat 24 Oct");
  });

  it("names the common patterns rather than listing them", () => {
    expect(daysLabel([1, 2, 3, 4, 5])).toBe("Weekdays");
    expect(daysLabel([7, 6])).toBe("Weekends");
    expect(daysLabel([1, 2, 3, 4, 5, 6, 7])).toBe("Every day");
    expect(daysLabel([5, 1, 3])).toBe("Mon, Wed, Fri");
  });
});

describe("timeSlots", () => {
  it("offers only times far enough ahead to really be booked ahead", () => {
    // 08:00 in Kigali; with a 30-minute lead the first slot is 08:30.
    const now = new Date("2026-09-25T06:00:00Z");
    const slots = timeSlots("2026-09-25", 30, now);
    expect(slots[0]).toBe("08:30");
    expect(slots.at(-1)).toBe("22:45");
  });

  it("offers the whole day for tomorrow", () => {
    const slots = timeSlots("2026-09-26", 30, new Date("2026-09-25T20:00:00Z"));
    expect(slots[0]).toBe("05:00");
    expect(slots).toHaveLength(18 * 4);
  });
});
