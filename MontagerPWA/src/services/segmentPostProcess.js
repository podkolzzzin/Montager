/**
 * Post-process voice segments into a professional "podcast editor" cut list.
 *
 * Each cut: { start, end, speakerId, mode: 'speaker' | 'wide' }
 *
 * Philosophy (how a professional podcast editor works):
 *  1. **Always follow the active speaker** — the person talking gets the frame.
 *  2. **Absorb backchannels** — short interjections ("yeah", "uh-huh", laughter)
 *     under a threshold don't warrant a camera cut; stay on the main speaker.
 *  3. **Hold on the last speaker** during short silences — don't jump to wide
 *     just because there's a 1-second pause between sentences.
 *  4. **Reaction cut delay** — when the speaker truly changes, wait a beat
 *     (~0.3-0.5s) so the viewer sees the listener react before the cut.
 *  5. **Wide shot only for long silence** — only use wide when nobody speaks
 *     for an extended period (e.g. > 4s), like a topic transition.
 *  6. **Avoid rapid ping-pong** — enforce a minimum hold time on each speaker;
 *     if we'd switch back to the same speaker within this hold, just stay on them.
 */

/** @typedef {{ start: number, end: number, speakerId: string }} Segment */
/** @typedef {{ start: number, end: number, speakerId: string|null, mode: 'speaker'|'wide' }} Cut */

export const DEFAULT_OPTIONS = {
  /** Merge gap: consecutive segments of the same speaker with a gap ≤ this are merged (s) */
  mergeGap: 1.5,
  /** Backchannels shorter than this are absorbed into the surrounding speaker (s) */
  backchannelMax: 1.2,
  /** After a cut, hold on the new speaker at least this long before allowing another cut (s) */
  minHoldTime: 2.0,
  /** Reaction delay: shift the cut point forward so viewer sees the listener react (s) */
  reactionDelay: 0.4,
  /** Silence longer than this becomes a wide shot; shorter silence holds on last speaker (s) */
  wideGapThreshold: 4.0,
  /** Optional: insert a wide "breather" every N seconds of continuous speaker cuts (0 = off) */
  breatherInterval: 0,
  /** Duration of the breather wide shot when enabled (s) */
  breatherDuration: 2.5,
}

/**
 * @param {Segment[]} rawSegments
 * @param {number}    totalDuration
 * @param {object}    opts
 * @returns {Cut[]}
 */
export function postProcessSegments(rawSegments, totalDuration, opts = {}) {
  const o = { ...DEFAULT_OPTIONS, ...opts }
  if (!rawSegments || rawSegments.length === 0) return []

  // 1. Sort & merge consecutive same-speaker segments
  const sorted = [...rawSegments].sort((a, b) => a.start - b.start)
  let merged = mergeConsecutive(sorted, o.mergeGap)

  // 2. Absorb backchannels — short interjections get absorbed into the dominant speaker
  merged = absorbBackchannels(merged, o.backchannelMax)

  // 3. Re-merge after backchannel absorption (same speaker segments may now be adjacent)
  merged = mergeConsecutive(merged, o.mergeGap)

  // 4. Build cuts: follow the active speaker, hold through short gaps, wide for long gaps
  let cuts = buildSpeakerFollowCuts(merged, totalDuration, o.wideGapThreshold)

  // 5. Apply reaction delay (shift cut points slightly forward)
  cuts = applyReactionDelay(cuts, o.reactionDelay)

  // 6. Enforce minimum hold time — prevent rapid ping-pong; collapse short bounces
  cuts = enforceMinHold(cuts, o.minHoldTime)

  // 7. Optional: insert "breather" wide shots in long continuous speaker runs
  if (o.breatherInterval > 0) {
    cuts = insertBreathers(cuts, o.breatherInterval, o.breatherDuration)
  }

  // 8. Final merge of adjacent same-speaker/same-mode cuts
  cuts = mergeAdjacentCuts(cuts)

  return cuts
}

/* ── helpers ─────────────────────────────────────────────── */

function mergeConsecutive(segments, gapTolerance) {
  if (segments.length === 0) return []
  const out = [{ ...segments[0] }]
  for (let i = 1; i < segments.length; i++) {
    const prev = out[out.length - 1]
    const cur = segments[i]
    if (cur.speakerId === prev.speakerId && cur.start - prev.end <= gapTolerance) {
      prev.end = Math.max(prev.end, cur.end)
    } else {
      out.push({ ...cur })
    }
  }
  return out
}

/**
 * Absorb backchannels: if a segment is shorter than `maxDur` and is surrounded
 * by (or adjacent to) a different speaker who is the dominant one, reassign it
 * to the surrounding speaker so we don't cut away for a quick "yeah".
 */
function absorbBackchannels(segments, maxDur) {
  if (segments.length < 3) return segments
  const out = [...segments.map(s => ({ ...s }))]

  for (let i = 1; i < out.length - 1; i++) {
    const prev = out[i - 1]
    const cur = out[i]
    const next = out[i + 1]
    const dur = cur.end - cur.start

    // Short segment sandwiched between the same speaker → absorb
    if (dur <= maxDur && prev.speakerId === next.speakerId && cur.speakerId !== prev.speakerId) {
      cur.speakerId = prev.speakerId
    }
  }

  // Also handle short segments at the edges
  if (out.length >= 2) {
    // First segment is very short → absorb into second
    if (out[0].end - out[0].start <= maxDur && out[0].speakerId !== out[1].speakerId) {
      out[0].speakerId = out[1].speakerId
    }
    // Last segment is very short → absorb into previous
    const last = out.length - 1
    if (out[last].end - out[last].start <= maxDur && out[last].speakerId !== out[last - 1].speakerId) {
      out[last].speakerId = out[last - 1].speakerId
    }
  }

  return out
}

