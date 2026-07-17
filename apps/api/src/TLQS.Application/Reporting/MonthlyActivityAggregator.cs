namespace TLQS.Application.Reporting;

public sealed record MonthlyActivityInput(DateOnly Date, string RecordType);
public sealed record MonthlyActivityPoint(DateOnly Month, long Count, string RecordType);

public static class MonthlyActivityAggregator
{
    public static IReadOnlyList<MonthlyActivityPoint> Aggregate(
        IEnumerable<MonthlyActivityInput> records,
        DateOnly periodStart,
        DateOnly periodEnd,
        string recordType)
    {
        var firstMonth = new DateOnly(periodStart.Year, periodStart.Month, 1);
        var lastMonth = new DateOnly(periodEnd.Year, periodEnd.Month, 1);
        if (lastMonth < firstMonth)
        {
            throw new ArgumentException("The reporting period end must not be before its start.");
        }

        var counts = records
            .Where(record => record.Date >= periodStart && record.Date <= periodEnd)
            .GroupBy(record => new DateOnly(record.Date.Year, record.Date.Month, 1))
            .ToDictionary(group => group.Key, group => group.LongCount());

        var result = new List<MonthlyActivityPoint>();
        for (var month = firstMonth; month <= lastMonth; month = month.AddMonths(1))
        {
            result.Add(new MonthlyActivityPoint(month, counts.GetValueOrDefault(month), recordType));
        }

        return result;
    }
}
