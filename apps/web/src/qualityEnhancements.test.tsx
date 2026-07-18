// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import qualityEnhancementMigration from "../../../database/migrations/014_quality_ui_data_linking.sql?raw";
import exactEnvironmentRubricMigration from "../../../database/migrations/015_exact_environment_rubrics.sql?raw";
// @ts-expect-error This test-only virtual module is supplied by vitest.config.ts.
import applicationStyles from "virtual:application-styles";
import { CollapsibleSection } from "./components/CollapsibleSection";
import { AccessiblePieChart, MonthlyActivityChart } from "./components/DashboardCharts";
import { ActionDetailLink, FullRecordLink } from "./components/FullRecordLink";
import { ElevateStatusTiles, getReflectionTotal } from "./features/StaffProfilePanel";
import { buildMonthlyTrend } from "./routes/Dashboard";
import { getCpdEntryPermissions, ModuleWorkspace } from "./routes/ModuleWorkspace";
import type { CurrentUser, ProcessDashboardRecordSummary } from "./services/types";

vi.mock("./services/api", () => ({
  api: {
    actions: () => Promise.resolve([]),
    formDefinition: (templateKey: string) => Promise.resolve({
      templateId: `${templateKey}-template`,
      versionId: `${templateKey}-version`,
      templateKey,
      name: templateKey === "external_cpd_core" ? "External CPD" : "CPD event",
      version: "1.0",
      sections: []
    }),
    lookups: () => Promise.resolve([]),
    orgUnits: () => Promise.resolve([]),
    records: () => Promise.resolve([])
  }
}));

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
    render(<FullRecordLink recordId="7a303c60-cb51-4607-81fc-1c989452c057" recordType="coaching/session" />);
    expect(screen.getByRole("link", { name: /Open record/i })).toHaveAttribute(
      "href",
      "#/records/coaching%2Fsession/7a303c60-cb51-4607-81fc-1c989452c057"
    );
  });

  it("builds encoded action-detail links with consistent wording", () => {
    render(<ActionDetailLink actionId="action/id?revision=2" />);
    expect(screen.getByRole("link", { name: "View details" })).toHaveAttribute(
      "href",
      "#/actions/action%2Fid%3Frevision%3D2"
    );
  });

  it("calculates permission-aware CPD entry actions", () => {
    expect(getCpdEntryPermissions({ permissions: ["cpd.manage", "cpd.external.submit"] })).toEqual({ canCreateCpdEvent: true, canCreateExternalCpd: true });
    expect(getCpdEntryPermissions({ permissions: ["cpd.external.submit"] })).toEqual({ canCreateCpdEvent: false, canCreateExternalCpd: true });
  });

  it("renders only the CPD entry actions granted to the current user", () => {
    const { unmount } = render(
      <ModuleWorkspace
        eyebrow="Professional development"
        mode="cpd"
        title="CPD"
        user={currentUser(["cpd.external.submit"])}
      />
    );

    const externalOnly = screen.getByRole("button", { name: "Log External CPD" });
    expect(screen.queryByRole("button", { name: "Log a CPD Event" })).not.toBeInTheDocument();
    expect(externalOnly.closest(".cpd-entry-actions")).toHaveClass("cpd-entry-actions-single");

    unmount();
    render(
      <ModuleWorkspace
        eyebrow="Professional development"
        mode="cpd"
        title="CPD"
        user={currentUser(["cpd.manage", "cpd.external.submit"])}
      />
    );

    expect(screen.getByRole("button", { name: "Log a CPD Event" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Log External CPD" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Log External CPD" }).closest(".cpd-entry-actions"))
      .not.toHaveClass("cpd-entry-actions-single");
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

  it("keeps the Elevate status container and slots at fixed dimensions", () => {
    expect(cssRule("elevate-status-panel")).toMatch(/height:\s*168px;/);
    expect(cssRule("elevate-status-slots")).toMatch(/grid-auto-columns:\s*112px;/);
    expect(cssRule("elevate-status-slots")).toMatch(/overflow-x:\s*auto;/);
    expect(cssRule("elevate-status-slot")).toMatch(/height:\s*80px;/);
    expect(cssRule("elevate-status-slot")).toMatch(/width:\s*112px;/);
  });

  it("stacks rubric and CPD action grids at the mobile breakpoint", () => {
    const mobileRules = applicationStyles.slice(applicationStyles.indexOf("@media (max-width: 760px)"));
    expect(mobileRules).toMatch(/\.cpd-entry-actions,[\s\S]*?\.rubric-option-grid,[\s\S]*?grid-template-columns:\s*1fr;/);
    expect(cssRule("cpd-entry-actions-single")).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\);/);
  });
});

