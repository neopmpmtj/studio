const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const CLIP_PATH_RE = new RegExp(
  `^(?:modified/clips/audio|clips/audio(?:/modified)?)/(${UUID})/\\1\\.wav$`,
  'i',
)
const LEGACY_MODIFIED_RE = new RegExp(`^modified/clips/audio/${UUID}/${UUID}\\.wav$`, 'i')
const SEGMENT = '[A-Za-z0-9][A-Za-z0-9._-]*'
const COPY_PATH_RE = new RegExp(`^clips/audio/modified/(?:${SEGMENT}/)*${SEGMENT}\\.wav$`)

export function clipIdFromPath(audioPath: string | null): string | null {
  if (!audioPath) return null
  const m = CLIP_PATH_RE.exec(audioPath)
  if (!m) return null
  return m[1].toLowerCase()
}

export function isLegacyModifiedPath(audioPath: string | null): boolean {
  return !!audioPath && LEGACY_MODIFIED_RE.test(audioPath)
}

export function isModifiedPath(audioPath: string | null): boolean {
  if (!audioPath) return false
  const path = audioPath.toLowerCase()
  return path.startsWith('clips/audio/modified/') || path.startsWith('modified/')
}

// Save as may only write under clips/audio/modified/, as a .wav with plain path segments.
export function isAllowedCopyPath(audioPath: string): boolean {
  return audioPath.length <= 240 && COPY_PATH_RE.test(audioPath)
}

// A copy already in the modified folder keeps its path. Anything else proposes that folder.
export function modifiedCopyPath(audioPath: string | null): string | null {
  if (audioPath && isAllowedCopyPath(audioPath)) return audioPath
  const id = clipIdFromPath(audioPath)
  if (!id) return null
  return `clips/audio/modified/${id}/${id}.wav`
}
