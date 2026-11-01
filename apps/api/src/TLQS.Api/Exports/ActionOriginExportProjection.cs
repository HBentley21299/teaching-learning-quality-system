using TLQS.Api.V1;
using TLQS.Application.Workflows;

namespace TLQS.Api.Exports;

public static class ActionOriginExportProjection
{
    public static ExportSheet Project(ExportSheet source)
    {
        var origin=source.Columns.ToList().IndexOf("Source");
        var recordId=source.Columns.ToList().IndexOf("Source record ID");
        var title=source.Columns.ToList().IndexOf("Source record");
        if(origin<0||recordId<0)return source;
        return source with{Rows=source.Rows.Select(row=>
        {
            var values=row.ToArray();
            Guid? id=Guid.TryParse(values[recordId],out var parsed)&&parsed!=Guid.Empty?parsed:null;
            values[origin]=ActionOriginLabels.ForAction(id,values[origin]);
            if(title>=0&&!id.HasValue)values[title]="Earlier action without a linked source record";
            return (IReadOnlyList<string?>)values;
        }).ToArray()};
    }
}
