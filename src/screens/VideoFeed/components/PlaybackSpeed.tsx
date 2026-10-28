import {createContext, useContext, useEffect, useRef, useState} from 'react'
import {type NativeGesture, usePanGesture} from 'react-native-gesture-handler'
import Animated, {
  FadeIn,
  FadeOut,
  useSharedValue,
} from 'react-native-reanimated'
import {useSafeAreaInsets} from 'react-native-safe-area-context'
import {scheduleOnRN} from 'react-native-worklets'
import {useEventListener} from 'expo'
import {type VideoPlayer} from 'expo-video'
import {useLingui} from '@lingui/react/macro'

import {useHaptics} from '#/lib/haptics'
import {useNonReactiveCallback} from '#/lib/hooks/useNonReactiveCallback'
import {logger} from '#/logger'
import {atoms as a, tokens} from '#/alf'
import {Text} from '#/components/Typography'

const DEFAULT_PLAYBACK_SPEED = 1
const FAST_PLAYBACK_SPEED = 2
const SLOW_PLAYBACK_SPEED = 0.5
const HOLD_DELAY_MS = 500
/**
 * How far the finger has to travel up or down while holding before the speed
 * switches to fast or slow.
 */
const DRAG_THRESHOLD = 40
/**
 * Matches the native min height of `Layout.Header.Outer`, so the badge sits
 * just below the back button.
 */
const HEADER_HEIGHT = 48

const Context = createContext<{
  /**
   * Speed chosen by holding and dragging, applied to every video in the feed.
   */
  speed: number
  setSpeed: (speed: number) => void
}>({
  speed: DEFAULT_PLAYBACK_SPEED,
  setSpeed: () => {},
})
Context.displayName = 'VideoFeedPlaybackSpeedContext'

export function PlaybackSpeedProvider({children}: {children: React.ReactNode}) {
  const [speed, setSpeed] = useState(DEFAULT_PLAYBACK_SPEED)
  return <Context value={{speed, setSpeed}}>{children}</Context>
}

/**
 * Press-and-hold speed controls for the active video:
 *
 * - Holding plays the current video at 2x until release.
 * - Holding and dragging up or down sets 2x or 0.5x for every video in the
 *   feed, and it sticks after release.
 * - Holding again while a feed-wide speed is set resets it to 1x.
 */
export function usePlaybackSpeed({
  player,
  active,
  scrollGesture,
}: {
  player: VideoPlayer
  active: boolean
  scrollGesture: NativeGesture
}) {
  const haptics = useHaptics()
  const {speed: feedSpeed, setSpeed: setFeedSpeed} = useContext(Context)
  /** Speed while the finger is down, or null when not holding. */
  const [holdSpeed, setHoldSpeed] = useState<number | null>(null)
  const didHoldRef = useRef(false)
  /** Last speed picked by dragging during the current hold, 0 if none. */
  const dragSpeedSV = useSharedValue(0)

  // the gesture is cancelled when the video goes inactive, but be defensive
  if (!active && holdSpeed !== null) {
    setHoldSpeed(null)
  }

  const speed = holdSpeed ?? feedSpeed

  /*
   * On iOS, setting the rate of a paused player starts playback, and the
   * players are pooled and shared between items. So only touch the rate of the
   * active player once it's actually playing.
   */
  const syncPlaybackRate = useNonReactiveCallback(() => {
    if (!active) return
    try {
      if (player.playing && player.playbackRate !== speed) {
        player.playbackRate = speed
      }
    } catch (err) {
      logger.error('Could not set video playback speed', {safeMessage: err})
    }
  })

  useEffect(() => {
    syncPlaybackRate()
  }, [active, player, speed, syncPlaybackRate])

  useEventListener(player, 'playingChange', ({isPlaying}) => {
    if (isPlaying) syncPlaybackRate()
  })

  const onHoldStart = () => {
    didHoldRef.current = true
    haptics.longPress()
    if (feedSpeed !== DEFAULT_PLAYBACK_SPEED) {
      setFeedSpeed(DEFAULT_PLAYBACK_SPEED)
      setHoldSpeed(DEFAULT_PLAYBACK_SPEED)
    } else {
      setHoldSpeed(FAST_PLAYBACK_SPEED)
    }
  }

  const onDragSpeed = (newSpeed: number) => {
    haptics.selection()
    setFeedSpeed(newSpeed)
    setHoldSpeed(newSpeed)
  }

  const onHoldEnd = () => {
    setHoldSpeed(null)
  }

  const gesture = usePanGesture({
    enabled: active,
    block: scrollGesture,
    activateAfterLongPress: HOLD_DELAY_MS,
    onActivate: () => {
      'worklet'
      dragSpeedSV.set(0)
      scheduleOnRN(onHoldStart)
    },
    onUpdate: evt => {
      'worklet'
      const newSpeed =
        evt.translationY <= -DRAG_THRESHOLD
          ? FAST_PLAYBACK_SPEED
          : evt.translationY >= DRAG_THRESHOLD
            ? SLOW_PLAYBACK_SPEED
            : 0
      if (newSpeed !== 0 && newSpeed !== dragSpeedSV.get()) {
        dragSpeedSV.set(newSpeed)
        scheduleOnRN(onDragSpeed, newSpeed)
      }
    },
    onDeactivate: () => {
      'worklet'
      scheduleOnRN(onHoldEnd)
    },
  })

  return {
    gesture,
    speed,
    showBadge:
      active && (holdSpeed !== null || feedSpeed !== DEFAULT_PLAYBACK_SPEED),
    /**
     * Call from `onPressIn`, then check `didHold()` in `onPress` so releasing
     * a hold doesn't also count as a tap.
     */
    resetHold: () => {
      didHoldRef.current = false
    },
    didHold: () => didHoldRef.current,
  }
}

export function PlaybackSpeedBadge({speed}: {speed: number}) {
  const {t: l, i18n} = useLingui()
  const {top} = useSafeAreaInsets()
  const speedLabel = i18n.number(speed)

  return (
    <Animated.View
      entering={FadeIn.duration(150)}
      exiting={FadeOut.duration(150)}
      accessibilityLiveRegion="polite"
      style={[
        a.absolute,
        a.z_20,
        a.pointer_events_none,
        a.px_sm,
        a.py_xs,
        a.rounded_full,
        {
          top: top + HEADER_HEIGHT + tokens.space.sm,
          left: tokens.space.lg,
          backgroundColor: 'rgba(0, 0, 0, 0.6)',
        },
      ]}>
      <Text style={[a.text_sm, a.font_bold, {fontVariant: ['tabular-nums']}]}>
        {l({
          message: `${speedLabel}×`,
          comment: 'Video playback speed badge, e.g. “2×” or “0.5×”',
        })}
      </Text>
    </Animated.View>
  )
}
