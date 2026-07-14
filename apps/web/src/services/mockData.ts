import type {
  ActionSummary,
  CurrentUser,
  DashboardSummary,
  FormDefinition,
  FormTemplateSummary,
  LearningWalkThemeMappingSummary,
  LearningWalkRollupSummary,
  ModuleSummary,
  OrgUnitSummary,
  RecordDetail,
  RecordSummary,
  StaffProfileSummary,
  StaffSummary
} from "./types";

export const mockUser: CurrentUser = {
  displayName: "Harry Bentley",
  email: "harryjbentley@outlook.com",
  permissions: [
    "staff.read",
    "staff.manage",
    "users.manage",
    "permissions.manage",
    "forms.manage",
    "liv.manage",
    "liv.submit",
    "liv.actions.close",
    "learning_walk.submit",
    "work_scrutiny.submit",
    "cpd.manage",
    "evidence.submit",
    "evidence.review",
    "actions.manage",
    "reports.view_all",
    "reports.view_scoped"
  ],
  scopes: [{ scopeType: "global" }]
};

export const mockModules: ModuleSummary[] = [
  {
    id: "50000000-0000-0000-0000-000000000001",
    moduleKey: "staff",
    name: "Staff Management",
    description: "Staff profiles, manager hierarchy and CSV import.",
    routePrefix: "/staff",
    displayOrder: 10,
    isEnabled: true
  },
  {
    id: "50000000-0000-0000-0000-000000000003",
    moduleKey: "learning_walks",
    name: "Learning Walks",
    description: "Learning walk records and configurable form submissions.",
    routePrefix: "/learning-walks",
    displayOrder: 30,
    isEnabled: true
  },
  {
    id: "50000000-0000-0000-0000-000000000006",
    moduleKey: "liv",
    name: "Learning and Innovation Visits",
    description: "Structured LIV records, staff linkage, follow-up and actions.",
    routePrefix: "/liv",
    displayOrder: 35,
    isEnabled: true
  },
  {
    id: "50000000-0000-0000-0000-000000000004",
    moduleKey: "work_scrutiny",
    name: "Work Scrutiny",
    description: "Work scrutiny reviews, findings and actions.",
    routePrefix: "/work-scrutiny",
    displayOrder: 40,
    isEnabled: true
  },
  {
    id: "50000000-0000-0000-0000-000000000005",
    moduleKey: "cpd",
    name: "CPD Management",
    description: "Events, attendance and milestone tracking.",
    routePrefix: "/cpd",
    displayOrder: 50,
    isEnabled: true
  }
];

export const mockStaff: StaffSummary[] = [
  {
    id: "40000000-0000-0000-0000-000000000001",
    externalId: "STAFF_0001",
    displayName: "Harry Bentley",
    email: "harryjbentley@outlook.com",
    jobTitle: "Digital Teaching & Learning Lead",
    accountStatus: "active",
    orgUnitIds: []
  },
  {
    id: "40000000-0000-0000-0000-000000000002",
    externalId: "STAFF_0002",
    displayName: "Example Staff Member",
    email: "example.staff@college.example",
    jobTitle: "Lecturer",
    accountStatus: "active",
    orgUnitIds: []
  }
];

export const mockActions: ActionSummary[] = [
  {
    id: "ACT-001",
    ownerStaffId: "40000000-0000-0000-0000-000000000002",
    subjectStaffId: "40000000-0000-0000-0000-000000000002",
    title: "Upload winter impact evidence",
    detail: "Add implementation notes and at least one supporting file.",
    sourceFormType: "standalone",
    dueDate: "2026-12-18",
    visibilitySetting: "staff_and_management",
    publishedToStaff: true,
    isOverdue: false,
    extensionCount: 0,
    createdAt: "2026-09-01T09:00:00Z",
    isDeleted: false
  },
  {
    id: "ACT-002",
    ownerStaffId: "40000000-0000-0000-0000-000000000001",
    title: "Review work scrutiny findings",
    sourceFormType: "work_scrutiny",
    dueDate: "2026-10-04",
    visibilitySetting: "staff_and_management",
    publishedToStaff: true,
    isOverdue: false,
    extensionCount: 0,
    createdAt: "2026-09-02T09:00:00Z",
    isDeleted: false
  }
];

export const mockDashboards: DashboardSummary[] = [
  {
    id: "60000000-0000-0000-0000-000000000001",
    dashboardKey: "tl_overview",
    name: "T&L Overview",
    purpose: "Whole-system view of walks, scrutiny, CPD, evidence and actions.",
    primaryPermissionKey: "reports.view_all",
    facultyScopeRequired: false
  },
  {
    id: "60000000-0000-0000-0000-000000000002",
    dashboardKey: "faculty_dashboard",
    name: "Faculty Dashboard",
    purpose: "Restricted faculty view for leaders and managers.",
    primaryPermissionKey: "reports.view_scoped",
    facultyScopeRequired: true
  }
];