describe("quality data-linking migration contracts", () => {
  const rubricFields = [
    ["aspirational_score", "consistently communicates exceptional ambition and authenticity"],
    ["collaborative_score", "supports seamless movement between different forms of learning"],
    ["respectful_score", "A strong culture of care and shared ownership is evident"],
    ["innovative_score", "demonstrates exemplary integration of specialist resources"],
    ["inclusion_score", "Inclusion is embedded throughout the environment"]
  ] as const;

  it("defines five pillar-specific 1-5 rubrics with distinct exact descriptors", () => {
    const rubricDefinitions = rubricFields.map(([fieldKey, exactDescriptor], index) => {
      const start = exactEnvironmentRubricMigration.indexOf(`WHEN '${fieldKey}'`);
      const nextKey = rubricFields[index + 1]?.[0];
      const end = nextKey
        ? exactEnvironmentRubricMigration.indexOf(`WHEN '${nextKey}'`, start + 1)
        : exactEnvironmentRubricMigration.indexOf("ELSE field_row.configuration_json", start + 1);
      const definition = exactEnvironmentRubricMigration.slice(start, end);

      expect(start).toBeGreaterThan(-1);
      expect(end).toBeGreaterThan(start);
      expect(definition).toContain(exactDescriptor);
      for (const judgement of ["Emerging", "Developing", "Secure", "Strong", "Leading"]) {
        expect(definition).toContain(`${judgement} Practice`);
      }
      return definition;
    });

    expect(new Set(rubricDefinitions).size).toBe(5);
  });

  it("defines whole-audit commentary fields without reintroducing per-pillar working fields", () => {
    expect(qualityEnhancementMigration).toContain("'overall_working', 'What is Working', 'long_text'");
    expect(qualityEnhancementMigration).toContain("'overall_improvement', 'What Needs Improvement', 'long_text'");
    for (const legacyKey of [
      "aspirational_working",
      "collaborative_working",
      "respectful_working",
      "innovative_working",
      "inclusion_working"
    ]) {
      expect(qualityEnhancementMigration).not.toContain(`'${legacyKey}'`);
    }
  });

  it("guards schema and seeded form additions so migration 014 can be reapplied", () => {
    expect(qualityEnhancementMigration).toContain("IF OBJECT_ID('quality.staff_profile_reflections', 'U') IS NULL");
    expect(qualityEnhancementMigration).toContain("IF COL_LENGTH('quality.learning_walk_details', 'practice_observed_score') IS NULL");
    expect(qualityEnhancementMigration).toContain("IF COL_LENGTH('quality.learning_walk_details', 'practice_observed_label') IS NULL");
    expect(qualityEnhancementMigration).toContain("IF COL_LENGTH('quality.elevate_environment_assessments', 'below_secure_count') IS NULL");
    expect(qualityEnhancementMigration.match(/WHERE NOT EXISTS/g)?.length ?? 0).toBeGreaterThanOrEqual(8);
    expect(exactEnvironmentRubricMigration).toContain("UPDATE field_row");
    expect(exactEnvironmentRubricMigration).toContain("WHERE section_row.form_template_version_id = @environmentVersion");
    expect(exactEnvironmentRubricMigration).toMatch(/IF @learningWalkContext IS NOT NULL\s+AND NOT EXISTS/);
  });
});

function currentUser(permissions: string[]): CurrentUser {
  return {
    userAccountId: "user-1",
    staffId: "staff-1",
    displayName: "Test Tutor",
    email: "test.tutor@example.test",
    permissions,
    scopes: []
  };
}

function cssRule(className: string) {
  const match = applicationStyles.match(new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`));
  expect(match, `Expected .${className} CSS rule`).not.toBeNull();
  return match?.[1] ?? "";
}
