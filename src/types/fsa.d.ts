/**
 * File System Access API 类型补充（TS lib.dom 尚未覆盖的部分）
 */

interface FileSystemDirectoryHandle {
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>
  queryPermission(desc?: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission(desc?: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
}
