// Preview device presets. Dimensions are the device's logical (CSS px) viewport
// in PORTRAIT; landscape swaps W/H. Editable in the Preview overlay and
// persisted to localStorage so teams can dial in their exact targets.

export interface Device {
  id: string
  label: string
  w: number // portrait width
  h: number // portrait height
}

const DEFAULTS: Device[] = [
  { id: 'applovin', label: 'AppLovin', w: 480, h: 800 },
  { id: 'phone', label: 'Phone', w: 390, h: 844 },
  { id: 'iphonese', label: 'iPhone SE', w: 375, h: 667 },
  { id: 'tablet', label: 'Tablet', w: 820, h: 1180 },
]

const LS_KEY = 'pa:devices'

export function loadDevices(): Device[] {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Device[]
      if (Array.isArray(parsed) && parsed.length) return parsed
    }
  } catch {
    /* ignore */
  }
  return DEFAULTS.map((d) => ({ ...d }))
}

export function saveDevices(devices: Device[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(devices))
  } catch {
    /* ignore */
  }
}
