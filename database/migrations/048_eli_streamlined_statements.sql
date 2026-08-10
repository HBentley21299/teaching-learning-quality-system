SET XACT_ABORT ON;
SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

BEGIN TRANSACTION;

DECLARE @sourceFrameworkId uniqueidentifier = (
    SELECT TOP (1) id
    FROM quality.elevate_practice_frameworks
    WHERE framework_key = N'elevate_your_practice'
      AND archived_at IS NULL
    ORDER BY is_active DESC, created_at DESC
);
DECLARE @frameworkId uniqueidentifier = '90000000-0000-0000-0000-000000000003';

IF @sourceFrameworkId IS NULL
    THROW 51000, 'An existing ELI framework is required before applying version 1.2.', 1;

INSERT INTO quality.elevate_practice_frameworks (id, framework_key, version_label, name, is_active)
SELECT @frameworkId, N'elevate_your_practice', N'1.2', N'Elevate Learning and Innovation Staff Self-Assessment', 1
WHERE NOT EXISTS (
    SELECT 1 FROM quality.elevate_practice_frameworks
    WHERE framework_key = N'elevate_your_practice' AND version_label = N'1.2'
);

UPDATE quality.elevate_practice_frameworks
SET is_active = CASE WHEN id = @frameworkId THEN 1 ELSE 0 END
WHERE framework_key = N'elevate_your_practice' AND archived_at IS NULL;

-- The response scale is governed per framework. Copy the existing scale so
-- historical assessments retain their original catalogue and wording.
INSERT INTO quality.elevate_practice_rubric_descriptors (
    id, framework_id, descriptor_key, visible_wording, guidance_text,
    hidden_numeric_value, display_order, colour_classification, colour_hex, is_active
)
SELECT NEWID(), @frameworkId, source.descriptor_key, source.visible_wording, source.guidance_text,
       source.hidden_numeric_value, source.display_order, source.colour_classification, source.colour_hex, source.is_active
FROM quality.elevate_practice_rubric_descriptors source
WHERE source.framework_id = @sourceFrameworkId
  AND source.archived_at IS NULL
  AND NOT EXISTS (
      SELECT 1 FROM quality.elevate_practice_rubric_descriptors existing
      WHERE existing.framework_id = @frameworkId AND existing.descriptor_key = source.descriptor_key
  );

DECLARE @areas TABLE (
    area_key nvarchar(100), category nvarchar(200), name nvarchar(200),
    reflection_prompt nvarchar(1000), display_order int
);
INSERT INTO @areas VALUES
(N'positive_start', N'Teaching and Learning Standards', N'Positive Start', N'What does an effective positive start look like within your practice? Provide an example where possible.', 1),
(N'planning_structure', N'Teaching and Learning Standards', N'Planning and Structure', N'How does your planning and sequencing support learner understanding and progress?', 2),
(N'delivery', N'Teaching and Learning Standards', N'Delivery', N'Describe a teaching approach that has been particularly effective with your learners.', 3),
(N'assessment', N'Teaching and Learning Standards', N'Assessment', N'Give an example of how assessment influenced what you or your learners did next.', 4),
(N'feedback', N'Teaching and Learning Standards', N'Feedback', N'Give an example of how feedback helped learners understand and improve their work.', 5),
(N'inclusion', N'Teaching and Learning Standards', N'Inclusion', N'Describe an inclusive approach or adjustment that has enabled learners to participate or progress more successfully.', 6),
(N'learner_focus', N'Teaching and Learning Standards', N'Learner Focus', N'How do you ensure that learning is responsive to individual learners and their intended destinations?', 7),
(N'digital', N'Digital Practice', N'Digital Teaching and Learning', N'Describe how digital technology has improved learning, participation, assessment, feedback or learner independence.', 8),
(N'assistive_technology', N'Digital Practice', N'Assistive Technology', N'Describe how assistive technology or accessible digital practice has reduced a barrier for learners.', 9),
(N'immersive_technology', N'Digital Practice', N'Immersive Technology', N'Describe any current or potential use of immersive technology within your curriculum and the intended benefit for learners.', 10),
(N'sustainability', N'Sustainability', N'Sustainability in Curriculum and Practice', N'How is sustainability currently reflected within your teaching, curriculum or professional practice?', 11);

INSERT INTO quality.elevate_practice_areas (
    id, framework_id, area_key, category, name, reflection_prompt, display_order
)
SELECT NEWID(), @frameworkId, area.area_key, area.category, area.name, area.reflection_prompt, area.display_order
FROM @areas area
WHERE NOT EXISTS (
    SELECT 1 FROM quality.elevate_practice_areas existing
    WHERE existing.framework_id = @frameworkId AND existing.area_key = area.area_key
);

