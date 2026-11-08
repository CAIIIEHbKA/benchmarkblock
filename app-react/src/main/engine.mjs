/**
 * Движок бенчмарка: проверка доступности сайтов и YouTube.
 * Логика повторяет Python-версию (core/tester.py, core/youtube_tester.py),
 * но написана на нативных модулях Node — без внешних зависимостей.
 */
import * as http from 'node:http'
import * as https from 'node:https'
import * as dns from 'node:dns/promises'
import { URL } from 'node:url'

export const Status = {
  OK: 'ДОСТУПЕН',
  BLOCKED: 'ЗАБЛОКИРОВАН',
  TIMEOUT: 'ТАЙМАУТ',
  ERROR: 'ОШИБКА',
  PARTIAL: 'ЧАСТИЧНО'
}

export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

const TIMEOUT_MS = 10_000
const MAX_REDIRECTS = 5

function nowHHMMSS() {
  return new Date().toTimeString().slice(0, 8)
}

/** Классификация сетевой ошибки Node в термин статус-машины. */
function classifyNetworkError(err) {
  const code = err?.code || ''
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || err?.name === 'AbortError') {
    return { status: Status.TIMEOUT, message: `Таймаут ${TIMEOUT_MS / 1000}с` }
  }
  if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'EAI_AGAIN') {
    return { status: Status.BLOCKED, message: `DNS не резолвится (${code})` }
  }
  if (code === 'ECONNREFUSED') {
    return { status: Status.BLOCKED, message: 'Соединение сброшено (ECONNREFUSED)' }
  }
  if (code === 'ECONNRESET' || code === 'EPIPE') {
    return { status: Status.BLOCKED, message: 'Соединение разорвано (RST — похоже на DPI)' }
  }
  if (
    code === 'EPROTO' ||
    code === 'ERR_SSL_WRONG_VERSION_NUMBER' ||
    code === 'ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE' ||
    code === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
    code.startsWith?.('ERR_SSL') ||
    code.startsWith?.('ERR_TLS') ||
    /SSL|TLS|certificate/i.test(err?.message || '')
  ) {
    return { status: Status.BLOCKED, message: 'SSL-ошибка (возможен DPI)' }
  }
  return { status: Status.ERROR, message: String(err?.message || err).slice(0, 100) }
}

/** Простой GET с ручной обработкой редиректов и жёстким таймаутом. */
function request(target, redirectsLeft = MAX_REDIRECTS, accumMs = 0) {
  return new Promise((resolve) => {
    let url
    try {
      url = new URL(target)
    } catch (e) {
      resolve({ error: { code: 'ERR_INVALID_URL', message: `Неверный URL: ${target}` } })
      return
    }

    const mod = url.protocol === 'http:' ? http : https
    const started = performance.now()
    let settled = false

    const finish = (value) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }

    const timer = setTimeout(() => {
      req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))
      finish({ error: { code: 'ETIMEDOUT', message: 'timeout' }, elapsed: accumMs + TIMEOUT_MS })
    }, TIMEOUT_MS)


    const req = mod.get(
      url,
      {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ru,en;q=0.9'
        },
        timeout: TIMEOUT_MS
      },
      (res) => {
        const chunks = []
        let size = 0
        let buffered = 0
        res.on('data', (c) => {
          size += c.length
          if (buffered < 400_000) {
            chunks.push(c)
            buffered += c.length
          }
          if (size > 2_000_000) res.destroy()
        })

        const status = res.statusCode
        const location = res.headers.location

        if ([301, 302, 307, 308].includes(status) && location && redirectsLeft > 0) {
          res.resume()
          const next = new URL(location, url).toString()
          finish(request(next, redirectsLeft - 1, accumMs + (performance.now() - started)))
          return
        }

        // Дожидаемся тела (или закрытия) — иначе время замера неверно.
        res.resume()
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8')
          finish({
            httpCode: status,
            body,
            finalUrl: url.toString(),
            elapsed: accumMs + (performance.now() - started)
          })
        })
      }

    )

    req.on('error', (err) => finish({ error: err, elapsed: accumMs + (performance.now() - started) }))
    req.end()
  })
}

/**
 * Тестирует один сайт. Возвращает объект SiteResult.
 */
export async function testSite(name, url) {
  const result = {
    name,
    url,
    status: Status.ERROR,
    http_code: null,
    response_time_ms: null,
    error_message: null,
    timestamp: nowHHMMSS()
  }

  try {
    const host = new URL(url).hostname
    await dns.lookup(host)
  } catch (err) {
    result.status = Status.BLOCKED
    result.error_message = `DNS: ${err?.code || err?.message || 'ошибка'}`
    return result
  }

  const res = await request(url)

  if (res.error) {
    const info = classifyNetworkError(res.error)
    result.status = info.status
    result.error_message = info.message
    result.response_time_ms = res.elapsed ? Math.round(res.elapsed * 10) / 10 : TIMEOUT_MS
    return result
  }

  result.http_code = res.httpCode
  result.response_time_ms = Math.round(res.elapsed * 10) / 10

  if (res.httpCode === 200) {
    result.status = Status.OK
  } else if (res.httpCode >= 200 && res.httpCode <= 299) {
    result.status = Status.OK
    result.error_message = `HTTP ${res.httpCode}`
  } else if (res.httpCode >= 300 && res.httpCode <= 399) {
    result.status = Status.PARTIAL
    result.error_message = `Redirect ${res.httpCode}`
  } else if (res.httpCode >= 400 && res.httpCode <= 599) {
    result.status = Status.PARTIAL
    result.error_message = `HTTP ${res.httpCode} (site responds)`
  } else {
    result.status = Status.BLOCKED
    result.error_message = `HTTP ${res.httpCode}`
  }

  return result
}

