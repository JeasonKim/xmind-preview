export function parsePresetMapCatalog(catalog) {
  if (!Array.isArray(catalog?.maps)) {
    console.warn('[xmind-preview] 预置导图清单缺少 maps 数组，已按空目录处理。')
    return []
  }

  const usedIds = new Set()
  return catalog.maps.flatMap((entry, index) => {
    const id = typeof entry?.id === 'string' ? entry.id.trim() : ''
    const title = typeof entry?.title === 'string' ? entry.title.trim() : ''
    const file = typeof entry?.file === 'string' ? entry.file.trim() : ''
    if (!id || !title || !file.toLowerCase().endsWith('.xmind')) {
      console.warn(`[xmind-preview] 忽略无效的预置导图条目 index=${index}：需要 id、title 和 .xmind 文件路径。`)
      return []
    }
    if (usedIds.has(id)) {
      console.warn(`[xmind-preview] 忽略重复的预置导图条目 id=${id}。`)
      return []
    }
    usedIds.add(id)
    return [{ id, title, file }]
  })
}
