SET NOCOUNT ON;
SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET ARITHABORT ON;
SET NUMERIC_ROUNDABORT OFF;
GO

BEGIN TRANSACTION;

-- This is a new form version, not a conversion of existing responses. Historical
-- submissions, custom drafts, course links, actions and reporting tables are untouched.
DECLARE @moduleId uniqueidentifier = (SELECT id FROM core.modules WHERE module_key = N'work_scrutiny');
IF @moduleId IS NULL
    THROW 51000, 'The Work Scrutiny module must exist before its Quality Review form is installed.', 1;

DECLARE @versionLabel nvarchar(50) = N'quality-review-2026.1';
DECLARE @now datetimeoffset = sysutcdatetime();
DECLARE @versions TABLE (template_id uniqueidentifier PRIMARY KEY, version_id uniqueidentifier NOT NULL);

-- The existing form editor allocates a template to one sub-team. Supply the
-- standard form to uncovered teams using that same model, without taking over
-- assignments belonging to a custom draft or an existing published template.
DECLARE @uncoveredTeams TABLE (team_id uniqueidentifier PRIMARY KEY, template_id uniqueidentifier NOT NULL, template_key nvarchar(100) NOT NULL, template_name nvarchar(250) NOT NULL);
INSERT @uncoveredTeams (team_id, template_id, template_key, template_name)
SELECT team.id, newid(), N'work_scrutiny_quality_' + CONVERT(nvarchar(36), team.id),
       LEFT(N'Work Scrutiny - ' + team.code + N' - ' + team.name, 250)
FROM org.org_units team
JOIN org.org_units faculty ON faculty.id = team.parent_org_unit_id
WHERE team.org_unit_type IN (N'team', N'faculty_child_code', N'faculty_child')
  AND team.is_active = 1 AND team.archived_at IS NULL
  AND faculty.org_unit_type = N'faculty' AND faculty.is_active = 1 AND faculty.archived_at IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM forms.form_template_org_units assignment
      JOIN forms.form_templates assigned ON assigned.id = assignment.form_template_id
      WHERE assignment.org_unit_id = team.id AND assignment.archived_at IS NULL
        AND assigned.module_id = @moduleId AND assigned.is_active = 1 AND assigned.archived_at IS NULL
  )
  -- A deliberate later archive of an installed template must not be undone by a rerun.
  AND NOT EXISTS (SELECT 1 FROM forms.form_templates installed
                  WHERE installed.template_key = N'work_scrutiny_quality_' + CONVERT(nvarchar(36), team.id));

INSERT forms.form_templates (id, module_id, template_key, name, description, is_active)
SELECT template_id, @moduleId, template_key, template_name,
       N'Work Scrutiny Quality Review: sample context, five statement groups, review summary and triangulation. Actions and follow-up use the linked action workflow.', 1
FROM @uncoveredTeams;

INSERT forms.form_template_org_units (form_template_id, org_unit_id)
SELECT template_id, team_id FROM @uncoveredTeams;

INSERT @versions (template_id, version_id)
SELECT template_id, newid() FROM @uncoveredTeams;

INSERT forms.form_template_versions (id, form_template_id, version_label, active_from, is_published)
SELECT version_id, template_id, @versionLabel, @now, 1 FROM @versions;

DECLARE @sectionDefinitions TABLE (section_key nvarchar(100) PRIMARY KEY, title nvarchar(250) NOT NULL, display_order int NOT NULL);
INSERT @sectionDefinitions VALUES
    (N'sample_details', N'Sample details', 10),
    (N'curriculum_expectations', N'1. Curriculum & Expectations', 20),
    (N'progress_learning', N'2. Progress & Learning', 30),
    (N'assessment_feedback', N'3. Assessment & Feedback', 40),
    (N'inclusion_support_challenge', N'4. Inclusion, Support & Challenge', 50),
    (N'vocational_wider_skills', N'5. Vocational & Wider Skills', 60),
    (N'review_summary', N'Review summary', 70),
    (N'triangulation', N'Triangulation', 80);

INSERT forms.form_sections (form_template_version_id, section_key, title, display_order)
SELECT version.version_id, section.section_key, section.title, section.display_order
FROM @versions version CROSS JOIN @sectionDefinitions section;

