using System.Globalization;

namespace TLQS.Application.Workflows;

public static class ActionOriginLabels
{
    public static string SourceLabel(string? source) => source?.Trim().ToLowerInvariant() switch
    {
        "learning_walk" => "Learning Walk",
        "als_learning_walk" => "ALS Learning Walk",
        "liv" => "LIV",
        "als_liv" => "ALS LIV",
        "probation_case" or "probation_observation" => "Probation Observation",
        "coaching_session" or "coaching_mentoring" => "Coaching and Mentoring",
        "elevate_environment" => "Learning Environment",
        "eli" or "elevate_practice_assessment" or "elevate_practice" => "Elevate Learning and Innovation",
        "work_scrutiny" => "Work Scrutiny",
        "cpd" or "cpd_event" => "CPD",
        "uco_tla_review" => "UCO TLA Review",
        "qa_review" => "QA Review",
        "digital_learning_walk" => "Digital Learning Walk",
        "activate_growth_review" => "Activate+ Growth Review",
        "reflection" => "Reflection",
        "reflections" => "Reflections",
        "source_record" => "Source record",
        null or "" or "standalone" or "origin_not_recorded" => "Origin not recorded",
        var value => CultureInfo.InvariantCulture.TextInfo.ToTitleCase(value.Replace('_', ' '))
    };

    public static string ForAction(Guid? sourceRecordId,string? sourceFormType)
    {
        if(!sourceRecordId.HasValue||sourceRecordId==Guid.Empty)return "Origin not recorded";
        return string.IsNullOrWhiteSpace(sourceFormType)||sourceFormType.Trim().Equals("standalone",StringComparison.OrdinalIgnoreCase)
            ? "Source record":SourceLabel(sourceFormType);
    }
}
