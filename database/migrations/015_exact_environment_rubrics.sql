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

-- Correct already-deployed v2 Learning Environment fields to the approved
-- pillar-specific rubric wording. Historical responses retain the exact token
-- that was selected at the time; all new selections use this configuration.
DECLARE @environmentVersion uniqueidentifier = '80000000-0000-0000-0000-000000000003';

UPDATE field_row
SET configuration_json = CASE field_row.field_key
        WHEN 'aspirational_score' THEN N'{"options":["1::Emerging Practice::The environment inconsistently communicates high expectations. Presentation, organisation, condition or subject identity may limit learner pride and readiness.::#B42318","2::Developing Practice::Some areas reflect care, ambition and professional standards, but these are inconsistent or not yet embedded throughout the space.::#E56B1F","3::Secure Practice::The environment is well maintained, purposeful and appropriate for its intended use. It supports high standards and provides a professional learning setting.::#D7A700","4::Strong Practice::The space is thoughtfully organised and presented, reflects the curriculum or industry context, and encourages learners to take pride in their work.::#69A84F","5::Leading Practice::The environment consistently communicates exceptional ambition and authenticity. Learners demonstrate strong ownership, pride and professional behaviours within the space.::#237A3B"]}'
        WHEN 'collaborative_score' THEN N'{"options":["1::Emerging Practice::The organisation of the room or access to resources restricts interaction, participation or shared learning where these are appropriate.::#B42318","2::Developing Practice::Some opportunities for collaboration are available, but the room’s organisation or use does not consistently support effective participation.::#E56B1F","3::Secure Practice::The space supports the intended balance of independent, paired, group, practical or teacher-led learning.::#D7A700","4::Strong Practice::The environment is deliberately organised to promote communication, peer learning, shared problem-solving and active participation.::#69A84F","5::Leading Practice::The space supports seamless movement between different forms of learning and enables learners to collaborate confidently, independently and purposefully.::#237A3B"]}'
        WHEN 'respectful_score' THEN N'{"options":["1::Emerging Practice::Issues with cleanliness, maintenance, comfort, safety or organisation undermine dignity, wellbeing or effective learning.::#B42318","2::Developing Practice::The space is generally usable, but standards of care, organisation or comfort are inconsistent.::#E56B1F","3::Secure Practice::The environment is clean, safe, orderly and well cared for. It supports learner dignity, comfort and professional conduct.::#D7A700","4::Strong Practice::The space is intentionally organised to promote calm, belonging, shared responsibility and positive learning behaviours.::#69A84F","5::Leading Practice::A strong culture of care and shared ownership is evident. The environment exceptionally supports dignity, wellbeing, respect and professional standards.::#237A3B"]}'
        WHEN 'innovative_score' THEN N'{"options":["1::Emerging Practice::Available equipment, technology or learning resources are unreliable, inaccessible, unsuitable or insufficiently used to support learning.::#B42318","2::Developing Practice::Some appropriate resources are available and used, but implementation is inconsistent or dependent on repeated workarounds.::#E56B1F","3::Secure Practice::Technology, specialist equipment and other resources are functional, accessible and used appropriately to support the intended learning.::#D7A700","4::Strong Practice::The environment enables purposeful experimentation, creativity, simulation, authentic practice or new approaches to learning.::#69A84F","5::Leading Practice::The space demonstrates exemplary integration of specialist resources, technology and learning design, significantly extending what learners can experience and achieve.::#237A3B"]}'
        WHEN 'inclusion_score' THEN N'{"options":["1::Emerging Practice::Significant barriers affect access, communication, navigation, sensory comfort, independence or participation.::#B42318","2::Developing Practice::Some inclusive features or adjustments are in place, but they are inconsistent, reactive or reliant on individual workarounds.::#E56B1F","3::Secure Practice::The environment supports safe, dignified and equitable participation, with reasonable adjustments available where required.::#D7A700","4::Strong Practice::The space anticipates a range of learner needs and provides appropriate flexibility, choice and support without reducing ambition.::#69A84F","5::Leading Practice::Inclusion is embedded throughout the environment. The space is highly accessible, adaptable and enabling, allowing diverse learners to participate independently and meaningfully.::#237A3B"]}'
        ELSE field_row.configuration_json
    END,
    updated_at = sysutcdatetime()
FROM forms.form_fields field_row
JOIN forms.form_sections section_row ON section_row.id = field_row.form_section_id
WHERE section_row.form_template_version_id = @environmentVersion
  AND field_row.field_key IN (
      'aspirational_score', 'collaborative_score', 'respectful_score',
      'innovative_score', 'inclusion_score'
  )
  AND field_row.archived_at IS NULL;

-- New Learning Walks must be linked to the observed staff member so the
-- judgement and complete record can appear on that Staff Profile. The field is
-- added to the existing v3 context section without changing historical forms.
DECLARE @learningWalkVersion uniqueidentifier = '71000000-0000-0000-0000-000000000012';
DECLARE @learningWalkContext uniqueidentifier = (
    SELECT id
    FROM forms.form_sections
    WHERE form_template_version_id = @learningWalkVersion
      AND section_key = 'context'
      AND archived_at IS NULL
);

IF @learningWalkContext IS NOT NULL
   AND NOT EXISTS (
       SELECT 1
       FROM forms.form_fields
       WHERE form_section_id = @learningWalkContext
         AND field_key = 'staff_id'
         AND archived_at IS NULL
   )
BEGIN
    INSERT INTO forms.form_fields (
        id, form_section_id, field_key, label, field_type, is_required,
        display_order, help_text, configuration_json
    )
    VALUES (
        '73000000-0000-0000-0000-000000000030', @learningWalkContext,
        'staff_id', 'Staff member observed', 'staff_lookup', 1, 40,
        N'Select the staff member whose practice was observed so the complete record is linked to their Staff Profile.',
        NULL
    );
END;

COMMIT TRANSACTION;
GO
