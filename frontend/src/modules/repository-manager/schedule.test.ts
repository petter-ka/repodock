import { describe, expect, it } from "vitest"
import { dayPreset, formatCountdown, formatIn, nextOccurrence, scheduleOf } from "./schedule"

// 2026-10-19 is a Monday.
const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m)

describe("schedule helpers", () => {
  it("names day presets", () => {
    expect(dayPreset([5, 4, 3, 2, 1])).toBe("weekdays")
    expect(dayPreset([6, 0])).toBe("weekends")
    expect(dayPreset([0, 1, 2, 3, 4, 5, 6])).toBe("everyDay")
    expect(dayPreset([1, 3])).toBe("custom")
  })

  it("finds the next occurrence on an allowed day", () => {
    expect(nextOccurrence([1, 2, 3, 4, 5], "18:00", at(19, 9))).toEqual(at(19, 18))
    expect(nextOccurrence([1, 2, 3, 4, 5], "18:00", at(19, 18))).toEqual(at(20, 18))
    expect(nextOccurrence([1, 2, 3, 4, 5], "09:00", at(23, 10))).toEqual(at(26, 9)) // Friday → Monday
    expect(nextOccurrence([0, 6], "09:00", at(19, 9))).toEqual(at(24, 9))
    expect(nextOccurrence([], "09:00", at(19, 9))).toBeNull()
    expect(nextOccurrence([1], "25:00", at(19, 9))).toBeNull()
  })

  it("formats countdowns and durations", () => {
    expect(formatCountdown(29 * 60_000 + 59_400)).toBe("30:00")
    expect(formatCountdown(65_000)).toBe("1:05")
    expect(formatCountdown(3_723_000)).toBe("1:02:03")
    expect(formatCountdown(-5)).toBe("0:00")
    expect(formatIn(125 * 60_000)).toBe("2h 05m")
    expect(formatIn(50 * 3_600_000)).toBe("2d 2h")
  })

  it("fills defaults for groups saved without a schedule", () => {
    expect(scheduleOf({ schedule: null })).toMatchObject({ days: [], startEnabled: false, stopEnabled: false })
  })
})
