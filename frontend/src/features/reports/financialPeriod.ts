export function currentMonthDateRange(today: string): { date_from: string; date_to: string } {
  const [year, month] = today.split('-');
  const lastDay = new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate();

  return {
    date_from: `${year}-${month}-01`,
    date_to: `${year}-${month}-${String(lastDay).padStart(2, '0')}`,
  };
}