export const mockStaffProfiles: StaffProfileSummary[] = [
  {
    staffId: "40000000-0000-0000-0000-000000000001",
    externalId: "STAFF_0001",
    displayName: "Harry Bentley",
    email: "harryjbentley@outlook.com",
    jobTitle: "Digital Teaching & Learning Lead",
    primaryOrgCode: "T&L",
    cpdSessionsAttended: 5,
    evidenceRecords: 3,
    openActions: 1,
    overdueActions: 0
  },
  {
    staffId: "40000000-0000-0000-0000-000000000002",
    externalId: "STAFF_0002",
    displayName: "Example Staff Member",
    email: "example.staff@college.example",
    jobTitle: "Lecturer",
    primaryOrgCode: "CUDCPA",
    cpdSessionsAttended: 1,
    evidenceRecords: 1,
    openActions: 1,
    overdueActions: 0
  }
];

export const mockOrgUnits: OrgUnitSummary[] = [
  {
    id: "20000000-0000-0000-0000-000000000002",
    orgUnitType: "faculty",
    code: "CUCP",
    name: "Health, Social Care, Early Years & Science",
    isActive: true
  },
  {
    id: "20000000-0000-0000-0000-000000000021",
    parentOrgUnitId: "20000000-0000-0000-0000-000000000002",
    orgUnitType: "faculty_child_code",
    code: "CUCPHS",
    name: "Health & Social Care",
    isActive: true
  },
  {
    id: "20000000-0000-0000-0000-000000000022",
    parentOrgUnitId: "20000000-0000-0000-0000-000000000002",
    orgUnitType: "faculty_child_code",
    code: "CUCPEY",
    name: "Early Years",
    isActive: true
  },
  {
    id: "20000000-0000-0000-0000-000000000023",
    parentOrgUnitId: "20000000-0000-0000-0000-000000000002",
    orgUnitType: "faculty_child_code",
    code: "CUCPSC",
    name: "Science",
    isActive: true
  },
  {
    id: "20000000-0000-0000-0000-000000000003",
    orgUnitType: "faculty",
    code: "CUDCPA",
    name: "Digital, Creative & Performing Arts",
    isActive: true
  }
];

export const mockLearningWalkThemeMappings: LearningWalkThemeMappingSummary[] = [
  {
    id: "8a000000-0000-0000-0000-000000000001",
    facultyOrgUnitId: "20000000-0000-0000-0000-000000000002",
    childOrgUnitId: "20000000-0000-0000-0000-000000000021",
    agreedTheme: "Embedding inclusive practice and learner progress checks"
  },
  {
    id: "8a000000-0000-0000-0000-000000000002",
    facultyOrgUnitId: "20000000-0000-0000-0000-000000000002",
    childOrgUnitId: "20000000-0000-0000-0000-000000000022",
    agreedTheme: "Questioning and formative assessment in practical learning"
  },
  {
    id: "8a000000-0000-0000-0000-000000000003",
    facultyOrgUnitId: "20000000-0000-0000-0000-000000000002",
    childOrgUnitId: "20000000-0000-0000-0000-000000000023",
    agreedTheme: "Assessment for learning and stretch in theory sessions"
  }
];

export const mockFormTemplates: FormTemplateSummary[] = [
  {
    id: "70000000-0000-0000-0000-000000000001",
    moduleId: "50000000-0000-0000-0000-000000000003",
    moduleKey: "learning_walks",
    moduleName: "Learning Walks",
    templateKey: "learning_walk_core",
    name: "Learning Walk Core Template",
    version: "1.1",
    status: "Published",
    isEditable: false,
    assignedOrgUnits: [],
    submissionCount: 0
  },
  {
    id: "74000000-0000-0000-0000-000000000001",
    moduleId: "50000000-0000-0000-0000-000000000004",
    moduleKey: "work_scrutiny",
    moduleName: "Work Scrutiny",
    templateKey: "work_scrutiny_cudcpa",
    name: "Work Scrutiny - Digital, Creative & Performing Arts",
    version: "0.1",
    status: "Draft",
    isEditable: true,
    assignedOrgUnits: [
      {
        id: "20000000-0000-0000-0000-000000000003",
        code: "CUDCPA",
        name: "Digital, Creative & Performing Arts"
      }
    ],
    submissionCount: 0
  }
];

