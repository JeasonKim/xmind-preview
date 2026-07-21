import MindElixir from 'mind-elixir'
import 'mind-elixir/style.css'
import { convertXmindToMindElixir, importXMindFile } from '@mind-elixir/import-xmind'
import JSZip from 'jszip'
import { createFileLaunchCoordinator } from './file-launch-coordinator.js'
import { parsePresetMapCatalog } from './map-catalog.js'
import './styles.css'

const app = document.querySelector('#app')
const fileLaunchCoordinator = createFileLaunchCoordinator()
const mindLayouts = {
  left: { direction: MindElixir.LEFT, method: 'initLeft' },
  right: { direction: MindElixir.RIGHT, method: 'initRight' },
  both: { direction: MindElixir.SIDE, method: 'initSide' },
}

const state = {
  mind: null,
  document: null,
  selectedSheetId: '',
  fileName: '',
  sourceKind: 'guide',
  activePresetMapId: '',
  presetMaps: [],
  dark: window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  layout: 'right',
  scalePercent: 100,
}

bootstrap()

async function bootstrap() {
  registerServiceWorker()
  registerFileLaunchHandler()
  await loadPresetMaps()
  renderShell()
  const launchedFileHandle = fileLaunchCoordinator.completeShellInitialization()
  if (launchedFileHandle) {
    await previewLaunchedFile(launchedFileHandle)
    return
  }
  renderUsageGuide()
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
    const launchAction = fileLaunchCoordinator.acceptPwaLaunch(fileHandle)
    if (launchAction.type === 'ignore' || launchAction.type === 'queued') {
      if (launchAction.type === 'queued' && launchAction.replacedFileHandle) {
        console.warn('[xmind-preview] 应用初始化期间收到多个文件启动请求，已忽略先前的文件句柄。')
      }
      return
    }
    if (launchAction.type === 'show-guide') {
      previewUsageGuide()
      return
    }
    void previewLaunchedFile(launchAction.fileHandle)
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
  const hasSheetSidebar = sheets.length > 1
  document.documentElement.classList.toggle('dark', state.dark)
  app.innerHTML = `
    <div class="preview-shell${hasSheetSidebar ? ' has-sheet-sidebar' : ''}">
      ${hasSheetSidebar ? renderSidebar(sheets) : ''}
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
            ${renderLayoutSwitcher()}
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
  app.querySelectorAll('[data-layout]').forEach(button => {
    button.addEventListener('click', () => {
      changeMindLayout(button.dataset.layout)
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

function renderLayoutSwitcher() {
  return `
    <div class="layout-switch" role="group" aria-label="导图布局">
      <button class="layout-button${state.layout === 'right' ? ' active' : ''}" data-layout="right" title="右侧布局">右</button>
      <button class="layout-button${state.layout === 'left' ? ' active' : ''}" data-layout="left" title="左侧布局">左</button>
      <button class="layout-button${state.layout === 'both' ? ' active' : ''}" data-layout="both" title="双侧布局">双</button>
    </div>
  `
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
  renderMindData(createUsageGuideData())
}

function renderCurrentMind() {
  if (state.document) {
    renderSelectedSheet()
    return
  }
  renderUsageGuide()
}

function renderMindData(data) {
  const map = document.querySelector('#map')
  if (!map) return

  state.mind?.destroy?.()
  state.mind = new MindElixir({
    el: map,
    direction: mindLayouts[state.layout].direction,
    editable: false,
    contextMenu: false,
    toolBar: false,
    keypress: false,
    theme: state.dark ? MindElixir.DARK_THEME : MindElixir.THEME,
  })
  state.mind.init(data)
  state.mind.scaleFit()
  enableTopicTextSelection()
  updateScaleLabel(state.mind.scaleVal)
  state.mind.bus.addListener('scale', updateScaleLabel)
}

function enableTopicTextSelection() {
  state.mind.nodes.addEventListener('pointerdown', event => {
    if (event.target instanceof Element && event.target.closest('me-tpc')) event.stopPropagation()
  })
}

function changeMindLayout(layout) {
  if (layout === state.layout || !state.mind) return

  state.layout = layout
  state.mind[mindLayouts[layout].method]()
  state.mind.scaleFit()
  updateScaleLabel(state.mind.scaleVal)
  app.querySelectorAll('[data-layout]').forEach(button => {
    button.classList.toggle('active', button.dataset.layout === layout)
  })
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
