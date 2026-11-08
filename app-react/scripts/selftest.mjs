/**
 * Автотест движка без интернета: поднимаем локальные HTTP-серверы
 * и сверяем классификацию статусов с ожиданиями.
 * Запуск: node scripts/selftest.mjs
 */
import * as http from 'node:http'
import * as net from 'node:net'
import assert from 'node:assert/strict'
import { testSite, Status, calculateScore } from '../src/main/engine.mjs'
import { buildCsv } from '../src/shared/csv.mjs'

function listen(handler) {
  return new Promise((resolve) => {
    const srv = http.createServer(handler)
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }))
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failures = 0
async function check(label, actual, expected) {
  const ok = actual === expected
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  →  ${actual}${ok ? '' : ` (ожидалось ${expected})`}`)
  if (!ok) failures++
}

async function main() {
  // 1. Прямой 200
  const a = await listen((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' })
    res.end('ok')
  })
  let r = await testSite('plain200', `http://127.0.0.1:${a.port}/`)
  await check('200 → ДОСТУПЕН', r.status, Status.OK)
  await check('200 HTTP code', r.http_code, 200)
  assert.ok(r.response_time_ms >= 0)
  a.srv.close()

  // 2. 403 — сайт отвечает, это не блокировка соединения
  const b = await listen((_req, res) => {
    res.writeHead(403)
    res.end('forbidden')
  })
  r = await testSite('forbidden', `http://127.0.0.1:${b.port}/`)
  await check('403 → ЧАСТИЧНО', r.status, Status.PARTIAL)
  await check('403 комментарий', r.error_message, 'HTTP 403 (site responds)')
  b.srv.close()

  // 3. Редирект 302 → 200
  const c = await listen((req, res) => {
    if (req.url === '/final') {
      res.writeHead(200)
      res.end('done')
    } else {
      res.writeHead(302, { location: '/final' })
      res.end()
    }
  })
  r = await testSite('redirect', `http://127.0.0.1:${c.port}/start`)
  await check('302→200 → ДОСТУПЕН', r.status, Status.OK)
  await check('302→200 финальный код', r.http_code, 200)
  c.srv.close()

  // 4. Закрыт порт → соединение отброшено
  const tmp = net.createServer()
  await new Promise((res) => tmp.listen(0, '127.0.0.1', res))
  const closedPort = tmp.address().port
  await new Promise((res) => tmp.close(res))
  r = await testSite('refused', `http://127.0.0.1:${closedPort}/`)
  await check('ECONNREFUSED → ЗАБЛОКИРОВАН', r.status, Status.BLOCKED)
  console.log('      сообщение:', r.error_message)

  // 5. Невозможный DNS
  r = await testSite('dnsfail', 'https://this-domain-does-not-exist-zzz.invalid/')
  await check('DNS-ошибка → ЗАБЛОКИРОВАН', r.status, Status.BLOCKED)
  console.log('      сообщение:', r.error_message)

  // 6. Зависший сервер → таймаут (уменьшаем таймаут точечно нельзя — он общий,
  //    поэтому проверяем, что запрос не висит вечно и получает статус)
  const d = await listen(() => {
    /* намеренно не отвечаем */
  })
  const t0 = Date.now()
  r = await testSite('hang', `http://127.0.0.1:${d.port}/`)
  const took = Date.now() - t0
  await check('зависший сервер → ТАЙМАУТ', r.status, Status.TIMEOUT)
  await check(`таймаут ~10с (факт ${took}мс)`, took >= 9500 && took <= 12000, true)
  d.srv.close()

  // 7. Скор и CSV
  const summary = {
    total_sites: 3,
    accessible: 2,
    blocked: 1,
    timeout: 0,
    errors: 0,
    total_time_ms: 1234,
    timestamp: '2026-01-01 00:00:00',
    site_results: [
      { name: 'A', url: 'http://a', status: Status.OK, http_code: 200, response_time_ms: 10, error_message: null, timestamp: '00:00:00' },
      { name: 'B; "quoted"', url: 'http://b', status: Status.PARTIAL, http_code: 403, response_time_ms: 20, error_message: 'HTTP 403 (site responds)', timestamp: '00:00:01' },
      { name: 'C', url: 'http://c', status: Status.BLOCKED, http_code: null, response_time_ms: null, error_message: 'RST', timestamp: '00:00:02' }
    ],
    youtube: {
      status: Status.PARTIAL,
      total_domains: 2,
      opened_count: 1,
      failed_count: 1,
      opened_domains: ['youtube.com'],
      failed_domains: ['manifest.googlevideo.com']
    }
  }

  const sc = calculateScore(summary)
  // сайты 2/3*60 = 40, youtube 1/2*40 = 20 → 60
  await check('скор по формуле (40+20)', sc.score, 60)

  const csv = buildCsv(summary)
  await check('CSV начинается с BOM', csv.charCodeAt(0), 0xfeff)
  await check('CSV разделитель ";"', csv.includes('Сайт;URL;Статус;HTTP код'), true)
  await check('CSV кавычки для ; и "', csv.includes('"B; ""quoted"""'), true)
  await check('CSV секция YouTube', csv.includes('=== YouTube ==='), true)
  await check('CSV перенос CRLF', csv.includes('\r\n'), true)

  console.log('')
  if (failures) {
    console.log(`ПРОВАЛЕНО ПРОВЕРОК: ${failures}`)
    process.exit(1)
  }
  console.log('ВСЕ ПРОВЕРКИ ПРОЙДЕНЫ')
  process.exit(0)
}

main().catch((e) => {
  console.error('Сбой самотестирования:', e)
  process.exit(1)
})
