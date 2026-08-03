export interface PlanningCycleContext {
  startDate: string;
  endDate: string;
  source: 'cycle' | 'today';
}

export function planningCycleFor(date: Date, source: PlanningCycleContext['source']): PlanningCycleContext {
  const monday = new Date(date);
  const weekday = monday.getDay();
  monday.setDate(monday.getDate() - (weekday === 0 ? 6 : weekday - 1));
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  return {
    startDate: localDate(monday),
    endDate: localDate(sunday),
    source,
  };
}

function localDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
