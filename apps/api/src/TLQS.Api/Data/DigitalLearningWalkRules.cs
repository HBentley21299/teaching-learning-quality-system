using TLQS.Api.V1;

namespace TLQS.Api.Data;

public static partial class ProcessReviewRules
{
    public static IReadOnlyList<ProcessReviewStatement> SelectedDigitalStatements(ProcessReviewConfiguration configuration,ProcessReviewData data)
    {
        var statements=configuration.Standards.SelectMany(standard=>standard.Statements);
        if(data.Digital is null)return statements.ToArray();
        if(data.Digital.SelectedStandardKeys is {} categories)
        {
            var selectedCategories=categories.ToHashSet(StringComparer.Ordinal);
            return configuration.Standards.Where(standard=>selectedCategories.Contains(standard.Key)).SelectMany(standard=>standard.Statements).ToArray();
        }
        var selected=(data.Digital.SelectedStatementKeys??[]).ToHashSet(StringComparer.Ordinal);
        return statements.Where(statement=>selected.Contains(statement.Key)).ToArray();
    }

    public static IReadOnlyList<ProcessReviewSelectedStandard> SelectedDigitalStandards(ProcessReviewConfiguration configuration,ProcessReviewData data)
    {
        var selected=SelectedDigitalStatements(configuration,data).Select(statement=>statement.Key).ToHashSet(StringComparer.Ordinal);
        return configuration.Standards.Select(standard=>new ProcessReviewSelectedStandard(standard.Key,standard.Title,standard.Statements.Count,
            standard.Statements.Count(statement=>selected.Contains(statement.Key)))).Where(standard=>standard.SelectedStatementCount>0).ToArray();
    }

    public static ProcessReviewData NormalizeDigitalData(ProcessReviewData data,ProcessReviewConfiguration configuration)
    {
        if(data.Digital is null)return data;
        ValidateDigitalData(data,configuration,false);
        var selectedKeys=SelectedDigitalStatements(configuration,data).Select(statement=>statement.Key).ToArray();
        var selected=selectedKeys.ToHashSet(StringComparer.Ordinal);
        return data with{Digital=data.Digital.SelectedStandardKeys is null?data.Digital:data.Digital with{SelectedStatementKeys=selectedKeys},
            Responses=data.Responses.Where(response=>response is null||selected.Contains(response.StatementKey)).ToArray()};
    }

    private static void ValidateDigitalData(ProcessReviewData data,ProcessReviewConfiguration configuration,bool formal,DateOnly? recordDate=null)
    {
        if(data.Digital is not {} digital)return;
        if(configuration.ProcessKey!=Digital)Fail("Selected Digital Learning Walk criteria belong to the Digital Learning Walk form.");
        if(digital.SelectedStatementKeys is null||digital.SelectedStatementKeys.Count>500
            ||digital.SelectedStatementKeys.Any(key=>string.IsNullOrWhiteSpace(key))
            ||digital.SelectedStatementKeys.Distinct(StringComparer.Ordinal).Count()!=digital.SelectedStatementKeys.Count)
            Fail("Choose distinct Digital Learning Walk criteria from this form.");
        var known=configuration.Standards.SelectMany(standard=>standard.Statements).Select(statement=>statement.Key).ToHashSet(StringComparer.Ordinal);
        if(digital.SelectedStatementKeys.Any(key=>!known.Contains(key)))Fail("Choose Digital Learning Walk criteria from this review's saved framework.");
        if(digital.SelectedStandardKeys is {} categories)
        {
            if(categories.Count>100||categories.Any(string.IsNullOrWhiteSpace)||categories.Distinct(StringComparer.Ordinal).Count()!=categories.Count)
                Fail("Choose distinct Digital Learning Walk categories from this form.");
            var knownCategories=configuration.Standards.Select(standard=>standard.Key).ToHashSet(StringComparer.Ordinal);
            if(categories.Any(key=>!knownCategories.Contains(key)))Fail("Choose Digital Learning Walk categories from this review's saved framework.");
            if(formal&&categories.Count==0)Fail("Choose at least one Digital Learning Walk category before submitting.");
        }
        else if(formal&&digital.SelectedStatementKeys.Count==0)Fail("Choose at least one Digital Learning Walk criterion before submitting.");
        if(digital.DraftActions is null||digital.DraftActions.Count>100||digital.DraftActions.Any(action=>action is null)
            ||digital.DraftActions.Any(action=>action.Id==Guid.Empty)||digital.DraftActions.Select(action=>action.Id).Distinct().Count()!=digital.DraftActions.Count)
            Fail("Use up to 100 draft actions, each with its own stable reference.");
        foreach(var action in digital.DraftActions)
        {
            Optional(action.Title,300);Optional(action.ThemeKey,100);
            if(!string.IsNullOrWhiteSpace(action.ThemeKey)&&!configuration.Standards.Any(standard=>standard.Key==action.ThemeKey))
                Fail("Choose an action theme from this Digital Learning Walk's standards.");
            if(action.OwnerStaffId==Guid.Empty)Fail("Select a valid draft action owner.");
            if(formal)
            {
                Required(action.Title,300,"Describe every added action before submitting.");
                if(string.IsNullOrWhiteSpace(action.ThemeKey)||!action.OwnerStaffId.HasValue||!action.DueDate.HasValue||action.DueDate==default(DateOnly))
                    Fail("Every added action needs a theme, action, owner and implementation date before submitting.");
                if(recordDate.HasValue&&action.DueDate.HasValue&&action.DueDate<recordDate)
                    Fail("An action's implementation date cannot be before the Digital Learning Walk visit date.");
            }
        }
    }
}
