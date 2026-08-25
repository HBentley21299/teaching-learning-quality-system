SET XACT_ABORT ON;
SET NOCOUNT ON;
GO

BEGIN TRANSACTION;

IF OBJECT_ID(N'qa.evidence_team_scopes', N'U') IS NULL
BEGIN
    CREATE TABLE qa.evidence_team_scopes (
        evidence_record_id uniqueidentifier NOT NULL,
        team_org_unit_id uniqueidentifier NOT NULL,
        faculty_org_unit_id uniqueidentifier NOT NULL,
        faculty_code_snapshot nvarchar(50) NOT NULL,
        faculty_name_snapshot nvarchar(250) NOT NULL,
        team_code_snapshot nvarchar(50) NOT NULL,
        team_name_snapshot nvarchar(250) NOT NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_qa_evidence_team_scopes_created DEFAULT sysutcdatetime(),
        CONSTRAINT pk_qa_evidence_team_scopes PRIMARY KEY (evidence_record_id, team_org_unit_id),
        CONSTRAINT fk_qa_evidence_team_scopes_evidence FOREIGN KEY (evidence_record_id) REFERENCES qa.evidence_submissions(record_id),
        CONSTRAINT fk_qa_evidence_team_scopes_team FOREIGN KEY (team_org_unit_id) REFERENCES org.org_units(id),
        CONSTRAINT fk_qa_evidence_team_scopes_faculty FOREIGN KEY (faculty_org_unit_id) REFERENCES org.org_units(id)
    );
END;

INSERT INTO qa.evidence_team_scopes (
    evidence_record_id, team_org_unit_id, faculty_org_unit_id,
    faculty_code_snapshot, faculty_name_snapshot, team_code_snapshot, team_name_snapshot
)
SELECT evidence.record_id, evidence.team_org_unit_id, evidence.faculty_org_unit_id,
       evidence.faculty_code_snapshot, evidence.faculty_name_snapshot,
       evidence.team_code_snapshot, evidence.team_name_snapshot
FROM qa.evidence_submissions evidence
WHERE NOT EXISTS (
    SELECT 1 FROM qa.evidence_team_scopes scope
    WHERE scope.evidence_record_id = evidence.record_id AND scope.team_org_unit_id = evidence.team_org_unit_id
);

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE object_id = OBJECT_ID(N'qa.evidence_team_scopes') AND name = N'ix_qa_evidence_team_scopes_coverage'
)
BEGIN
    CREATE INDEX ix_qa_evidence_team_scopes_coverage
        ON qa.evidence_team_scopes(team_org_unit_id, evidence_record_id)
        INCLUDE (faculty_org_unit_id, faculty_name_snapshot, team_name_snapshot);
END;

COMMIT TRANSACTION;
GO
