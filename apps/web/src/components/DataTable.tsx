import type { ReactNode } from "react";
import { ScrollableTableRegion } from "./ScrollableTableRegion";

type Column<T> = {
  key: string;
  header: string;
  render: (item: T) => ReactNode;
};

type DataTableProps<T> = {
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (item: T) => string;
  caption?: string;
  emptyMessage?: ReactNode;
};

export function DataTable<T>({ columns, rows, rowKey, caption, emptyMessage = "No records to show." }: DataTableProps<T>) {
  return (
    <ScrollableTableRegion label={caption}>
      <table aria-label={caption ? undefined : "Results"}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} scope="col">{column.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={rowKey(row)}>
              {columns.map((column) => (
                <td key={column.key}>{column.render(row)}</td>
              ))}
            </tr>
          ))}
          {rows.length === 0 ? <tr><td colSpan={columns.length}><div className="table-empty-state" role="status">{emptyMessage}</div></td></tr> : null}
        </tbody>
      </table>
    </ScrollableTableRegion>
  );
}
