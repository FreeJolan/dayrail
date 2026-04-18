// Pure month-grid utilities used by the live Calendar view. The
// sample rules / ad-hoc events that used to live here are gone — the
// Calendar is wired to `state.calendarRules` + `state.adhocEvents`
// now. The file name is kept to avoid churning imports; pure-utility-
// only worth a rename to `monthGrid.ts` when the next refactor pass
// hits this area.

/** Build the cell grid for a month: leading cells from the prev month
 *  + trailing cells from the next month to fill full weeks. Grid
 *  starts on Monday. */
export function buildMonthGrid(
  year: number,
  month: number /* 1-12 */,
): Array<{ date: string; inMonth: boolean; weekday: number; dayNum: number }> {
  const firstOfMonth = new Date(year, month - 1, 1);
  const firstWeekday = firstOfMonth.getDay(); // 0 = Sun
  const daysToMonday = firstWeekday === 0 ? 6 : firstWeekday - 1;
  const gridStart = new Date(year, month - 1, 1 - daysToMonday);

  const cells: ReturnType<typeof buildMonthGrid> = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(
      gridStart.getFullYear(),
      gridStart.getMonth(),
      gridStart.getDate() + i,
    );
    const yy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    cells.push({
      date: `${yy}-${mm}-${dd}`,
      inMonth: d.getMonth() === month - 1,
      weekday: d.getDay(),
      dayNum: d.getDate(),
    });
    if (i >= 34 && d.getMonth() !== month - 1) break;
  }
  return cells;
}

export function monthLabel(year: number, month: number, locale = 'en-US'): string {
  return new Date(year, month - 1, 1).toLocaleDateString(locale, {
    month: 'long',
    year: 'numeric',
  });
}
