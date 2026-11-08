import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildCsv } from '../shared/csv.mjs'

const STATUS_COLORS = {
  ДОСТУПЕН: '#3fb950',
  ЗАБЛОКИРОВАН: '#f85149',
  ТАЙМАУТ: '#d29922',
  ЧАСТИЧНО: '#d29922',
  ОШИБКА: '#f85149'
}

const TABS = [
  { id: 'sites', label: 'Сайты' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'summary', label: 'Сводка' }
]

export default function App() {
  const [config, setConfig] = useState(null)
  const [appInfo, setAppInfo] = useState(null)
  const [results, setResults] = useState({})
  const [yt, setYt] = useState(null)
  const [ytProgress, setYtProgress] = useState(null)
  const [summary, setSummary] = useState(null)
  const [score, setScore] = useState(null)
  const [running, setRunning] = useState(false)
  const [statusLine, setStatusLine] = useState('Готов к запуску')
  const [tab, setTab] = useState('sites')
  const [done, setDone] = useState(0)
  const [toast, setToast] = useState(null)
  const totalRef = useRef(1)

  useEffect(() => {
    window.bench.getSites().then((r) => {
      if (r.ok) setConfig(r.config)
      else setStatusLine('Ошибка конфига: ' + r.error)
    })
    window.bench.appInfo().then(setAppInfo)
  }, [])

  useEffect(() => {
    const offs = [
      window.bench.onSiteDone((r) => {
        setResults((prev) => ({ ...prev, [r.name]: r }))
        setDone((d) => d + 1)
      }),
      window.bench.onYoutubeProgress((p) => setYtProgress(p)),
      window.bench.onDone(({ summary: s, score: sc }) => {
        setSummary(s)
        setScore(sc)
        setYt(s.youtube)
        setRunning(false)
        setStatusLine('Готово')
        setDone(totalRef.current)
        setTab('summary')
      }),
      window.bench.onError((m) => {
        setRunning(false)
        setStatusLine('Ошибка: ' + m)
      })
    ]
    return () => offs.forEach((off) => off())
  }, [])

  const start = useCallback(async () => {
    if (running) return
    setRunning(true)
    setResults({})
    setYt(null)
    setYtProgress(null)
    setSummary(null)
    setScore(null)
    setDone(0)
    setStatusLine('Выполняется…')
    const n = (config?.general?.length || 0) + 1
    totalRef.current = n
    setDone(0)
    await window.bench.run()
  }, [config, running])

  const exportCsv = useCallback(async () => {
    if (!summary) return
    const text = buildCsv(summary)
    const r = await window.bench.exportCsv(text)
    if (r.ok) {
      setToast('Сохранено: ' + r.path)
      setTimeout(() => setToast(null), 5000)
    }
  }, [summary])

  const progress = Math.round((done / totalRef.current) * 100)
  const counts = useMemo(
    () => ({
      ok: Object.values(results).filter((r) => r.status === 'ДОСТУПЕН').length,
      partial: Object.values(results).filter((r) => r.status === 'ЧАСТИЧНО').length,
      blocked: Object.values(results).filter((r) => r.status === 'ЗАБЛОКИРОВАН').length,
      timeout: Object.values(results).filter((r) => r.status === 'ТАЙМАУТ').length
    }),
    [results]
  )

  return (
    <div className="app">
      <header className="topbar">
        <button className="primary" onClick={start} disabled={running}>
          {running ? '⏳ Идёт замер…' : '▶ Запустить бенчмарк'}
        </button>
        <button onClick={exportCsv} disabled={!summary || running}>
          💾 Экспорт CSV
        </button>
        <div className="spacer" />
        <div className="status">{statusLine}</div>
      </header>

      <div className="progress">
        <div className="bar" style={{ width: progress + '%' }} />
      </div>

      <div className="chips">
        <span className="chip ok">Доступны: {counts.ok + counts.partial}</span>
        <span className="chip bad">Заблокированы: {counts.blocked}</span>
        <span className="chip warn">Таймаут: {counts.timeout}</span>
        {yt && (
          <span className="chip">
            YouTube: {yt.opened_count}/{yt.total_domains}
          </span>
        )}
        {score && (
          <span className="chip score">
            {score.parrots} {score.score}/100
          </span>
        )}
      </div>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'tab active' : 'tab'} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      <main className="panel">
        {tab === 'sites' && (
          <SitesTable config={config} results={results} running={running} />
        )}
        {tab === 'youtube' && <YoutubePanel yt={yt} progress={ytProgress} running={running} />}
        {tab === 'summary' && <Summary summary={summary} score={score} />}
      </main>

      <footer className="footer">
        BenchmarkBlock {appInfo?.version} · Electron {appInfo?.electron} · Node {appInfo?.node}
      </footer>

      {score && !running && <ScoreOverlay score={score} summary={summary} onClose={() => setScore(null)} />}
      {toast && <div className="toast">{toast}</div>}
    </div>
  )
}

