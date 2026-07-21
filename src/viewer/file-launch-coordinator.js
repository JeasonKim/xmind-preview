export function createFileLaunchCoordinator() {
  let shellInitialized = false
  let queuedFileHandle = null

  return {
    acceptPwaLaunch(fileHandle) {
      if (!fileHandle) {
        return { type: shellInitialized ? 'show-guide' : 'ignore' }
      }

      if (shellInitialized) {
        return { type: 'preview', fileHandle }
      }

      const replacedFileHandle = queuedFileHandle
      queuedFileHandle = fileHandle
      return { type: 'queued', replacedFileHandle }
    },

    completeShellInitialization() {
      shellInitialized = true
      const fileHandle = queuedFileHandle
      queuedFileHandle = null
      return fileHandle
    },
  }
}
