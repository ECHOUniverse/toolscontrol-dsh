/**
 * 可本地化警告收集器（宿主半）。
 *
 * 向后兼容契约：`warnings` 始终保留原始文本（旧客户端与未知 code 的回退），
 * `warningItems` 与其严格同序，携带客户端拼接 `warning.<code>` 所需的
 * code/params。任何 warning push 点都必须同时经过 `warn()`，避免两者错位。
 *
 * @module @hanxu131/toolscontrol-dsh/host/warnings
 */

import type { WarningItem } from '../shared/protocol.ts'

/** 一个快照纵切的警告收集器。 */
export interface WarningLog {
  warnings: string[]
  warningItems: WarningItem[]
}

/** 空的警告收集器。 */
export function warningLog(): WarningLog {
  return { warnings: [], warningItems: [] }
}

/** 追加一条可本地化警告（raw 始终保留，供旧客户端/未知 code 回退）。 */
export function warn(
  log: WarningLog,
  code: string,
  params: Record<string, string | number> | undefined,
  raw: string,
): void {
  log.warnings.push(raw)
  log.warningItems.push(params === undefined ? { code } : { code, params })
}