DECLARE @statements TABLE (
    area_key nvarchar(100), statement_key nvarchar(100), statement_text nvarchar(1000), display_order int
);
INSERT INTO @statements VALUES
(N'positive_start', N'routines_environment', N'I set clear routines, expectations and professional standards in a calm and welcoming learning environment.', 1),
(N'positive_start', N'purposeful_connected_start', N'Learning starts promptly with a purposeful activity that links to previous learning and makes the purpose clear.', 2),
(N'planning_structure', N'sequenced_paced_stages', N'Learning is well sequenced, appropriately paced and broken into manageable stages.', 1),
(N'planning_structure', N'planning_needs', N'My planning considers likely misconceptions, barriers, support and challenge.', 2),
(N'planning_structure', N'curriculum_next_steps', N'Activities clearly link to the curriculum, assessment and learners’ next steps.', 3),
(N'delivery', N'clear_modelling', N'I use clear explanations, instructions, modelling and examples.', 1),
(N'delivery', N'active_learning', N'Learners actively think, discuss, practise, create or apply their learning.', 2),
(N'delivery', N'adaptive_standards', N'I adapt my teaching to learners’ needs while maintaining appropriate subject and industry standards.', 3),
(N'assessment', N'check_understanding', N'I regularly check the understanding of all learners.', 1),
(N'assessment', N'questioning_gaps', N'I use questioning to identify gaps and misconceptions.', 2),
(N'assessment', N'demonstrate_apply', N'Learners have opportunities to show and apply what they know and can do.', 3),
(N'assessment', N'adapt_next_steps', N'I use assessment to adapt my teaching and plan next steps.', 4),
(N'feedback', N'clear_improvement', N'Feedback makes clear what learners have done well and how they can improve.', 1),
(N'feedback', N'act_on_feedback', N'Learners understand and act on the feedback they receive.', 2),
(N'feedback', N'show_improvement', N'Learners have opportunities to show improvement following feedback.', 3),
(N'inclusion', N'information_support_barriers', N'I use learner information to plan appropriate support and reduce barriers to learning.', 1),
(N'inclusion', N'accessible_participation', N'Resources and activities are accessible and allow all learners to take part.', 2),
(N'inclusion', N'respected_safe_included', N'I create an environment where learners feel respected, safe and included.', 3),
(N'learner_focus', N'starting_points_goals', N'I understand learners’ starting points, goals and next steps and use these to shape learning.', 1),
(N'learner_focus', N'challenge_independence', N'Learners are appropriately challenged and supported to become more confident and independent.', 2),
(N'learner_focus', N'progress_feedback', N'Learners understand their progress, and I use their feedback to improve their learning experience.', 3),
(N'digital', N'digital_value', N'I use digital technology where it improves learning, participation, assessment or feedback.', 1),
(N'digital', N'digital_access_independence', N'Learners can easily access and use digital resources and tools to support their learning and independence.', 2),
(N'digital', N'safe_ethical_ai', N'I promote safe, responsible and ethical use of technology, including artificial intelligence.', 3),
(N'assistive_technology', N'accessibility_removes_barriers', N'I consider accessibility and use assistive technology where it helps remove barriers to learning.', 1),
(N'assistive_technology', N'confident_independent_use', N'Learners are supported to use relevant accessibility features and assistive tools confidently and independently.', 2),
(N'immersive_technology', N'immersive_curriculum_value', N'I use immersive technology where it adds clear value to the curriculum or gives learners experiences that would otherwise be difficult to provide.', 1),
(N'immersive_technology', N'immersive_purpose_reflection', N'Immersive activities have a clear purpose and help learners apply, discuss or reflect on their learning.', 2),
(N'sustainability', N'relevant_sustainability', N'I include sustainability issues that are relevant to the subject, industry or profession.', 1),
(N'sustainability', N'impact_sustainable_working', N'Learners consider the impact of their decisions and explore more sustainable ways of working.', 2);

INSERT INTO quality.elevate_practice_statements (
    id, area_id, statement_key, statement_text, display_order
)
SELECT NEWID(), area.id, statement.statement_key, statement.statement_text, statement.display_order
FROM @statements statement
JOIN quality.elevate_practice_areas area
  ON area.framework_id = @frameworkId AND area.area_key = statement.area_key
WHERE NOT EXISTS (
    SELECT 1 FROM quality.elevate_practice_statements existing
    WHERE existing.area_id = area.id AND existing.statement_key = statement.statement_key
);

COMMIT TRANSACTION;
GO
