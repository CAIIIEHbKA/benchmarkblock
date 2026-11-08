/**
 * End-to-end проверка собранного приложения: запускаем полный бенчмарк
 * кликом по кнопке и ждём итоговый скор. Приложение должно быть запущено
 * с --remote-debugging-port=9222.
 * Запуск: node scripts/e2e.mjs
 */
const DEBUG_PORT = process.env.DEBUG_PORT || '9222'

async function main() {
  const list = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`).then((r) => r.json())
  const page = list.find((t) => t.type === 'page')
  if (!page) throw new Error('Страница renderer не найдена')

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = () => rej(new Error('CDP connect failed'))
  })

  const evaluate = (expression) =>
    new Promise((resolve, reject) => {
      const id = Math.floor(Math.random() * 1e6)
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data)
        if (msg.id !== id) return
        if (msg.error) reject(new Error(JSON.stringify(msg.error)))
        else resolve(msg.result?.result?.value)
      }
      ws.send(
        JSON.stringify({
          id,
          method: 'Runtime.evaluate',
          params: { expression, returnByValue: true, awaitPromise: true }
        })
      )
    })

  await evaluate(`document.querySelector('button.primary').click()`)
  console.log('Бенчмарк запущен, ждём результаты…')

  let report = null
  for (let i = 0; i < 150; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    report = await evaluate(`(() => {
      const chips = [...document.querySelectorAll('.chip')].map(c => c.textContent.trim());
      const modal = document.querySelector('.modal');
      const rows = [...document.querySelectorAll('table.grid tbody tr')];
      const done = rows.filter(r => r.children[2].textContent.trim() !== '—' && r.children[2].textContent.trim() !== '…').length;
      return {
        chips,
        status: document.querySelector('.status')?.textContent,
        done, total: rows.length,
        scoreShown: !!modal,
        verdict: modal?.querySelector('.verdict')?.textContent || null,
        yt: document.querySelector('.yt .muted')?.textContent || null,
        summary: document.querySelector('.summary pre')?.textContent?.slice(0, 900) || null,
        blockedNames: rows.filter(r => r.children[2].textContent.trim() === 'ЗАБЛОКИРОВАН').map(r => r.children[0].textContent.trim())
      };
    })()`)
    process.stdout.write(`\r  выполнено ${report.done}/${report.total}   `)
    if (report.scoreShown) break
  }

  console.log('\n')
  console.log(JSON.stringify(report, null, 2))
  ws.close()

  const finished = report && report.status === 'Готово' && report.scoreShown
  console.log(finished ? 'E2E OK' : 'E2E PROBLEM')
  process.exit(finished ? 0 : 1)
}

main().catch((e) => {
  console.error('Сбой E2E:', e.message)
  process.exit(1)
})
