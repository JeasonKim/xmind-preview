import MindElixir from 'mind-elixir'
import 'mind-elixir/style.css'
import { convertXmindToMindElixir, importXMindFile } from '@mind-elixir/import-xmind'
import JSZip from 'jszip'
import './styles.css'

const app = document.querySelector('#app')

const state = {
  mind: null,
  document: null,
  selectedSheetId: '',
  fileName: '',
  dark: window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  scalePercent: 100,
}

bootstrap()

async function bootstrap() {
  registerServiceWorker()
  registerFileLaunchHandler()
  renderShell()
  renderEmptyState()
}

async function previewLaunchedFile(fileHandle) {
  setStatus('正在读取文件...')
  try {
    const file = await fileHandle.getFile()
    await previewXmindFile(file)
  } catch (error) {
    setStatus(error instanceof Error ? error.message : '文件读取失败', true)
  }
}

async function previewXmindFile(file) {
  setStatus('正在解析 XMind...')
  const buffer = await file.arrayBuffer()
  await previewXmindBuffer(buffer, file.name || 'document.xmind')
}

async function previewXmindBuffer(buffer, fileName) {
  const document = await parseXmind(buffer, fileName)
  if (!document.sheets.length) {
    throw new Error('XMind 文件里没有可预览的 Sheet')
  }
  state.document?.dispose()
  state.document = document
  state.fileName = fileName
  state.selectedSheetId = document.sheets[0].id
  state.scalePercent = 100
  renderShell()
  renderSelectedSheet()
}

async function parseXmind(buffer, fileName) {
  const { map, blobUrls } = await buildImageResourceMap(buffer)
  const file = new File([buffer], fileName, { type: 'application/vnd.xmind.workbook' })
  const sheets = await importXMindFile(file)
  return {
    sheets: sheets.map(sheet => ({
      id: sheet.id,
      title: sheet.title || 'Untitled',
      data: patchMindElixirImages(convertXmindToMindElixir(sheet), url => resolveXapResourceUrl(url, map)),
    })),
    dispose: () => {
      for (const url of blobUrls) URL.revokeObjectURL(url)
      map.clear()
    },
  }
}

async function buildImageResourceMap(buffer) {
  const zip = await JSZip.loadAsync(buffer)
  const map = new Map()
  const blobUrls = []
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue
    const normalizedPath = path.replace(/\\/g, '/')
    const lowerPath = normalizedPath.toLowerCase()
    if (!lowerPath.startsWith('resources/') && !lowerPath.startsWith('attachments/')) continue

    const blob = new Blob([await entry.async('uint8array')], { type: mimeType(normalizedPath) })
    const blobUrl = URL.createObjectURL(blob)
    blobUrls.push(blobUrl)

    const fileName = normalizedPath.split('/').pop() || normalizedPath
    const variants = [
      normalizedPath,
      fileName,
      `xap:resources/${fileName}`,
      `xap:attachments/${fileName}`,
      `xap:resource/${fileName}`,
      `xap:resources/${normalizedPath}`,
      `xap:attachments/${normalizedPath}`,
      `xap:resource/${normalizedPath}`,
    ]
    for (const key of variants) map.set(key, blobUrl)
  }
  return { map, blobUrls }
}

function patchMindElixirImages(data, resolveImageUrl) {
  patchNodeImages(data.nodeData, resolveImageUrl)
  return data
}

function patchNodeImages(node, resolveImageUrl) {
  if (node.image?.url) {
    node.image = { ...node.image, url: resolveImageUrl(node.image.url) }
  }
  for (const child of node.children || []) {
    patchNodeImages(child, resolveImageUrl)
  }
}

function resolveXapResourceUrl(url, map) {
  if (!url || !/^xap:/i.test(url)) return url
  const direct = map.get(url)
  if (direct) return direct

  const withoutScheme = url.replace(/^xap:/i, '')
  const byPath = map.get(withoutScheme)
  if (byPath) return byPath

  const fileName = withoutScheme.split('/').pop()
  return fileName ? map.get(fileName) || url : url
}

function mimeType(path) {
  const lowerPath = path.toLowerCase()
  if (lowerPath.endsWith('.png')) return 'image/png'
  if (lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg')) return 'image/jpeg'
  if (lowerPath.endsWith('.gif')) return 'image/gif'
  if (lowerPath.endsWith('.webp')) return 'image/webp'
  if (lowerPath.endsWith('.svg')) return 'image/svg+xml'
  return 'application/octet-stream'
}

function registerFileLaunchHandler() {
  if (!('launchQueue' in window)) return
  window.launchQueue.setConsumer(launchParams => {
    const fileHandle = launchParams.files?.[0]
    if (!fileHandle) {
      renderEmptyState()
      return
    }
    void previewLaunchedFile(fileHandle)
  })
}

function registerServiceWorker() {
  if (!import.meta.env.PROD) return
  if (!('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js').catch(error => {
      console.warn(`[xmind-preview] Service Worker 注册失败：${error instanceof Error ? error.message : String(error)}`)
    })
  })
}

