/**
 * Проверка, что собранный интерфейс реально отрисулся и мост main<->renderer работает.
 * Приложение должно быть запущено с флагом --remote-debugging-port=9222.
 * Запуск: node scripts/uicheck.mjs
 */
const DEBUG_PORT = process.env.DEBUG_PORT || '9222'

async function main() {
  const list = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`).then((r) => r.json())
  const page = list.find((t) => t.type === 'page')
  if (!page) throw new Error('Страница renderer не найдена в CDP')

  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = () => rej(new Error('Не удалось подключиться к CDP'))
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

  const report = await evaluate(`(async () => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    for (let i = 0; i < 60; i++) {
      if (document.querySelectorAll('table.grid tbody tr').length > 0) break;
      await wait(250);
    }
    return {
      title: document.title,
      rows: document.querySelectorAll('table.grid tbody tr').length,
      firstRow: (document.querySelector('table.grid tbody tr')?.innerText || '').replace(/\\s+/g,' '),
      benchBridge: typeof window.bench === 'object' && typeof window.bench.run === 'function',
      buttons: [...document.querySelectorAll('button')].map(b => b.textContent.trim()).slice(0, 8),
      status: document.querySelector('.status')?.textContent,
      appInfo: document.querySelector('.footer')?.textContent.trim(),
      hasErrorState: (document.querySelector('.status')?.textContent || '').includes('Ошибка')
    };
  })()`)

  console.log(JSON.stringify(report, null, 2))
  ws.close()

  const ok =
    report.rows > 0 &&
    report.benchBridge &&
    !report.hasErrorState &&
    /Electron/.test(report.appInfo || '')
  console.log(ok ? 'UI OK' : 'UI PROBLEM')
  process.exit(ok ? 0 : 1)
}

main().catch((e) => {
  console.error('Сбой проверки UI:', e.message)
  process.exit(1)
})
