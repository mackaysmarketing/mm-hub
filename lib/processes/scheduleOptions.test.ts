import { describe, it, expect } from "vitest";
import {
  scheduleToOption,
  optionToSchedule,
  selectedMinutes,
  fireMinutes,
  FREQUENCY_OPTIONS,
  INTERVAL_CHOICES,
  CUSTOM_MINUTES,
  UNEDITABLE,
  DEFAULT_CUSTOM_MINUTES,
  type StoredSchedule,
} from "./scheduleOptions";
import { parseSchedule, isRunDue, TICK_MINUTES } from "./schedule";

describe("scheduleToOption", () => {
  it("maps each preset to its own option", () => {
    expect(scheduleToOption({ frequency: "hourly" })).toBe("hourly");
    expect(scheduleToOption({ frequency: "every_n_hours", n: 4 })).toBe("every_4h");
    expect(scheduleToOption({ frequency: "daily", at_hour_brisbane: 0 })).toBe(
      "daily_midnight"
    );
  });

  it("maps any usable custom interval to the custom option", () => {
    for (const n of INTERVAL_CHOICES) {
      expect(scheduleToOption({ frequency: "every_n_minutes", n })).toBe(CUSTOM_MINUTES);
    }
  });

  it("falls back to the seeded default only when there is no schedule at all", () => {
    expect(scheduleToOption(undefined)).toBe("every_4h");
  });

  /**
   * The regression this module exists for. Each of these was previously
   * swallowed by a `return "every_4h"` catch-all, so the dropdown showed
   * "Every 4 hours" for a schedule that was something else entirely — and
   * saved that lie back the moment anyone touched the control.
   */
  it("refuses to misrepresent a schedule it cannot edit", () => {
    const unrepresentable: StoredSchedule[] = [
      { frequency: "daily", at_hour_brisbane: 7 }, // the seeded report schedule
      { frequency: "daily", at_hour_brisbane: 19 },
      { frequency: "every_n_hours", n: 6 },
      { frequency: "every_n_hours", n: 12 },
      { frequency: "every_n_minutes", n: 7 }, // not a tick multiple
      { frequency: "every_n_minutes", n: 90 }, // over an hour
      { frequency: "weekly" }, // not a shape the backend even parses
    ];
    for (const schedule of unrepresentable) {
      expect(scheduleToOption(schedule)).toBe(UNEDITABLE);
    }
  });

  it("never reports UNEDITABLE as one of the selectable options", () => {
    // UNEDITABLE is rendered as a disabled <option>; if it were also in the
    // list the user could pick it and optionToSchedule would silently coerce
    // it to every_4h — the original bug by another route.
    expect(FREQUENCY_OPTIONS.map((o) => o.value)).not.toContain(UNEDITABLE);
  });
});

describe("optionToSchedule", () => {
  it("produces a schedule the backend parser accepts, for every selectable option", () => {
    for (const option of FREQUENCY_OPTIONS.map((o) => o.value)) {
      for (const minutes of INTERVAL_CHOICES) {
        expect(parseSchedule(optionToSchedule(option, minutes))).not.toBeNull();
      }
    }
  });

  it("carries the chosen interval through", () => {
    expect(optionToSchedule(CUSTOM_MINUTES, 25)).toEqual({
      frequency: "every_n_minutes",
      n: 25,
    });
  });

  it("ignores the interval for the non-custom presets", () => {
    expect(optionToSchedule("hourly", 25)).toEqual({ frequency: "hourly" });
    expect(optionToSchedule("daily_midnight", 25)).toEqual({
      frequency: "daily",
      at_hour_brisbane: 0,
    });
  });
});

describe("round trip", () => {
  /**
   * Selecting what is already selected must be a no-op. This is the exact
   * property the old catch-all violated: it round-tripped "daily at 7am" into
   * "every 4 hours" and then stored it.
   */
  it("re-picking the displayed option preserves the stored schedule", () => {
    for (const option of FREQUENCY_OPTIONS.map((o) => o.value)) {
      for (const minutes of INTERVAL_CHOICES) {
        const stored = optionToSchedule(option, minutes);
        const shown = scheduleToOption(stored);
        expect(shown).toBe(option);
        expect(optionToSchedule(shown, selectedMinutes(stored))).toEqual(stored);
      }
    }
  });
});

describe("selectedMinutes", () => {
  it("shows the stored interval when there is a usable one", () => {
    expect(selectedMinutes({ frequency: "every_n_minutes", n: 45 })).toBe(45);
  });

  it("falls back to the default for anything else", () => {
    expect(selectedMinutes(undefined)).toBe(DEFAULT_CUSTOM_MINUTES);
    expect(selectedMinutes({ frequency: "hourly" })).toBe(DEFAULT_CUSTOM_MINUTES);
    expect(selectedMinutes({ frequency: "every_n_minutes", n: 7 })).toBe(
      DEFAULT_CUSTOM_MINUTES
    );
  });

  it("its default is itself a selectable interval", () => {
    expect(INTERVAL_CHOICES).toContain(DEFAULT_CUSTOM_MINUTES);
  });
});

describe("INTERVAL_CHOICES", () => {
  it("is every tick multiple from the floor up to an hour", () => {
    expect(INTERVAL_CHOICES[0]).toBe(TICK_MINUTES);
    expect(INTERVAL_CHOICES[INTERVAL_CHOICES.length - 1]).toBe(60);
    expect(INTERVAL_CHOICES).toEqual([5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60]);
  });

  it("offers nothing the backend would reject", () => {
    for (const n of INTERVAL_CHOICES) {
      expect(parseSchedule({ frequency: "every_n_minutes", n })).not.toBeNull();
    }
  });
});

describe("fireMinutes", () => {
  it("lists the minutes the schedule engine actually fires on", () => {
    for (const n of INTERVAL_CHOICES) {
      const engineFires: number[] = [];
      for (let m = 0; m < 60; m += TICK_MINUTES) {
        if (isRunDue({ frequency: "every_n_minutes", n }, new Date(Date.UTC(2026, 6, 30, 4, m)))) {
          engineFires.push(m);
        }
      }
      expect(fireMinutes(n)).toEqual(engineFires);
    }
  });
});
