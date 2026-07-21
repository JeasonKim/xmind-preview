import assert from 'node:assert/strict'
import test from 'node:test'
import { createFileLaunchCoordinator } from './file-launch-coordinator.js'

test('在界面就绪前暂存 PWA 打开的文件', () => {
  const coordinator = createFileLaunchCoordinator()
  const fileHandle = { name: 'plan.xmind' }

  assert.deepEqual(coordinator.acceptPwaLaunch(fileHandle), { type: 'queued', replacedFileHandle: null })
  assert.equal(coordinator.completeShellInitialization(), fileHandle)
})

test('界面就绪后立即预览 PWA 打开的文件', () => {
  const coordinator = createFileLaunchCoordinator()
  coordinator.completeShellInitialization()
  const fileHandle = { name: 'plan.xmind' }

  assert.deepEqual(coordinator.acceptPwaLaunch(fileHandle), { type: 'preview', fileHandle })
})

test('启动阶段收到多个文件时保留最后一次启动请求', () => {
  const coordinator = createFileLaunchCoordinator()
  const firstFileHandle = { name: 'first.xmind' }
  const secondFileHandle = { name: 'second.xmind' }

  coordinator.acceptPwaLaunch(firstFileHandle)
  assert.deepEqual(coordinator.acceptPwaLaunch(secondFileHandle), {
    type: 'queued',
    replacedFileHandle: firstFileHandle,
  })
  assert.equal(coordinator.completeShellInitialization(), secondFileHandle)
})
