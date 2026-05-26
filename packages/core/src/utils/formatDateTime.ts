export function formatDateTime(
    date: Date | number | string,
    pattern = 'YYYY-MM-DD HH:mm:ss'
): string {
    const d = date instanceof Date ? date : new Date(date);
    const year = d.getFullYear();
    const month = `${d.getMonth() + 1}`.padStart(2, '0');
    const day = `${d.getDate()}`.padStart(2, '0');
    const hours = `${d.getHours()}`.padStart(2, '0');
    const minutes = `${d.getMinutes()}`.padStart(2, '0');
    const seconds = `${d.getSeconds()}`.padStart(2, '0');

    return pattern
        .replace(/YYYY/g, String(year))
        .replace(/MM/g, month)
        .replace(/DD/g, day)
        .replace(/HH/g, hours)
        .replace(/mm/g, minutes)
        .replace(/ss/g, seconds);
}
