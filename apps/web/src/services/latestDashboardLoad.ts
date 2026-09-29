export type DashboardLoadJob = { key: string; load: () => Promise<unknown>; apply: (value: unknown) => void };

/** Discards a whole response batch when the selection or a newer refresh supersedes it. */
export class LatestDashboardLoad {
  private selection = "";
  private generation = 0;

  setScope(selection: string) {
    if (selection !== this.selection) { this.selection = selection; this.invalidate(); }
  }

  invalidate() { this.generation += 1; }

  async run(jobs: DashboardLoadJob[]): Promise<string[] | null> {
    const generation = ++this.generation;
    const results = await Promise.allSettled(jobs.map(job => Promise.resolve().then(job.load)));
    if (generation !== this.generation) return null;
    const failed: string[] = [];
    results.forEach((result, index) => {
      if (result.status === "fulfilled") jobs[index].apply(result.value);
      else failed.push(jobs[index].key);
    });
    return failed;
  }
}
