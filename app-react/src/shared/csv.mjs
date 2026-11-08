/**
 * Генерация CSV — формат идентичен Python-версии (разделитель ";", BOM UTF-8, CRLF).
 * Общий модуль для процесса рендера и автотестов.
 */
export function buildCsv(summary) {
  const esc = (v) => {
    const s = String(v ?? '')
    return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }

  const rows = []
  const line = (cells) => rows.push(cells.map(esc).join(';'))

  line(['Сайт', 'URL', 'Статус', 'HTTP код', 'Время (мс)', 'Ошибка', 'Время замера'])
  for (const r of summary.site_results) {
    line([
      r.name,
      r.url,
      r.status,
      r.http_code ?? '',
      r.response_time_ms ?? '',
      r.error_message ?? '',
      r.timestamp
    ])
  }

  const y = summary.youtube
  if (y) {
    line([])
    line(['=== YouTube ==='])
    line(['Параметр', 'Значение'])
    line(['Статус', y.status])
    line(['Всего доменов', y.total_domains])
    line(['Открылись', y.opened_count])
    line(['Не открылись', y.failed_count])
    line([])
    line(['Открытые домены', ''])
    for (const d of y.opened_domains) line([d, '✅'])
    line([])
    line(['Закрытые домены', ''])
    for (const d of y.failed_domains) line([d, '❌'])
  }

  return '\ufeff' + rows.map((r) => r + '\r\n').join('')
}
