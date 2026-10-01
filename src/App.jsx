import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { Canvas } from '@react-three/fiber'
import { PerformanceMonitor } from '@react-three/drei'
import * as THREE from 'three'
import { LevaPanel, useCreateStore } from 'leva'
import Experience from './scene/Experience.jsx'
import ScoreHUD from './ui/ScoreHUD.jsx'
import FxLayer from './ui/FxLayer.jsx'
import Intro from './ui/Intro.jsx'
import Results from './ui/Results.jsx'
import { game, PANEL } from './game/game.js'

const LEVA_THEME = {
  colors: {
    elevation1: '#e7e2d7',
    elevation2: '#dedad0',
    elevation3: '#eeeae1',
    accent1: '#9e1b2b',
    accent2: '#832332',
    accent3: '#b03a48',
    highlight1: '#6f6a5d',
    highlight2: '#3a352a',
    highlight3: '#211d16',
    vivid1: '#9e1b2b',
    folderWidgetColor: '#6f6a5d',
    folderTextColor: '#211d16',
    toolTipBackground: '#211d16',
    toolTipText: '#e7e2d7',
  },
  radii: { xs: '0px', sm: '0px', lg: '0px' },
  fonts: { mono: 'ui-monospace, SF Mono, Menlo, Consolas, monospace', sans: 'Helvetica Neue, Helvetica, Arial, sans-serif' },
}

// phones: the panel would sit on the logo and half the play area
function useNarrow(max = 640) {
  const query = `(max-width: ${max}px)`
  const [narrow, setNarrow] = useState(() => matchMedia(query).matches)
  useEffect(() => {
    const mq = matchMedia(query)
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return narrow
}

export default function App() {
  // Explicit store instead of the implicit global panel: the global one is
  // auto-mounted by the first useControls() call (inside the Canvas tree),
  // which can win the race against a themed <Leva> and ship default colours.
  const levaStore = useCreateStore()
  const narrow = useNarrow()
  const { phase } = useSyncExternalStore(game.subscribe, game.getSnapshot)
  const [ready, setReady] = useState(false) // scene built and shaders warm
  // ≤1.5: at 2× the full-res transmission pass (4× MSAA, re-rendered every
  // frame) falls off a cliff; drop to 1× on machines that can't hold 60.
  const [dpr, setDpr] = useState(() => Math.min(1.5, window.devicePixelRatio || 1))

  const handleReady = useCallback(() => {
    setReady(true)
    game.ready()
  }, [])
  // phase, clock, score, streak and multiplier live in game.js (the scene
  // writes, the DOM reads); restart = a fresh countdown
  const handleRestart = useCallback(() => game.start(), [])
  const inRound = phase === 'countdown' || phase === 'playing' || phase === 'over'

  return (
    <>
      <Canvas
        camera={{ position: [0, 0.9, 11], fov: 36, near: 0.1, far: 80 }}
        dpr={dpr}
        gl={{ antialias: true }}
        onCreated={({ gl }) => {
          // Khronos PBR Neutral keeps the candy colours true instead of ACES's filmic shift
          gl.toneMapping = THREE.NeutralToneMapping
          gl.toneMappingExposure = 1
        }}
      >
        <PerformanceMonitor
          onDecline={() => setDpr(1)}
          onIncline={() => setDpr(Math.min(1.5, window.devicePixelRatio || 1))}
        />
        <Experience onReady={handleReady} levaStore={levaStore} />
      </Canvas>
      <FxLayer />
      <ScoreHUD onReset={handleRestart} visible={inRound} />
      <Intro ready={ready} />
      <Results />
      {/* the tuning panel only with ?panel (a tuned round is never ranked) */}
      <LevaPanel
        store={levaStore}
        collapsed
        hidden={!PANEL || narrow || !inRound}
        titleBar={{ title: 'Jelly Slice', position: { x: 0, y: 96 } }}
        theme={LEVA_THEME}
      />
    </>
  )
}
