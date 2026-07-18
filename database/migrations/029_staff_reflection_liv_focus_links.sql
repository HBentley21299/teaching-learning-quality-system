SET ANSI_NULLS ON;
SET ANSI_PADDING ON;
SET ANSI_WARNINGS ON;
SET ARITHABORT ON;
SET CONCAT_NULL_YIELDS_NULL ON;
SET QUOTED_IDENTIFIER ON;
SET NUMERIC_ROUNDABORT OFF;
GO

IF OBJECT_ID('quality.staff_reflection_focus_areas', 'U') IS NULL
BEGIN
    CREATE TABLE quality.staff_reflection_focus_areas (
        reflection_id uniqueidentifier NOT NULL,
        focus_lookup_value_id uniqueidentifier NULL,
        focus_key_snapshot nvarchar(100) NOT NULL,
        focus_text_snapshot nvarchar(250) NOT NULL,
        focus_type nvarchar(20) NOT NULL,
        display_order int NOT NULL,
        created_at datetimeoffset NOT NULL CONSTRAINT df_staff_reflection_focus_created DEFAULT sysutcdatetime(),
        CONSTRAINT pk_staff_reflection_focus_areas PRIMARY KEY (reflection_id, display_order),
        CONSTRAINT fk_staff_reflection_focus_reflection FOREIGN KEY (reflection_id) REFERENCES quality.staff_reflections(id),
        CONSTRAINT fk_staff_reflection_focus_lookup FOREIGN KEY (focus_lookup_value_id) REFERENCES core.lookup_values(id),
        CONSTRAINT ck_staff_reflection_focus_type CHECK (focus_type IN ('primary', 'secondary')),
        CONSTRAINT ck_staff_reflection_focus_order CHECK (display_order IN (1, 2))
    );
END;
GO

INSERT INTO quality.staff_reflection_focus_areas (
    reflection_id,
    focus_lookup_value_id,
    focus_key_snapshot,
    focus_text_snapshot,
    focus_type,
    display_order
)
SELECT reflection.id,
       focus.id,
       focus.value_key,
       focus.display_name,
       N'primary',
       1
FROM quality.staff_reflections reflection
JOIN quality.elevate_practice_liv_information information
  ON information.assessment_id = reflection.elevate_practice_assessment_id
JOIN core.lookup_values focus
  ON focus.id = information.primary_focus_lookup_value_id
WHERE reflection.archived_at IS NULL
  AND NOT EXISTS (
      SELECT 1
      FROM quality.staff_reflection_focus_areas existing
      WHERE existing.reflection_id = reflection.id
        AND existing.display_order = 1
  );

INSERT INTO quality.staff_reflection_focus_areas (
    reflection_id,
    focus_lookup_value_id,
    focus_key_snapshot,
    focus_text_snapshot,
    focus_type,
    display_order
)
SELECT reflection.id,
       focus.id,
       focus.value_key,
       CASE
           WHEN focus.value_key = N'other'
               THEN COALESCE(NULLIF(LTRIM(RTRIM(information.secondary_focus_other)), N''), focus.display_name)
           ELSE focus.display_name
       END,
       N'secondary',
       2
FROM quality.staff_reflections reflection
JOIN quality.elevate_practice_liv_information information
  ON information.assessment_id = reflection.elevate_practice_assessment_id
JOIN core.lookup_values focus
  ON focus.id = information.secondary_focus_lookup_value_id
WHERE reflection.archived_at IS NULL
  AND NOT EXISTS (
      SELECT 1
      FROM quality.staff_reflection_focus_areas existing
      WHERE existing.reflection_id = reflection.id
        AND existing.display_order = 2
  );
GO

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes
    WHERE object_id = OBJECT_ID('quality.staff_reflection_focus_areas')
      AND name = 'ix_staff_reflection_focus_lookup'
)
BEGIN
    CREATE INDEX ix_staff_reflection_focus_lookup
        ON quality.staff_reflection_focus_areas(focus_lookup_value_id, reflection_id);
END;
GO
