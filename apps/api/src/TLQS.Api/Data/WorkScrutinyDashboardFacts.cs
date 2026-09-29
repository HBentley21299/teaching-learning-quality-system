using TLQS.Api.V1;

namespace TLQS.Api.Data;

public static class WorkScrutinyDashboardFacts
{
    // Keep section and statement dimensions separate so a chart never double-counts a judgement.
    public const string Sql = """
        INSERT #facts
        SELECT record.id, N'work_scrutiny', record.occurred_on, record.org_unit_id,
               record.area_code, record.area_name, record.parent_area_code,
               dimension.dimension_key, dimension.series_key, LEFT(dimension.series_label, 300),
               LEFT(LTRIM(RTRIM(response.response_text)), 100), LEFT(LTRIM(RTRIM(response.response_text)), 300),
               CONVERT(decimal(10,2), NULL)
        FROM #visible_records record
        CROSS APPLY (
            SELECT TOP (1) submission.id, submission.status, submission.form_template_version_id
            FROM forms.form_submissions submission
            WHERE submission.record_id = record.id AND submission.archived_at IS NULL
            ORDER BY submission.created_at DESC, submission.id DESC
        ) latest
        JOIN forms.form_responses response ON response.form_submission_id = latest.id AND response.archived_at IS NULL
        JOIN forms.form_fields field ON field.id = response.form_field_id
        JOIN forms.form_sections section ON section.id = field.form_section_id
            AND section.form_template_version_id = latest.form_template_version_id
        CROSS APPLY (VALUES
            (N'scrutiny_section_outcome', section.section_key, section.title),
            (N'scrutiny_statement_outcome', LEFT(CONCAT(section.section_key, N'::', field.field_key), 100), CONCAT(section.title, N'|||', field.label))
        ) dimension(dimension_key, series_key, series_label)
        WHERE record.record_type = N'work_scrutiny' AND latest.status = N'submitted'
          AND field.field_type = N'rubric_scale'
          AND NULLIF(LTRIM(RTRIM(response.response_text)), N'') IS NOT NULL;

        """;

    public static DashboardDimensionFactSummary Normalize(DashboardDimensionFactSummary fact)
    {
        if (fact.ProcessKey != "work_scrutiny"
            || fact.DimensionKey is not ("scrutiny_section_outcome" or "scrutiny_statement_outcome")) return fact;

        var label = fact.ValueLabel.Trim();
        var key = label.ToLowerInvariant();
        if (key.EndsWith(" practice", StringComparison.Ordinal)) key = key[..^9];
        decimal? score = key switch
        {
            "emerging" => 1, "developing" => 2, "secure" => 3, "strong" => 4, "exceptional" => 5,
            _ => null
        };
        key = key switch
        {
            "n/a" or "na" or "not applicable" or "not_applicable" => "not_applicable",
            "not seen" or "not_seen" => "not_seen",
            _ => score.HasValue ? key : fact.ValueKey
        };
        // Custom/unknown wording remains visible, but receives no invented numerical judgement.
        return fact with { ValueKey = key, ValueLabel = label, NumericValue = score };
    }
}
