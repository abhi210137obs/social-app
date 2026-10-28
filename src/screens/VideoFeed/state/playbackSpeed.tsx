import {createContext, useContext, useRef, useState} from 'react'
import {type NativeGesture, usePanGesture} from 'react-native-gesture-handler'

import {useHaptics} from '#/lib/haptics'

/** The speed videos play at until the user asks for something else. */
export const DEFAULT_PLAYBACK_SPEED = 1
export const FAST_PLAYBACK_SPEED = 2
export const SLOW_PLAYBACK_SPEED = 0.5

/** How long the user has to hold before the speed-up kicks in. */
const HOLD_DURATION = 500

/*
 * How far the finger has to travel from where it was pressed before we read it
 * as a deliberate up or down drag rather than the jitter of holding still.
 */
const DRAG_THRESHOLD = 24

type StateContext = {
  /**
   * The speed applied to every video in the feed. Set by dragging up or down
   * during a press and hold, and kept when the user swipes to another video.
   */
  stickySpeed: number
  /**
   * The speed the video on screen is playing at right now - the sticky speed,
   * unless a press and hold is overriding it for this video only.
   */
  activeSpeed: number
}

type ApiContext = {
  setStickySpeed: (speed: number) => void
  /** Pass `null` to hand the active video back to the sticky speed. */
  setTransientSpeed: (speed: number | null) => void
}

const stateContext = createContext<StateContext>({
  stickySpeed: DEFAULT_PLAYBACK_SPEED,
  activeSpeed: DEFAULT_PLAYBACK_SPEED,
})
stateContext.displayName = 'PlaybackSpeedStateContext'

const apiContext = createContext<ApiContext>({
  setStickySpeed: () => {},
  setTransientSpeed: () => {},
})
apiContext.displayName = 'PlaybackSpeedApiContext'

export function Provider({children}: {children: React.ReactNode}) {
  const [stickySpeed, setStickySpeed] = useState(DEFAULT_PLAYBACK_SPEED)
  const [transientSpeed, setTransientSpeed] = useState<number | null>(null)

  return (
    <apiContext.Provider value={{setStickySpeed, setTransientSpeed}}>
      <stateContext.Provider
        value={{stickySpeed, activeSpeed: transientSpeed ?? stickySpeed}}>
        {children}
      </stateContext.Provider>
    </apiContext.Provider>
  )
}

export function usePlaybackSpeed() {
  return useContext(stateContext)
}

export function usePlaybackSpeedApi() {
  return useContext(apiContext)
}

/**
 * Press and hold the video to play it at 2x until the finger lifts. Dragging up
 * or down while held picks 2x or 0.5x and, on release, keeps it for every video
 * in the feed. Holding again while a dragged-in speed is set clears it.
 *
 * Returns the gesture plus `shouldSuppressPress`, which the tap handler
 * underneath must consult so lifting out of a hold doesn't also toggle
 * play/pause.
 */
export function usePlaybackSpeedGesture({
  enabled,
  scrollGesture,
}: {
  enabled: boolean
  scrollGesture: NativeGesture
}) {
  const haptics = useHaptics()
  const {stickySpeed} = usePlaybackSpeed()
  const {setStickySpeed, setTransientSpeed} = usePlaybackSpeedApi()

  const isHoldingRef = useRef(false)
  const draggedSpeedRef = useRef<number | null>(null)
  const suppressPressRef = useRef(false)

  const gesture = usePanGesture({
    enabled,
    /*
     * The callbacks only touch React state and haptics, so there's nothing to
     * gain from hopping to the UI thread.
     */
    runOnJS: true,
    // Take the touch away from the feed so the drag doesn't also scroll it.
    block: scrollGesture,
    activateAfterLongPress: HOLD_DURATION,
    /*
     * Fail offsets only apply before activation, so a swipe fails this gesture
     * and scrolls the feed as usual, while a drag after the hold has taken hold
     * is free to run the full height of the screen.
     */
    failOffsetX: [-10, 10],
    failOffsetY: [-10, 10],
    // Let the tap area underneath keep handling taps and double taps.
    cancelsTouchesInView: false,
    onBegin: () => {
      /*
       * Clear on touch down rather than when the press is consumed: a hold that
       * ends in a drag cancels the press underneath, so the flag would survive
       * and eat the next real tap.
       */
      suppressPressRef.current = false
    },
    onActivate: () => {
      isHoldingRef.current = true
      suppressPressRef.current = true
      draggedSpeedRef.current = null

      if (stickySpeed !== DEFAULT_PLAYBACK_SPEED) {
        // Holding again is how the user undoes a speed they dragged in earlier.
        setStickySpeed(DEFAULT_PLAYBACK_SPEED)
        setTransientSpeed(null)
        haptics.confirm()
      } else {
        setTransientSpeed(FAST_PLAYBACK_SPEED)
        haptics.longPress()
      }
    },
    onUpdate: evt => {
      if (!isHoldingRef.current) return

      /*
       * Once a direction has been picked it sticks until the finger crosses the
       * threshold the other way - drifting back towards the start shouldn't
       * flick the speed around.
       */
      let speed = draggedSpeedRef.current
      if (evt.translationY <= -DRAG_THRESHOLD) {
        speed = FAST_PLAYBACK_SPEED
      } else if (evt.translationY >= DRAG_THRESHOLD) {
        speed = SLOW_PLAYBACK_SPEED
      }

      if (speed === null || speed === draggedSpeedRef.current) return

      draggedSpeedRef.current = speed
      setTransientSpeed(speed)
      haptics.selection()
    },
    onFinalize: () => {
      // Also fires for touches that never became a hold, e.g. a plain tap.
      if (!isHoldingRef.current) return
      isHoldingRef.current = false

      const draggedSpeed = draggedSpeedRef.current
      draggedSpeedRef.current = null
      if (draggedSpeed !== null) {
        // A drag is a deliberate choice, so it outlives this video.
        setStickySpeed(draggedSpeed)
      }
      setTransientSpeed(null)
    },
  })

  const shouldSuppressPress = () => suppressPressRef.current

  return {gesture, shouldSuppressPress}
}
