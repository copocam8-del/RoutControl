import { describe, expect, it } from "vitest";

import { shiftReportDate } from "./reports";

describe("navegar los períodos del informe", () => {
  it("día, semana y mes", () => {
    expect(shiftReportDate("day", "2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftReportDate("week", "2026-11-02", 1)).toBe("2026-11-09");
    expect(shiftReportDate("month", "2026-01-31", 1)).toBe("2026-02-01");
    expect(shiftReportDate("month", "2026-01-15", -1)).toBe("2025-12-01");
  });

  it("quincenas: 1–15 y 16–fin de mes", () => {
    expect(shiftReportDate("fortnight", "2026-11-04", 1)).toBe("2026-11-16");
    expect(shiftReportDate("fortnight", "2026-11-20", 1)).toBe("2026-12-01");
    expect(shiftReportDate("fortnight", "2026-11-20", -1)).toBe("2026-11-01");
    expect(shiftReportDate("fortnight", "2026-11-04", -1)).toBe("2026-10-16");
  });
});