function SitesTable({ config, results, running }) {
  if (!config) return <div className="muted">Загрузка списка сайтов…</div>
  return (
    <table className="grid">
      <thead>
        <tr>
          <th>Сайт</th>
          <th>URL</th>
          <th className="num">Статус</th>
          <th className="num">HTTP</th>
          <th className="num">Время (мс)</th>
          <th>Комментарий</th>
        </tr>
      </thead>
      <tbody>
        {config.general.map((s) => {
          const r = results[s.name]
          const st = r ? r.status : running ? '…' : '—'
          const color = r ? STATUS_COLORS[r.status] : undefined
          return (
            <tr key={s.name}>
              <td>{s.name}</td>
              <td className="url">{s.url}</td>
              <td className="num" style={{ color }}>
                {st}
              </td>
              <td className="num">{r?.http_code ?? '—'}</td>
              <td className="num">{r?.response_time_ms ?? '—'}</td>
              <td className="msg">{r?.error_message || ''}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function YoutubePanel({ yt, progress, running }) {
  const pct = yt ? Math.round((yt.opened_count / Math.max(1, yt.total_domains)) * 100) : 0
  return (
    <div className="yt">
      <div className="yt-head">
        <div>
          <h3>YouTube</h3>
          <div className="muted">
            {yt
              ? `Статус: ${yt.status} · Открылись ${yt.opened_count} из ${yt.total_domains}`
              : running && progress
                ? `Проверка: ${progress.domain} (${progress.i}/${progress.total})`
                : 'YouTube ещё не проверялся'}
          </div>
        </div>
        <div className="yt-ring" style={{ '--pct': pct + '%', color: yt ? STATUS_COLORS[yt.status] : '#888' }}>
          {pct}%
        </div>
      </div>

      {yt && (
        <div className="yt-cols">
          <div>
            <h4 className="ok">Открытые домены ({yt.opened_domains.length})</h4>
            <ul>
              {yt.opened_domains.map((d) => (
                <li key={d} className="ok">
                  {d}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="bad">Недоступные домены ({yt.failed_domains.length})</h4>
            <ul>
              {yt.failed_domains.map((d) => (
                <li key={d} className="bad">
                  {d}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}

function Summary({ summary, score }) {
  if (!summary) return <div className="muted">Запустите бенчмарк, чтобы увидеть сводку.</div>
  return (
    <div className="summary">
      <pre>{formatSummary(summary, score)}</pre>
    </div>
  )
}

function ScoreOverlay({ score, summary, onClose }) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="parrots">{score.parrots}</div>
        <div className="big">{score.score} / {score.max_score}</div>
        <div className="verdict">{score.verdict}</div>
        <p>{score.congrats}</p>
        <div className="row">
          <span>✅ {summary.accessible}</span>
          <span>❌ {summary.blocked}</span>
          <span>⏱ {summary.timeout}</span>
          <span>⚠ {summary.errors}</span>
        </div>
        <button className="primary" onClick={onClose}>
          Закрыть
        </button>
      </div>
    </div>
  )
}

function formatSummary(s, score) {
  const L = []
  L.push('='.repeat(52))
  L.push('           СВОДКА БЕНЧМАРКА')
  L.push('='.repeat(52))
  L.push(`Время запуска: ${s.timestamp}`)
  L.push('')
  L.push(`Всего сайтов протестировано: ${s.total_sites}`)
  L.push(`  ✅ Доступны: ${s.accessible}`)
  L.push(`  ❌ Заблокированы: ${s.blocked}`)
  L.push(`  ⏱ Таймаут: ${s.timeout}`)
  L.push(`  ⚠ Ошибки: ${s.errors}`)
  L.push(`Общее время теста: ${s.total_time_ms} мс`)
  if (s.youtube) {
    L.push('')
    L.push('-'.repeat(52))
    L.push('YouTube:')
    L.push(`  Статус: ${s.youtube.status}`)
    L.push(`  Открылись: ${s.youtube.opened_count} / ${s.youtube.total_domains}`)
    L.push(`  Не открылись: ${s.youtube.failed_count}`)
  }
  if (score) {
    L.push('')
    L.push('='.repeat(52))
    L.push(`  СКОР: ${score.score} / ${score.max_score} попугаев`)
    L.push(`  ${score.parrots}`)
    L.push('='.repeat(52))
    L.push(`ВЕРДИКТ: ${score.verdict}`)
    L.push('')
    L.push(score.congrats)
  }
  return L.join('\n')
}