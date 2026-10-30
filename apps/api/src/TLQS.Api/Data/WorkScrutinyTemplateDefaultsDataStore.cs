using System.Data.Common;
using Microsoft.Data.SqlClient;
using TLQS.Api.V1;
using TLQS.Application.Workflows;

namespace TLQS.Api.Data;

public sealed partial class SqlFoundationDataStore
{
    private static void ValidateWorkScrutinyCoreReadiness(IReadOnlyList<AdminFormSection> sections)
    {
        var fields = sections.SelectMany(section => section.Fields).ToArray();
        if (!fields.Any(field => WorkScrutinyResponseRules.CourseLevelKeys.Contains(field.FieldKey))
            || !fields.Any(field => field.FieldKey == LearningWalkDeliveryAreaRules.FieldKey))
            throw new WorkflowValidationException("Save this older draft once to prepare its required course level and delivery area questions, then review the saved draft before publishing.");
    }

    // A new/copy draft must be usable by the staff workflow before it can be published.
    // Never repair a published version in place: its saved answers and labels remain immutable.
    private static async Task EnsureWorkScrutinyCoreQuestionsAsync(SqlConnection connection, DbTransaction transaction, Guid versionId, CancellationToken cancellationToken)
    {
        await using var command = new SqlCommand("""
            -- Restore a retired core question within this unused draft rather
            -- than inserting a second row with the same protected reference.
            DECLARE @restoreLevel uniqueidentifier;
            IF NOT EXISTS(SELECT 1 FROM forms.form_fields field JOIN forms.form_sections section ON section.id=field.form_section_id
                WHERE section.form_template_version_id=@versionId AND section.archived_at IS NULL AND field.archived_at IS NULL AND field.is_active=1
                AND field.field_key IN('qualification_level','course_level','course_or_unit'))
                SELECT TOP(1) @restoreLevel=field.id FROM forms.form_fields field JOIN forms.form_sections section ON section.id=field.form_section_id
                    WHERE section.form_template_version_id=@versionId AND field.field_key IN('qualification_level','course_level','course_or_unit') ORDER BY field.display_order;
            DECLARE @restoreDelivery uniqueidentifier;
            IF NOT EXISTS(SELECT 1 FROM forms.form_fields field JOIN forms.form_sections section ON section.id=field.form_section_id
                WHERE section.form_template_version_id=@versionId AND section.archived_at IS NULL AND field.archived_at IS NULL AND field.is_active=1
                AND field.field_key='learning_walk_delivery_area')
                SELECT TOP(1) @restoreDelivery=field.id FROM forms.form_fields field JOIN forms.form_sections section ON section.id=field.form_section_id
                    WHERE section.form_template_version_id=@versionId AND field.field_key='learning_walk_delivery_area' ORDER BY field.display_order;
            UPDATE forms.form_fields SET is_active=1,archived_at=NULL WHERE id IN(@restoreLevel,@restoreDelivery);
            UPDATE section SET archived_at=NULL FROM forms.form_sections section JOIN forms.form_fields field ON field.form_section_id=section.id
                WHERE field.id IN(@restoreLevel,@restoreDelivery);
            DECLARE @levelMissing bit=CASE WHEN EXISTS(SELECT 1 FROM forms.form_fields field JOIN forms.form_sections section ON section.id=field.form_section_id
                WHERE section.form_template_version_id=@versionId AND section.archived_at IS NULL AND field.archived_at IS NULL AND field.is_active=1
                AND field.field_key IN('qualification_level','course_level','course_or_unit')) THEN 0 ELSE 1 END;
            DECLARE @deliveryMissing bit=CASE WHEN EXISTS(SELECT 1 FROM forms.form_fields field JOIN forms.form_sections section ON section.id=field.form_section_id
                WHERE section.form_template_version_id=@versionId AND section.archived_at IS NULL AND field.archived_at IS NULL AND field.is_active=1
                AND field.field_key='learning_walk_delivery_area') THEN 0 ELSE 1 END;
            IF @levelMissing=1 OR @deliveryMissing=1
            BEGIN
                DECLARE @sectionId uniqueidentifier=(SELECT id FROM forms.form_sections WHERE form_template_version_id=@versionId AND section_key='workflow_context');
                IF @sectionId IS NULL BEGIN SET @sectionId=NEWID();
                    INSERT forms.form_sections(id,form_template_version_id,section_key,title,display_order) VALUES(@sectionId,@versionId,'workflow_context','Sample context',0); END;
                ELSE UPDATE forms.form_sections SET archived_at=NULL WHERE id=@sectionId;
                IF @levelMissing=1 INSERT forms.form_fields(form_section_id,field_key,label,field_type,is_required,display_order,help_text,configuration_json)
                    VALUES(@sectionId,'qualification_level','Course level','single_select',1,10,'Choose the level of the sample.',@levels);
                IF @deliveryMissing=1 INSERT forms.form_fields(form_section_id,field_key,label,field_type,is_required,display_order,help_text)
                    VALUES(@sectionId,'learning_walk_delivery_area','Delivery area','learning_walk_delivery_area',1,20,'Choose the area covered by this sample.');
            END;
            """, connection, (SqlTransaction)transaction);
        command.Parameters.AddWithValue("@versionId", versionId);
        command.Parameters.AddWithValue("@levels", SerializeFieldConfiguration(WorkScrutinyResponseRules.CourseLevels));
        await command.ExecuteNonQueryAsync(cancellationToken);
    }
}
