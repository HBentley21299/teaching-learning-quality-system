using TLQS.Api.Exports;
using TLQS.Api.V1;
using Xunit;

namespace TLQS.AccessControl.Tests;

public sealed class ActionOriginExportTests
{
    [Fact]
    public void Export_distinguishes_linked_origins_from_earlier_process_tags_without_inventing_links()
    {
        var linked=Guid.NewGuid();var first=Guid.NewGuid();var second=Guid.NewGuid();
        var sheet=new ExportSheet("Actions",["Action ID","Action","Source","Source record","Source record ID"],
            [new string?[]{first.ToString(),"Review feedback","probation_case","Observation 1",linked.ToString()},
             new string?[]{second.ToString(),"Earlier follow-up","learning_walk",null,null}],false);
        var projected=ActionOriginExportProjection.Project(sheet);
        Assert.Equal("Probation Observation",projected.Rows[0][2]);
        Assert.Equal("Observation 1",projected.Rows[0][3]);
        Assert.Equal("Origin not recorded",projected.Rows[1][2]);
        Assert.Equal("Earlier action without a linked source record",projected.Rows[1][3]);
        Assert.Null(sheet.Rows[1][3]);
        var workbook=BusinessWorkbookExportBuilder.Build(new("actions","Actions",new(null,null,null,null,null,null,null,null,null),
            "Reviewer",DateTimeOffset.UtcNow,[projected]));
        var exported=Assert.Single(workbook.Sheets);
        Assert.Equal(2,exported.Rows.Count);
        Assert.DoesNotContain("Source record ID",exported.Columns);
        Assert.DoesNotContain(exported.Rows.SelectMany(row=>row),value=>value==linked.ToString()||value==first.ToString()||value==second.ToString());
    }
}
