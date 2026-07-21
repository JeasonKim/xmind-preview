import MindElixir from 'mind-elixir'
import 'mind-elixir/style.css'
import { convertXmindToMindElixir, importXMindFile } from '@mind-elixir/import-xmind'
import JSZip from 'jszip'
import { parsePresetMapCatalog } from './map-catalog.js'
import './styles.css'

const app = document.querySelector('#app')
let guideResizeTimer

const state = {
  mind: null,
  document: null,
  selectedSheetId: '',
  fileName: '',
  sourceKind: 'guide',
  activePresetMapId: '',
  presetMaps: [],
  dark: window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  scalePercent: 100,
}

bootstrap()

async function bootstrap() {
  registerServiceWorker()
  registerFileLaunchHandler()
  registerGuideViewportResize()
  await loadPresetMaps()
  renderShell()
  renderUsageGuide()
}

function registerGuideViewportResize() {
  window.addEventListener('resize', () => {
    clearTimeout(guideResizeTimer)
    guideResizeTimer = setTimeout(() => {
      if (state.sourceKind === 'guide') previewUsageGuide()
    }, 120)
  })
}

async function loadPresetMaps() {
  try {
    const response = await fetch('./maps/catalog.json', { cache: 'no-store' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    state.presetMaps = parsePresetMapCatalog(await response.json())
  } catch (error) {
    console.warn(`[xmind-preview] 预置导图清单加载失败，已按空目录处理：${error instanceof Error ? error.message : String(error)}`)
    state.presetMaps = []
  }
}

async function previewLaunchedFile(fileHandle) {
  setStatus('正在读取文件...')
  try {
    const file = await fileHandle.getFile()
    await previewLocalXmindFile(file)
  } catch (error) {
    setStatus(error instanceof Error ? error.message : '文件读取失败', true)
  }
}

async function previewLocalXmindFile(file) {
  try {
    await previewXmindFile(file)
  } catch (error) {
    console.warn(`[xmind-preview] 本地 XMind 文件解析失败：${error instanceof Error ? error.message : String(error)}`)
    setStatus(error instanceof Error ? error.message : 'XMind 文件解析失败', true)
  }
}

async function previewXmindFile(file) {
  setStatus('正在解析 XMind...')
  const buffer = await file.arrayBuffer()
  await previewXmindBuffer(buffer, file.name || 'document.xmind', { kind: 'local' })
}

async function previewPresetMap(source) {
  setStatus('正在读取预置导图...')
  try {
    const response = await fetch(source.file, { cache: 'no-store' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    await previewXmindBuffer(await response.arrayBuffer(), source.title, { kind: 'preset', mapId: source.id })
  } catch (error) {
    console.warn(`[xmind-preview] 预置导图加载失败 id=${source.id}：${error instanceof Error ? error.message : String(error)}`)
    setStatus(`无法加载“${source.title}”`, true)
  }
}

async function previewXmindBuffer(buffer, fileName, source) {
  const document = await parseXmind(buffer, fileName)
  if (!document.sheets.length) {
    throw new Error('XMind 文件里没有可预览的 Sheet')
  }
  state.document?.dispose()
  state.document = document
  state.fileName = fileName
  state.sourceKind = source.kind
  state.activePresetMapId = source.mapId || ''
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
      previewUsageGuide()
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
          <div class="map-identity">
            <div class="title">${escapeHtml(selectedSheet()?.title || state.fileName || 'XMind Preview')}</div>
            ${renderMapSourceSelector()}
          </div>
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
    if (file) void previewLocalXmindFile(file)
  })
  app.querySelector('[data-action="source"]')?.addEventListener('change', event => {
    const sourceId = event.target.value
    if (sourceId === 'guide') {
      previewUsageGuide()
      return
    }
    const source = state.presetMaps.find(item => item.id === sourceId)
    if (source) void previewPresetMap(source)
  })
  app.querySelector('[data-action="theme"]')?.addEventListener('click', () => {
    state.dark = !state.dark
    renderShell()
    renderCurrentMind()
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
    if (file) void previewLocalXmindFile(file)
  })
}

function renderMapSourceSelector() {
  const choices = [
    { id: 'guide', title: '使用指南' },
    ...state.presetMaps,
  ]
  if (state.sourceKind === 'local') {
    choices.push({ id: 'local', title: `本地文件：${state.fileName}`, disabled: true })
  }
  if (choices.length === 1) return ''

  return `
    <select class="source-select" data-action="source" aria-label="导图内容">
      ${choices.map(choice => `
        <option value="${escapeHtml(choice.id)}"${choice.id === activeMapSourceId() ? ' selected' : ''}${choice.disabled ? ' disabled' : ''}>
          ${escapeHtml(choice.title)}
        </option>
      `).join('')}
    </select>
  `
}

function activeMapSourceId() {
  if (state.sourceKind === 'preset') return state.activePresetMapId
  return state.sourceKind
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
  if (!sheet) return
  renderMindData(sheet.data)
}

function previewUsageGuide() {
  state.document?.dispose()
  state.document = null
  state.fileName = ''
  state.sourceKind = 'guide'
  state.activePresetMapId = ''
  state.scalePercent = 100
  renderShell()
  renderUsageGuide()
}

function renderUsageGuide() {
  renderMindData(createUsageGuideData(), true)
}

function renderCurrentMind() {
  if (state.document) {
    renderSelectedSheet()
    return
  }
  renderUsageGuide()
}

function renderMindData(data, fillViewport = false) {
  const map = document.querySelector('#map')
  if (!map) return

  state.mind?.destroy?.()
  state.mind = new MindElixir({
    el: map,
    direction: MindElixir.RIGHT,
    editable: false,
    contextMenu: false,
    toolBar: false,
    keypress: false,
    theme: state.dark ? MindElixir.DARK_THEME : MindElixir.THEME,
  })
  state.mind.init(data)
  if (fillViewport) {
    configureUsageGuideSpacing(map)
  }
  state.mind.scaleFit()
  if (fillViewport) {
    scaleGuideToViewport(map)
  }
  updateScaleLabel(state.mind.scaleVal)
  state.mind.bus.addListener('scale', updateScaleLabel)
}

function configureUsageGuideSpacing(map) {
  const { nodes, container } = state.mind
  if (!nodes.offsetWidth || !nodes.offsetHeight) return

  const targetAspectRatio = (map.clientWidth * 0.92) / (map.clientHeight * 0.82)
  const missingWidth = Math.max(0, nodes.offsetHeight * targetAspectRatio - nodes.offsetWidth)
  const spacingBudget = map.clientWidth >= 900
    ? Math.max(missingWidth, map.clientWidth * 0.28)
    : missingWidth
  if (!spacingBudget) return

  // 引导导图的分支全部位于右侧，需要增加横向层级距离以充分利用宽屏空间。
  const mainGapLimit = map.clientWidth >= 900 ? 280 : 140
  const nodeGapLimit = map.clientWidth >= 900 ? 220 : 90
  container.style.setProperty('--main-gap-x', `${Math.min(mainGapLimit, 65 + spacingBudget * 0.5)}px`)
  container.style.setProperty('--node-gap-x', `${Math.min(nodeGapLimit, 30 + spacingBudget * 0.35)}px`)
  state.mind.refresh()
}

function scaleGuideToViewport(map) {
  const initialBounds = visibleGuideBounds()
  if (!initialBounds) return

  const availableWidth = map.clientWidth * 0.92
  const availableHeight = map.clientHeight * 0.82
  const scaleRatio = Math.min(availableWidth / initialBounds.width, availableHeight / initialBounds.height, 2.75)
  state.mind.scale(state.mind.scaleVal * scaleRatio)
  state.mind.toCenter()

  const guideBounds = visibleGuideBounds()
  if (!guideBounds) return
  const mapBounds = map.getBoundingClientRect()
  const targetLeft = mapBounds.left + mapBounds.width * 0.04
  const targetCenterY = mapBounds.top + mapBounds.height / 2
  moveGuideCanvas(targetLeft - guideBounds.left, targetCenterY - (guideBounds.top + guideBounds.height / 2))
}

function visibleGuideBounds() {
  const topics = [...state.mind.nodes.querySelectorAll('me-tpc')]
  if (!topics.length) return null

  const bounds = topics.map(topic => topic.getBoundingClientRect())
  const left = Math.min(...bounds.map(bound => bound.left))
  const right = Math.max(...bounds.map(bound => bound.right))
  const top = Math.min(...bounds.map(bound => bound.top))
  const bottom = Math.max(...bounds.map(bound => bound.bottom))
  return { left, right, top, bottom, width: right - left, height: bottom - top }
}

function moveGuideCanvas(deltaX, deltaY) {
  const transform = state.mind.map.style.transform
  const match = transform.match(/translate3d\(([-\d.]+)px, ([-\d.]+)px, 0px\)/)
  if (!match) {
    console.warn(`[xmind-preview] 无法解析引导导图的位置：${transform}`)
    return
  }

  const x = Number(match[1]) + deltaX
  const y = Number(match[2]) + deltaY
  state.mind.map.style.transform = `translate3d(${x}px, ${y}px, 0px) scale(${state.mind.scaleVal})`
}

function updateScaleLabel(scaleValue) {
  state.scalePercent = Math.round(scaleValue * 100)
  const scale = document.querySelector('.scale')
  if (scale) scale.textContent = `${state.scalePercent}%`
}

function createUsageGuideData() {
  const guide = MindElixir.new('XMind Preview 使用指南')
  guide.nodeData.children = [
    createGuideTopic('1', '打开与安装', [
      '点击右上角“打开”选择 .xmind',
      '或将 .xmind 文件拖入页面',
      '在 Chrome 地址栏点击安装图标',
      '安装后可从应用列表启动',
    ]),
    createGuideTopic('2', '浏览与关联', [
      '在系统“打开方式”选择 XMind Preview',
      '具体入口由浏览器和系统决定',
      '使用缩放按钮调整视图',
      '左侧可切换多个 Sheet',
    ]),
    createGuideTopic('3', '隐私', [
      '文件仅在当前浏览器本地解析',
      '不会上传到此网站',
    ]),
  ]
  return guide
}

function createGuideTopic(order, title, children) {
  const topic = `${order} ${title}`
  return {
    id: `guide-${topic}`,
    topic,
    expanded: true,
    children: children.map((child, index) => ({
      id: `guide-${topic}-${index}`,
      topic: `${order}.${index + 1} ${child}`,
      expanded: true,
      children: [],
    })),
  }
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

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}