DECLARE @rubric nvarchar(max) = N'{"options":["Emerging","Developing","Secure","Strong","Exceptional","N/A"]}';
DECLARE @overall nvarchar(max) = N'{"options":["Emerging","Developing","Secure","Strong","Exceptional"]}';
DECLARE @fields TABLE (
    section_key nvarchar(100) NOT NULL, field_key nvarchar(100) NOT NULL,
    label nvarchar(300) NOT NULL, field_type nvarchar(50) NOT NULL,
    is_required bit NOT NULL, display_order int NOT NULL,
    help_text nvarchar(1000) NULL, configuration_json nvarchar(max) NULL
);

-- Reviewer, review date, faculty, sub-team and sampled courses are already
-- captured by the record workflow and are intentionally not duplicated here.
INSERT @fields VALUES
    (N'sample_details', N'qualification_level', N'Qualification / level', N'short_text', 0, 10, N'Add the level or qualification where it is not clear from the selected courses.', NULL),
    (N'sample_details', N'staff_members', N'Staff members sampled (optional)', N'short_text', 0, 15, N'Add staff names where useful for interpreting the sample. The record reviewer and course allocations are held separately by the system.', NULL),
    (N'sample_details', N'sample_size', N'Number of learners sampled', N'number', 1, 20, N'Enter the number of learners whose work is included in this sample.', NULL),
    (N'sample_details', N'evidence_sampled', N'Evidence sampled', N'checkbox_group', 0, 30, N'Select all evidence types included in the review.', N'{"options":["Digital work","Paper-based work","Practical evidence","Portfolio evidence","Assessment evidence","Other"]}'),
    (N'sample_details', N'evidence_other', N'Other evidence sampled', N'short_text', 0, 40, N'Complete if you selected Other.', NULL),
    (N'sample_details', N'sample_representation', N'Sample representation', N'checkbox_group', 0, 50, N'Where appropriate, the sample should include learners with different starting points, attainment levels and support needs.', N'{"options":["Range of attainment levels","SEND / High Needs","Disadvantaged learners","Learners requiring English and/or maths development","Other"]}'),
    (N'sample_details', N'sample_representation_other', N'Other sample representation', N'short_text', 0, 60, N'Complete if you selected Other. Describe the sample rather than identifying individual learners.', NULL),
    (N'curriculum_expectations', N'ws_curriculum_1', N'1.1 Learner work reflects an appropriately ambitious curriculum and the expected standard for the programme and level.', N'rubric_scale', 1, 10, N'Emerging: Evidence is limited, inconsistent or not yet sufficiently established. Significant development is required. Developing: Appropriate practice is evident in places but is inconsistent or not yet having sufficient impact across the sample. Secure: Expected practice is consistently evident and supports appropriate learner progress. Strong: Practice is consistently effective, well embedded and demonstrates clear positive impact on learners. Exceptional: Practice is highly effective, sustained and exemplary, with compelling evidence of impact that could inform wider practice. Secure represents the expected organisational standard. Select N/A where the statement is not applicable to the sample.', @rubric),
    (N'curriculum_expectations', N'ws_curriculum_2', N'1.2 Learning activities and assessed work demonstrate appropriate sequencing, with learners building knowledge, skills and behaviours over time.', N'rubric_scale', 1, 20, NULL, @rubric),
    (N'curriculum_expectations', N'ws_curriculum_3', N'1.3 Learners are routinely expected to produce work appropriate to their stage of learning and qualification requirements.', N'rubric_scale', 1, 30, NULL, @rubric),
    (N'curriculum_expectations', N'ws_curriculum_comments', N'Evidence / comments', N'long_text', 0, 40, N'Summarise the evidence supporting these judgements and explain any N/A responses where helpful.', NULL),
    (N'progress_learning', N'ws_progress_1', N'2.1 Learner work demonstrates development in knowledge, skills and/or professional behaviours over time.', N'rubric_scale', 1, 10, NULL, @rubric),
    (N'progress_learning', N'ws_progress_2', N'2.2 Learners increasingly apply previous learning to more demanding, complex or independent work.', N'rubric_scale', 1, 20, NULL, @rubric),
    (N'progress_learning', N'ws_progress_3', N'2.3 There is evidence that gaps, errors or misconceptions are identified and subsequently addressed.', N'rubric_scale', 1, 30, NULL, @rubric),
    (N'progress_learning', N'ws_progress_comments', N'Evidence / comments', N'long_text', 0, 40, N'Summarise the evidence supporting these judgements and explain any N/A responses where helpful.', NULL),
    (N'assessment_feedback', N'ws_assessment_1', N'3.1 Assessment activity provides meaningful opportunities to establish what learners know, understand and can do.', N'rubric_scale', 1, 10, NULL, @rubric),
    (N'assessment_feedback', N'ws_assessment_2', N'3.2 Feedback helps learners understand what they have achieved and what they need to improve.', N'rubric_scale', 1, 20, NULL, @rubric),
    (N'assessment_feedback', N'ws_assessment_3', N'3.3 There is evidence that learners respond to assessment and feedback and improve subsequent work, knowledge or performance.', N'rubric_scale', 1, 30, NULL, @rubric),
    (N'assessment_feedback', N'ws_assessment_comments', N'Evidence / comments', N'long_text', 0, 40, N'Summarise the evidence supporting these judgements and explain any N/A responses where helpful.', NULL),
    (N'inclusion_support_challenge', N'ws_inclusion_1', N'4.1 Learners with different starting points and needs are enabled to access and demonstrate the intended learning.', N'rubric_scale', 1, 10, NULL, @rubric),
    (N'inclusion_support_challenge', N'ws_inclusion_2', N'4.2 Support enables learners to make progress without unnecessarily reducing challenge, independence or ambition.', N'rubric_scale', 1, 20, NULL, @rubric),
    (N'inclusion_support_challenge', N'ws_inclusion_3', N'4.3 Learners who are ready to progress further are appropriately challenged to extend their knowledge, skills or performance.', N'rubric_scale', 1, 30, NULL, @rubric),
    (N'inclusion_support_challenge', N'ws_inclusion_comments', N'Evidence / comments', N'long_text', 0, 40, N'Summarise the evidence supporting these judgements and explain any N/A responses where helpful.', NULL),
    (N'vocational_wider_skills', N'ws_vocational_1', N'5.1 Where appropriate, learner work reflects current vocational, professional or industry expectations.', N'rubric_scale', 1, 10, NULL, @rubric),
    (N'vocational_wider_skills', N'ws_vocational_2', N'5.2 Learners develop relevant technical skills, professional behaviours and independence through their work.', N'rubric_scale', 1, 20, NULL, @rubric),
    (N'vocational_wider_skills', N'ws_vocational_3', N'5.3 English, mathematics and digital skills are developed meaningfully where relevant to the curriculum and learner progression.', N'rubric_scale', 1, 30, NULL, @rubric),
    (N'vocational_wider_skills', N'ws_vocational_comments', N'Evidence / comments', N'long_text', 0, 40, N'Summarise the evidence supporting these judgements and explain any N/A responses where helpful.', NULL),
    (N'review_summary', N'strengths', N'Key strengths', N'long_text', 1, 10, N'What does the sample indicate is working particularly well?', NULL),
    (N'review_summary', N'development_areas', N'Areas for development', N'long_text', 1, 20, N'What does the sample indicate needs to be strengthened? If none were identified, state that.', NULL),
    (N'review_summary', N'overall_picture', N'Overall picture', N'single_select', 1, 30, N'Select your overall professional judgement of this sample. This is a qualitative summary, not an automatically calculated average.', @overall),
    (N'triangulation', N'triangulation_sources', N'Further evidence to validate the findings', N'checkbox_group', 0, 10, N'Select the evidence to consider, or No further validation required.', N'{"options":["No further validation required","Learning Walk","Student Voice","Achievement data","Attendance data","Retention data","Curriculum planning / Scheme of Learning","Digital learning evidence","Assessment data","Professional discussion","Other"]}'),
    (N'triangulation', N'triangulation_other', N'Other triangulation source', N'short_text', 0, 20, N'Complete if you selected Other.', NULL),
    (N'triangulation', N'triangulation_notes', N'Additional context / triangulation required', N'long_text', 0, 30, N'Explain any further validation needed. Create linked actions for owners, due dates, follow-up and impact evidence.', NULL);

INSERT forms.form_fields (form_section_id, field_key, label, field_type, is_required, display_order, help_text, configuration_json)
SELECT section.id, field.field_key, field.label, field.field_type, field.is_required,
       field.display_order, field.help_text, field.configuration_json
FROM forms.form_sections section
JOIN @versions version ON version.version_id = section.form_template_version_id
JOIN @fields field ON field.section_key = section.section_key;

COMMIT TRANSACTION;
GO
