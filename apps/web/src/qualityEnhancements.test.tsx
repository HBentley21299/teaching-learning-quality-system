// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CollapsibleSection } from "./components/CollapsibleSection";
import { AccessiblePieChart, MonthlyActivityChart } from "./components/DashboardCharts";
import { FullRecordLink } from "./components/FullRecordLink";
import { ElevateStatusTiles, getReflectionTotal } from "./features/StaffProfilePanel";
import { buildMonthlyTrend } from "./routes/Dashboard";
import { getCpdEntryPermissions } from "./routes/ModuleWorkspace";
import type { ProcessDashboardRecordSummary } from "./services/types";

afterEach(cleanup);

describe("quality UI enhancements", () => {
  it("keeps record sections collapsed by default and exposes their count", () => {
    render(<CollapsibleSection count={12} title="Learning Walk records"><p>Record list</p></CollapsibleSection>);
    const toggle = screen.getByRole("button", { name: /Learning Walk records/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("12 records")).toBeVisible();
    expect(screen.queryByText("Record list")).not.toBeInTheDocument();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("Record list")).toBeVisible();
  });

  it("fills empty calendar months with zero in chronological order", () => {
    const records = [
      { recordDate: "2026-01-04", createdAt: "2026-01-04T10:00:00Z" },
      { recordDate: "2026-03-09", createdAt: "2026-03-09T10:00:00Z" }
    ] as ProcessDashboardRecordSummary[];
    expect(buildMonthlyTrend(records, "2026-01-01", "2026-03-31").map((point) => point.value)).toEqual([1, 0, 1]);
  });

  it("labels activity axes and gives each month an accessible tooltip", () => {
    render(<MonthlyActivityChart data={[{ label: "Jan 26", value: 0 }, { label: "Feb 26", value: 2 }]} recordType="Learning Walks" subtitle="Monthly" title="Activity over time" />);
    expect(screen.getByText("Calendar month")).toBeInTheDocument();
    expect(screen.getByText("Number of records")).toBeInTheDocument();
    expect(screen.getByLabelText("Feb 26: 2 Learning Walks records")).toBeInTheDocument();
  });

  it("shows pie values and percentages in an accessible legend", () => {
    render(<AccessiblePieChart data={[{ label: "Faculty A", value: 3 }, { label: "Faculty B", value: 1 }]} subtitle="Records by faculty" title="Organisation breakdown" />);
    expect(screen.getByLabelText("Organisation breakdown legend")).toHaveTextContent("75.0%");
    expect(screen.getByLabelText("Faculty B: 1, 25.0 percent")).toBeInTheDocument();
  });

  it("builds permanent full-record links", () => {
    render(<FullRecordLink recordId="record-123" recordType="coaching_session" />);
    expect(screen.getByRole("link", { name: /Open record/i })).toHaveAttribute("href", "#/records/coaching_session/record-123");
  });

  it("calculates permission-aware CPD entry actions", () => {
    expect(getCpdEntryPermissions({ permissions: ["cpd.manage", "cpd.external.submit"] })).toEqual({ canCreateCpdEvent: true, canCreateExternalCpd: true });
    expect(getCpdEntryPermissions({ permissions: ["cpd.external.submit"] })).toEqual({ canCreateCpdEvent: false, canCreateExternalCpd: true });
  });

  it("reports reflection totals without an expected maximum", () => {
    expect(getReflectionTotal(2, 7)).toBe(9);
  });

  it("always keeps five fixed Elevate status positions", () => {
    render(<ElevateStatusTiles achievedLevels={1} />);
    expect(screen.getAllByLabelText(/Level \d (achieved|not achieved)/)).toHaveLength(5);
    expect(screen.getByLabelText("Level 1 achieved")).toHaveClass("elevate-status-slot-active");
    expect(screen.getByLabelText("Level 5 not achieved")).toBeEmptyDOMElement();
  });
});
