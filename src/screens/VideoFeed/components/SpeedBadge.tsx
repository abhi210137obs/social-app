import Animated, {FadeIn, FadeOut} from 'react-native-reanimated'
import {useSafeAreaInsets} from 'react-native-safe-area-context'
import {useLingui} from '@lingui/react/macro'

import {
  DEFAULT_PLAYBACK_SPEED,
  usePlaybackSpeed,
} from '#/screens/VideoFeed/state/playbackSpeed'
import {atoms as a} from '#/alf'
import {Text} from '#/components/Typography'

// Clears the header, which the feed renders at the top inset.
const HEADER_HEIGHT = 48

/**
 * Shows the current playback speed over the top left of the video, and only
 * while that speed differs from the default.
 */
export function SpeedBadge() {
  const {t: l, i18n} = useLingui()
  const {top} = useSafeAreaInsets()
  const {activeSpeed} = usePlaybackSpeed()

  if (activeSpeed === DEFAULT_PLAYBACK_SPEED) return null

  const speed = i18n.number(activeSpeed, {maximumFractionDigits: 2})

  return (
    <Animated.View
      entering={FadeIn.duration(120)}
      exiting={FadeOut.duration(120)}
      accessibilityLiveRegion="polite"
      aria-label={l`Playing at ${speed} times speed`}
      pointerEvents="none"
      style={[
        a.absolute,
        a.z_30,
        a.px_sm,
        a.py_xs,
        a.rounded_full,
        {
          top: top + HEADER_HEIGHT,
          left: a.px_md.paddingLeft,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
        },
      ]}>
      <Text style={[a.text_sm, a.font_bold, {fontVariant: ['tabular-nums']}]}>
        {l`${speed}x`}
      </Text>
    </Animated.View>
  )
}
