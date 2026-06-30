// Navigator — the left dock's structure column: Scenes (vertical strip) above
// Layers. Unifies the two structure surfaces that used to be split (a full-width
// scenes strip on top + a separate layers panel).

import { LayersPanel } from './LayersPanel'
import { ScenesStrip } from './ScenesStrip'

export function Navigator(props: { onPreviewScene: (id: string) => void }): JSX.Element {
  return (
    <div className="navigator">
      <ScenesStrip vertical onPreviewScene={props.onPreviewScene} />
      <LayersPanel />
    </div>
  )
}
