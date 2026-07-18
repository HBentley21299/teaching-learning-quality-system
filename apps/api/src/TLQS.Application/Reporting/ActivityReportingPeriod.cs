using TLQS.Application.Workflows;

namespace TLQS.Application.Reporting;

public sealed record ActivityReportingPeriod(DateOnly Start, DateOnly End);

public static class ActivityReportingPeriodResolver
{
    public static ActivityReportingPeriod Resolve(
        IEnumerable<DateOnly> recordDates,
        DateOnly? requestedStart,
        DateOnly? requestedEnd,
        DateOnly today)
    {
        if (requestedStart.HasValue && requestedEnd.HasValue && requestedEnd.Value < requestedStart.Value)
        {
            throw new WorkflowValidationException("The reporting period end must not be before its start.");
        }

        var dates = recordDates.ToArray();
        var resolvedEnd = requestedEnd ?? ResolveEnd(dates, requestedStart, today);
        var resolvedStart = requestedStart ?? ResolveStart(dates, resolvedEnd);

        // An explicitly future start with no end still represents a valid
        // one-month, zero-value reporting period.
        if (resolvedEnd < resolvedStart)
        {
            resolvedEnd = resolvedStart;
        }

        // Keep implicit periods readable. Explicit start dates are honoured in
        // full because they represent a deliberate reporting range.
        if (!requestedStart.HasValue)
        {
            var firstAllowedMonth = new DateOnly(resolvedEnd.Year, resolvedEnd.Month, 1).AddMonths(-23);
            if (resolvedStart < firstAllowedMonth)
            {
                resolvedStart = firstAllowedMonth;
            }
        }

        return new ActivityReportingPeriod(resolvedStart, resolvedEnd);
    }

    private static DateOnly ResolveEnd(IReadOnlyCollection<DateOnly> dates, DateOnly? requestedStart, DateOnly today)
    {
        if (!requestedStart.HasValue)
        {
            return dates.Count > 0 ? dates.Max() : today;
        }

        var candidates = dates.Where(date => date >= requestedStart.Value).Append(today).Append(requestedStart.Value);
        return candidates.Max();
    }

    private static DateOnly ResolveStart(IReadOnlyCollection<DateOnly> dates, DateOnly resolvedEnd)
    {
        var candidates = dates.Where(date => date <= resolvedEnd).ToArray();
        return candidates.Length > 0
            ? candidates.Min()
            : new DateOnly(resolvedEnd.Year, resolvedEnd.Month, 1).AddMonths(-11);
    }
}