/**
 * Build cuts following the active speaker.
 * Gaps shorter than wideGapThreshold → hold on the last speaker.
 * Gaps longer → insert a wide shot.
 */
function buildSpeakerFollowCuts(merged, totalDuration, wideGapThreshold) {
  const cuts = []
  let t = 0

  for (const seg of merged) {
    const gap = seg.start - t
    if (gap > 0.05) {
      if (gap >= wideGapThreshold) {
        // Long silence → wide shot
        cuts.push({ start: t, end: seg.start, speakerId: null, mode: 'wide' })
      } else if (cuts.length > 0) {
        // Short gap → extend the last speaker's cut to bridge it
        cuts[cuts.length - 1].end = seg.start
      } else {
        // Very start of the video with a gap → wide
        cuts.push({ start: t, end: seg.start, speakerId: null, mode: 'wide' })
      }
    }
    cuts.push({ start: seg.start, end: seg.end, speakerId: seg.speakerId, mode: 'speaker' })
    t = seg.end
  }

  // Trailing gap
  if (t < totalDuration - 0.1) {
    const gap = totalDuration - t
    if (gap >= wideGapThreshold) {
      cuts.push({ start: t, end: totalDuration, speakerId: null, mode: 'wide' })
    } else if (cuts.length > 0) {
      cuts[cuts.length - 1].end = totalDuration
    }
  }

  return cuts
}

/**
 * Shift speaker-change cut points forward by reactionDelay so the viewer
 * briefly sees the listener before switching to them.
 */
function applyReactionDelay(cuts, delay) {
  if (delay <= 0 || cuts.length < 2) return cuts
  const out = cuts.map(c => ({ ...c }))

  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1]
    const cur = out[i]
    // Only delay speaker→speaker transitions (not wide transitions)
    if (prev.mode === 'speaker' && cur.mode === 'speaker' && prev.speakerId !== cur.speakerId) {
      const shift = Math.min(delay, (cur.end - cur.start) * 0.3) // don't eat more than 30% of the next cut
      if (shift > 0.05) {
        prev.end += shift
        cur.start += shift
      }
    }
  }

  return out
}

/**
 * Enforce minimum hold time — if a speaker cut is shorter than minHold and
 * is a brief bounce back (same speaker before and after), absorb it into
 * the surrounding speaker to avoid distracting ping-pong.
 */
function enforceMinHold(cuts, minHold) {
  if (cuts.length < 3) return cuts
  let changed = true
  let out = cuts.map(c => ({ ...c }))

  // Iterate until stable (max 5 passes)
  for (let pass = 0; pass < 5 && changed; pass++) {
    changed = false
    const next = []
    for (let i = 0; i < out.length; i++) {
      const cur = out[i]
      const dur = cur.end - cur.start
      if (
        cur.mode === 'speaker' &&
        dur < minHold &&
        i > 0 && i < out.length - 1 &&
        next.length > 0 &&
        next[next.length - 1].mode === 'speaker' &&
        out[i + 1].mode === 'speaker' &&
        next[next.length - 1].speakerId === out[i + 1].speakerId
      ) {
        // Same speaker before and after → absorb this short bounce
        next[next.length - 1].end = cur.end
        changed = true
      } else {
        next.push(cur)
      }
    }
    out = next
  }

  // Final pass: squash any remaining too-short speaker cuts by extending the previous cut
  const final = [out[0]]
  for (let i = 1; i < out.length; i++) {
    const cur = out[i]
    const dur = cur.end - cur.start
    const prev = final[final.length - 1]
    if (cur.mode === 'speaker' && dur < minHold * 0.5 && prev.mode === 'speaker') {
      // Very short — just extend previous speaker
      prev.end = cur.end
    } else {
      final.push(cur)
    }
  }

  return final
}

/**
 * Insert a brief wide "breather" shot every `interval` seconds of continuous
 * speaker-mode content without a natural wide break.
 */
function insertBreathers(cuts, interval, breathDur) {
  if (interval <= 0) return cuts
  const out = []
  let speakerRunStart = null

  for (const c of cuts) {
    if (c.mode === 'wide') {
      speakerRunStart = null
      out.push(c)
      continue
    }
    if (speakerRunStart === null) speakerRunStart = c.start

    const runLength = c.end - speakerRunStart
    if (runLength >= interval && (c.end - c.start) > breathDur + 2) {
      // Insert breather in the middle of this cut
      const mid = c.start + (c.end - c.start) / 2
      const bStart = mid - breathDur / 2
      const bEnd = mid + breathDur / 2
      out.push({ start: c.start, end: bStart, speakerId: c.speakerId, mode: 'speaker' })
      out.push({ start: bStart, end: bEnd, speakerId: null, mode: 'wide' })
      out.push({ start: bEnd, end: c.end, speakerId: c.speakerId, mode: 'speaker' })
      speakerRunStart = bEnd
    } else {
      out.push(c)
    }
  }

  return out
}

function mergeAdjacentCuts(cuts) {
  if (cuts.length === 0) return []
  const out = [{ ...cuts[0] }]
  for (let i = 1; i < cuts.length; i++) {
    const prev = out[out.length - 1]
    const cur = cuts[i]
    if (cur.mode === prev.mode && cur.speakerId === prev.speakerId && Math.abs(cur.start - prev.end) < 0.3) {
      prev.end = cur.end
    } else {
      out.push({ ...cur })
    }
  }
  return out
}
