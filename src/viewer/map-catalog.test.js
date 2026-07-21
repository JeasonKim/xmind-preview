import assert from 'node:assert/strict'
import test from 'node:test'
import { parsePresetMapCatalog } from './map-catalog.js'

test('保留有效的预置导图条目', () => {
  assert.deepEqual(parsePresetMapCatalog({
    maps: [
      { id: 'sales-plan', title: '销售计划', file: './maps/sales-plan.xmind' },
      { id: 'onboarding', title: '新员工入职', file: './maps/onboarding.xmind' },
    ],
  }), [
    { id: 'sales-plan', title: '销售计划', file: './maps/sales-plan.xmind' },
    { id: 'onboarding', title: '新员工入职', file: './maps/onboarding.xmind' },
  ])
})

test('忽略缺少必要字段、重复标识或非 XMind 文件的条目', () => {
  assert.deepEqual(parsePresetMapCatalog({
    maps: [
      { id: 'sales-plan', title: '销售计划', file: './maps/sales-plan.xmind' },
      { id: 'sales-plan', title: '重复导图', file: './maps/duplicate.xmind' },
      { id: 'missing-file', title: '缺少文件' },
      { id: 'markdown', title: '错误格式', file: './maps/notes.md' },
    ],
  }), [
    { id: 'sales-plan', title: '销售计划', file: './maps/sales-plan.xmind' },
  ])
})

test('缺少导图列表时返回空目录', () => {
  assert.deepEqual(parsePresetMapCatalog({}), [])
})