function renderShell() {
  const sheets = state.document?.sheets || []
  document.documentElement.classList.toggle('dark', state.dark)
  app.innerHTML = `
    <div class="preview-shell">
      ${sheets.length > 1 ? renderSidebar(sheets) : ''}
      <main class="map-main">
        <header class="map-header">
          <div class="title">${escapeHtml(selectedSheet()?.title || state.fileName || 'XMind Preview')}</div>
          <div class="controls">
            <label class="text-button file-button">
              打开
              <input data-action="file" type="file" accept=".xmind,application/vnd.xmind.workbook" />
            </label>
            <button class="icon-button" data-action="zoom-out" title="缩小">-</button>
            <span class="scale">${state.scalePercent}%</span>
            <button class="icon-button" data-action="zoom-in" title="放大">+</button>
            <button class="text-button" data-action="theme">${state.dark ? '亮色' : '暗色'}</button>
          </div>
        </header>
        <div id="map"></div>
        <div id="status" class="status"></div>
      </main>
    </div>
  `
  app.querySelectorAll('[data-sheet-id]').forEach(item => {
    item.addEventListener('click', () => {
      state.selectedSheetId = item.dataset.sheetId
      renderShell()
      renderSelectedSheet()
    })
  })
  app.querySelector('[data-action="zoom-out"]')?.addEventListener('click', () => scaleBy(-0.1))
  app.querySelector('[data-action="zoom-in"]')?.addEventListener('click', () => scaleBy(0.1))
  app.querySelector('[data-action="file"]')?.addEventListener('change', event => {
    const file = event.target.files?.[0]
    if (file) void previewXmindFile(file)
  })
  app.querySelector('[data-action="theme"]')?.addEventListener('click', () => {
    state.dark = !state.dark
    renderShell()
    renderSelectedSheet()
  })
  const map = app.querySelector('#map')
  map?.addEventListener('dragover', event => {
    event.preventDefault()
    map.classList.add('dragging')
  })
  map?.addEventListener('dragleave', () => {
    map.classList.remove('dragging')
  })
  map?.addEventListener('drop', event => {
    event.preventDefault()
    map.classList.remove('dragging')
    const file = event.dataTransfer?.files?.[0]
    if (file) void previewXmindFile(file)
  })
}

function renderSidebar(sheets) {
  return `
    <aside class="sheet-sidebar">
      <div class="sidebar-title">Sheets</div>
      ${sheets
        .map(sheet => `
          <button class="sheet-item${sheet.id === state.selectedSheetId ? ' active' : ''}" data-sheet-id="${escapeHtml(sheet.id)}">
            ${escapeHtml(sheet.title)}
          </button>
        `)
        .join('')}
    </aside>
  `
}

function renderSelectedSheet() {
  const sheet = selectedSheet()
  const map = document.querySelector('#map')
  if (!sheet || !map) return

  state.mind?.destroy?.()
  state.mind = new MindElixir({
    el: map,
    direction: MindElixir.SIDE,
    editable: false,
    contextMenu: false,
    toolBar: false,
    keypress: false,
    theme: state.dark ? MindElixir.DARK_THEME : MindElixir.THEME,
  })
  state.mind.init(sheet.data)
  state.mind.scaleFit()
  state.mind.bus.addListener('scale', value => {
    state.scalePercent = Math.round(value * 100)
    const scale = document.querySelector('.scale')
    if (scale) scale.textContent = `${state.scalePercent}%`
  })
}

function selectedSheet() {
  return state.document?.sheets.find(sheet => sheet.id === state.selectedSheetId) || null
}

function scaleBy(step) {
  if (!state.mind) return
  state.mind.scale(Math.max(state.mind.scaleMin, Math.min(state.mind.scaleMax, state.mind.scaleVal + step)))
}

function setStatus(message, error = false) {
  const status = document.querySelector('#status')
  if (!status) return
  status.textContent = message
  status.classList.toggle('error', error)
}

function renderEmptyState() {
  const map = document.querySelector('#map')
  const status = document.querySelector('#status')
  if (status) status.textContent = ''
  if (!map || state.document) return
  map.innerHTML = `
    <div class="empty-state">
      <div class="empty-title">打开一个 XMind 文件</div>
      <div class="empty-desc">拖入 .xmind 文件，或点击右上角“打开”。安装为 PWA 后，也可以从系统打开方式里选择 XMind Preview。</div>
    </div>
  `
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