export const mockLearningWalkDefinition: FormDefinition = {
  templateId: "70000000-0000-0000-0000-000000000001",
  versionId: "71000000-0000-0000-0000-000000000011",
  templateKey: "learning_walk_core",
  name: "Learning Walk Core Template",
  version: "1.1",
  sections: [
    {
      id: "72000000-0000-0000-0000-000000000011",
      sectionKey: "context",
      title: "Context",
      displayOrder: 1,
      fields: [
        {
          id: "73000000-0000-0000-0000-000000000011",
          fieldKey: "visit_date",
          label: "Date of visit",
          fieldType: "date",
          isRequired: true,
          displayOrder: 1
        },
        {
          id: "73000000-0000-0000-0000-000000000012",
          fieldKey: "faculty_area",
          label: "Faculty Area",
          fieldType: "faculty_lookup",
          isRequired: true,
          displayOrder: 2
        },
        {
          id: "73000000-0000-0000-0000-000000000013",
          fieldKey: "team_level",
          label: "Team Level",
          fieldType: "team_lookup",
          isRequired: true,
          displayOrder: 3
        },
        {
          id: "73000000-0000-0000-0000-000000000014",
          fieldKey: "learning_walk_theme",
          label: "Learning Walk Theme",
          fieldType: "auto_text",
          isRequired: true,
          displayOrder: 4
        },
        {
          id: "73000000-0000-0000-0000-000000000015",
          fieldKey: "additional_focus_context",
          label: "Additional Focus / Context",
          fieldType: "long_text",
          isRequired: false,
          displayOrder: 5
        }
      ]
    },
    {
      id: "72000000-0000-0000-0000-000000000012",
      sectionKey: "findings",
      title: "Findings",
      displayOrder: 2,
      fields: [
        {
          id: "73000000-0000-0000-0000-000000000016",
          fieldKey: "good_practice",
          label: "Areas of Good Practice Identified",
          fieldType: "long_text",
          isRequired: true,
          displayOrder: 10
        },
        {
          id: "73000000-0000-0000-0000-000000000017",
          fieldKey: "development_areas",
          label: "Areas for Development Identified",
          fieldType: "long_text",
          isRequired: true,
          displayOrder: 20
        }
      ]
    },
    {
      id: "72000000-0000-0000-0000-000000000013",
      sectionKey: "follow_up",
      title: "Follow-up",
      displayOrder: 3,
      fields: [
        {
          id: "73000000-0000-0000-0000-000000000018",
          fieldKey: "actions_next_steps",
          label: "Actions / Next Steps",
          fieldType: "long_text",
          isRequired: false,
          displayOrder: 30
        }
      ]
    }
  ]
};

export const mockRecords: RecordSummary[] = [
  {
    id: "90000000-0000-0000-0000-000000000001",
    moduleId: "50000000-0000-0000-0000-000000000003",
    recordType: "learning_walk",
    title: "Learning Walk - CUCPSC",
    orgUnitId: "20000000-0000-0000-0000-000000000023",
    recordDate: "2026-09-18",
    createdAt: "2026-09-18T10:00:00Z",
    submissionStatus: "submitted"
  }
];

export const mockLearningWalkDetail: RecordDetail = {
  id: "90000000-0000-0000-0000-000000000001",
  moduleKey: "learning_walks",
  moduleName: "Learning Walks",
  recordType: "learning_walk",
  title: "Learning Walk - CUCPSC",
  summary: "Assessment for learning and stretch in theory sessions",
  orgUnitId: "20000000-0000-0000-0000-000000000023",
  orgUnitCode: "CUCPSC",
  orgUnitName: "Science",
  parentOrgUnitCode: "CUCP",
  recordDate: "2026-09-18",
  createdAt: "2026-09-18T10:00:00Z",
  ownerDisplayName: "Harry Bentley",
  submissionId: "91000000-0000-0000-0000-000000000001",
  templateKey: "learning_walk_core",
  templateName: "Learning Walk Core Template",
  templateVersion: "1.1",
  submissionStatus: "submitted",
  submittedAt: "2026-09-18T10:00:00Z",
  canEdit: true,
  courseIds: [],
  sections: mockLearningWalkDefinition.sections.map((section) => ({
    ...section,
    fields: section.fields.map((field) => ({
      ...field,
      value:
        field.fieldKey === "visit_date"
          ? "2026-09-18"
          : field.fieldKey === "faculty_area"
            ? "20000000-0000-0000-0000-000000000002"
            : field.fieldKey === "team_level"
              ? "20000000-0000-0000-0000-000000000023"
              : field.fieldKey === "learning_walk_theme"
                ? "Assessment for learning and stretch in theory sessions"
                : field.fieldKey === "good_practice"
                  ? "Learners were able to explain what they were working on and how feedback would improve the next attempt."
                  : field.fieldKey === "development_areas"
                    ? "Build more consistent stretch questions into checking for understanding."
                    : ""
    }))
  }))
};

export const mockLearningWalkRollup: LearningWalkRollupSummary[] = [
  {
    facultyOrgUnitId: "20000000-0000-0000-0000-000000000002",
    facultyCode: "CUCP",
    facultyName: "Health, Social Care, Early Years & Science",
    childOrgUnitId: "20000000-0000-0000-0000-000000000023",
    childCode: "CUCPSC",
    childName: "Science",
    recordCount: 1,
    latestRecordDate: "2026-09-18"
  }
];
