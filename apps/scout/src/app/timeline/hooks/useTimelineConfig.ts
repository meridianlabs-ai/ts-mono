/**
 * Re-export shared useTimelineConfig hook.
 *
 * Scout consumers import from this path. The implementation lives in
 * @tsmono/inspect-components.
 */

export {
  useTimelineConfig,
  type UseTimelineConfigResult,
} from "@tsmono/inspect-components/transcript";
