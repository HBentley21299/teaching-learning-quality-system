SET NOCOUNT ON;
SET XACT_ABORT ON;

BEGIN TRANSACTION;

INSERT INTO core.admin_managed_lists (
    lookup_type_id,
    category,
    description,
    display_order
)
SELECT
    type.id,
    source.category,
    source.description,
    source.display_order
FROM (VALUES
    (N'action_theme_learning_walk', N'Learning Walk', N'Action themes available on Learning Walk actions.', 100),
    (N'action_theme_elevate_environment', N'Learning Environment', N'Action themes available on Learning Environment actions.', 110),
    (N'action_theme_work_scrutiny', N'Work Scrutiny', N'Action themes available on Work Scrutiny actions.', 120),
    (N'action_theme_coaching_mentoring', N'Coaching and Mentoring', N'Action themes available on Coaching and Mentoring actions.', 130),
    (N'action_theme_liv', N'LIV', N'Action themes available on LIV actions.', 140),
    (N'action_theme_probation_observation', N'Probationary Observation', N'Action themes available on Probationary Observation actions.', 150),
    (N'action_theme_cpd', N'CPD', N'Action themes available on CPD actions.', 160),
    (N'action_theme_standalone', N'Actions', N'Action themes available on standalone actions.', 170)
) source(lookup_key, category, description, display_order)
JOIN core.lookup_types type ON type.lookup_key = source.lookup_key
WHERE NOT EXISTS (
    SELECT 1
    FROM core.admin_managed_lists existing
    WHERE existing.lookup_type_id = type.id
);

INSERT INTO core.lookup_usage_registry (
    lookup_type_id,
    application_key,
    display_name
)
SELECT
    type.id,
    source.application_key,
    source.display_name
FROM (VALUES
    (N'action_theme_learning_walk', N'actions.learning_walk', N'Learning Walk action forms'),
    (N'action_theme_elevate_environment', N'actions.elevate_environment', N'Learning Environment action forms'),
    (N'action_theme_work_scrutiny', N'actions.work_scrutiny', N'Work Scrutiny action forms'),
    (N'action_theme_coaching_mentoring', N'actions.coaching_mentoring', N'Coaching and Mentoring action forms'),
    (N'action_theme_liv', N'actions.liv', N'LIV action forms'),
    (N'action_theme_probation_observation', N'actions.probation_observation', N'Probationary Observation action forms'),
    (N'action_theme_cpd', N'actions.cpd', N'CPD action forms'),
    (N'action_theme_standalone', N'actions.standalone', N'Standalone action forms')
) source(lookup_key, application_key, display_name)
JOIN core.lookup_types type ON type.lookup_key = source.lookup_key
WHERE NOT EXISTS (
    SELECT 1
    FROM core.lookup_usage_registry existing
    WHERE existing.lookup_type_id = type.id
      AND existing.application_key = source.application_key
);

COMMIT TRANSACTION;
