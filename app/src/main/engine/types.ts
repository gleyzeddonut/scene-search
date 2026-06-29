export type SceneBlock = { type: 'action'; text: string } | { type: 'cue'; who: string; text: string }

export interface LayoutLine {
  text: string
  x: number // left edge of the line, in PDF points
  page: number
}

export interface Scene {
  heading: string
  index: number
  page: number
  characters: string[]
  lines: [string, string][]
  blocks: SceneBlock[]
}

export interface SceneMatch {
  script_path: string
  script_name: string
  heading: string
  page: number
  char_count: number
  characters: string[]
  pairing: string | null
  scene_index: number
  est_seconds: number
}

export interface Folders {
  roots: string[]
  ignored: string[]
}