/** Параллельный пул без внешних зависимостей. */
async function pool(items, worker, concurrency, onEach) {
  const out = new Array(items.length)
  let index = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = index++
      if (i >= items.length) break
      const value = await worker(items[i], i)
      out[i] = value
      if (onEach) onEach(value)
    }
  })
  await Promise.all(runners)
  return out
}

/**
 * Тест списка сайтов (аналог SiteTester.test_sites_parallel).
 */
export async function testSites(sites, onSiteDone, concurrency = 10) {
  return pool(
    sites,
    ([name, url]) => testSite(name, url),
    concurrency,
    onSiteDone
  )
}

const YT_BASE_DOMAINS = [
  'youtube.com',
  'www.youtube.com',
  'youtu.be',
  'i.ytimg.com',
  'yt3.ggpht.com',
  'yt3.googleusercontent.com',
  'googleapis.com',
  'youtubei.googleapis.com',
  'manifest.googlevideo.com'
]

const WATCH_URL = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'

async function fetchDynamicDomains() {
  const res = await request(WATCH_URL)
  if (res.error || res.httpCode !== 200) return []
  const found = new Set()
  const re = /(rr[0-9]+---sn-[a-z0-9-]+\.googlevideo\.com)/g
  let m
  while ((m = re.exec(res.body || '')) !== null) found.add(m[1])
  return [...found].sort()
}

async function checkDomain(domain) {
  const res = await request(`https://${domain}`)
  const elapsed = res.elapsed ? Math.round(res.elapsed * 10) / 10 : TIMEOUT_MS
  if (res.error) return { domain, opened: false, elapsed }
  // Любой HTTP-ответ = соединение прошло
  return { domain, opened: true, elapsed }
}

/**
 * Тест YouTube: базовые домены + динамические CDN googlevideo.
 */
export async function testYouTube(baseDomains = YT_BASE_DOMAINS, onProgress) {
  const dynamic = await fetchDynamicDomains()
  const all = [...baseDomains, ...dynamic]

  const checks = await pool(
    all,
    (domain) => checkDomain(domain),
    6,
    null
  )

  const opened = []
  const failed = []
  let step = 0
  for (const c of checks) {
    step += 1
    if (c.opened) opened.push(c.domain)
    else failed.push(c.domain)
    if (onProgress) onProgress(c.domain, step, all.length)
  }

  const total = all.length
  let status = Status.BLOCKED
  if (opened.length === total) status = Status.OK
  else if (opened.length > 0) status = Status.PARTIAL

  return {
    name: 'YouTube',
    status,
    total_domains: total,
    opened_count: opened.length,
    failed_count: failed.length,
    opened_domains: opened,
    failed_domains: failed,
    error_message: null,
    timestamp: nowHHMMSS()
  }
}

/**
 * Полный прогон бенчмарка. Возвращает BenchmarkSummary.
 */
export async function runBenchmark(config, hooks = {}) {
  const startTotal = performance.now()
  const sites = config.general.map((s) => [s.name, s.url])

  const siteResults = await testSites(sites, hooks.onSiteDone, config.concurrency || 10)

  const youtubeDomains = config?.youtube?.domains?.length ? config.youtube.domains : YT_BASE_DOMAINS
  const youtube = await testYouTube(youtubeDomains, hooks.onYoutubeProgress)

  const accessible = siteResults.filter(
    (r) => r.status === Status.OK || r.status === Status.PARTIAL
  ).length

  return {
    total_sites: siteResults.length,
    accessible,
    blocked: siteResults.filter((r) => r.status === Status.BLOCKED).length,
    timeout: siteResults.filter((r) => r.status === Status.TIMEOUT).length,
    errors: siteResults.filter((r) => r.status === Status.ERROR).length,
    total_time_ms: Math.round(performance.now() - startTotal),
    youtube,
    site_results: siteResults,
    timestamp: new Date().toLocaleString('ru-RU')
  }
}

/**
 * Скор по попугаям — та же формула, что в Python-версии.
 */
export function calculateScore(s) {
  const siteScore = s.total_sites ? (s.accessible / s.total_sites) * 60 : 0
  const ytScore = s.youtube && s.youtube.total_domains > 0 ? (s.youtube.opened_count / s.youtube.total_domains) * 40 : 0
  const total = siteScore + ytScore

  let parrots, verdict, congrats
  if (total >= 90) {
    parrots = '🦜🦜🦜🦜🦜'
    verdict = 'ПОЛНЫЙ ФАРШ! Интернет свободен!'
    congrats = 'Поздравляем! Все сайты и YouTube доступны. Цензура обойдена полностью!'
  } else if (total >= 70) {
    parrots = '🦜🦜🦜🦜'
    verdict = 'ОТЛИЧНО! VPN/прокси работает отлично.'
    congrats = 'Большинство сайтов и YouTube открыты. Свободный интернет почти у тебя в кармане!'
  } else if (total >= 40) {
    parrots = '🦜🦜🦜'
    verdict = 'СРЕДНЕ. Частичный обход блокировок.'
    congrats = 'Половина интернета доступна. Можно лучше — попробуй другой VPN или настройки DPI.'
  } else if (total >= 15) {
    parrots = '🦜🦜'
    verdict = 'ПЛОХО. Почти всё заблокировано.'
    congrats = 'Свободный интернет в зачаточном состоянии. Нужен хороший VPN!'
  } else {
    parrots = '🦜'
    verdict = 'ДНО. Тотальная цензура.'
    congrats = 'Интернет полностью в клетке. Срочно включай VPN, пока не поздно!'
  }

  return { score: Math.round(total * 10) / 10, max_score: 100, parrots, verdict, congrats }
}
