/**
 * Speaker clustering — Agglomerative Hierarchical Clustering (AHC) with
 * cosine distance, plus the existing cosine k-means as fallback.
 *
 * AHC with average linkage is the standard approach for neural speaker
 * embeddings (used by pyannote, NIST SRE benchmarks, etc.).  A distance
 * threshold eliminates the need to sweep over k; the number of speakers
 * emerges naturally.
 *
 * Public API:
 *   clusterEmbeddings(embeddings, { hintK?, threshold? })
 *     → { labels: number[], k: number, method: string }
 */

/* ── Default parameters ───────────────────────────────────── */

const DEFAULT_AHC_THRESHOLD  = 0.35   // cosine distance; good for Wespeaker 256d
const DEFAULT_MIN_K          = 1
const DEFAULT_MAX_K          = 10

/* ── Public API ───────────────────────────────────────────── */

/**
 * Cluster speaker embeddings into speaker groups.
 *
 * @param {Float32Array[]} embeddings – one embedding per segment
 * @param {object}  [opts]
 * @param {number}  [opts.hintK]           – expected speaker count (for k-means fallback)
 * @param {number}  [opts.threshold=0.35]  – AHC merge-stop threshold (cosine distance)
 * @param {number}  [opts.maxK=10]         – upper bound on clusters
 * @returns {{ labels: number[], k: number, method: string }}
 */
export function clusterEmbeddings(embeddings, opts = {}) {
  const n = embeddings.length
  if (n === 0) return { labels: [], k: 0, method: 'none' }
  if (n === 1) return { labels: [0], k: 1, method: 'trivial' }

  const threshold = opts.threshold ?? DEFAULT_AHC_THRESHOLD
  const maxK      = opts.maxK ?? DEFAULT_MAX_K
  const hintK     = opts.hintK || 0

  // Primary: Agglomerative Hierarchical Clustering
  // When hintK is provided (from scene detection), use it as target cluster count.
  // The threshold only acts as a safety bound (never merge very distant clusters).
  const targetK   = hintK > 0 ? hintK : 0
  const safetyThr = hintK > 0 ? 0.8 : threshold  // relaxed when target is known
  const ahcResult = agglomerativeClustering(embeddings, safetyThr, maxK, targetK)

  // If AHC produced a reasonable result (≥1 cluster), use it
  if (ahcResult.k >= DEFAULT_MIN_K && ahcResult.k <= maxK) {
    return { ...ahcResult, method: 'ahc' }
  }

  // Fallback: cosine k-means with silhouette selection
  const kmeansResult = kMeansWithSilhouette(embeddings, hintK || 2, maxK)
  return { ...kmeansResult, method: 'kmeans' }
}

/* ── Agglomerative Hierarchical Clustering ────────────────── */

function agglomerativeClustering(embeddings, threshold, maxK, targetK = 0) {
  const n = embeddings.length

  // 1. Build full cosine distance matrix (upper triangular)
  const dist = new Float32Array(n * n)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = cosineDist(embeddings[i], embeddings[j])
      dist[i * n + j] = d
      dist[j * n + i] = d
    }
  }

  // 2. Initialise each point as its own cluster
  // clusterMembers[c] = array of original point indices
  const clusterMembers = embeddings.map((_, i) => [i])
  const active = new Set(Array.from({ length: n }, (_, i) => i))

  // Average-linkage distance between two clusters
  function linkageDist(ci, cj) {
    let sum = 0, count = 0
    for (const a of clusterMembers[ci]) {
      for (const b of clusterMembers[cj]) {
        sum += dist[a * n + b]
        count++
      }
    }
    return sum / count
  }

  // 3. Merge until we reach targetK, or threshold is exceeded
  while (active.size > 1) {
    // If we have a target and we've reached it, stop
    if (targetK > 0 && active.size <= targetK) break

    // Find closest pair
    let bestI = -1, bestJ = -1, bestD = Infinity
    const ids = [...active]
    for (let a = 0; a < ids.length; a++) {
      for (let b = a + 1; b < ids.length; b++) {
        const d = linkageDist(ids[a], ids[b])
        if (d < bestD) {
          bestD = d
          bestI = ids[a]
          bestJ = ids[b]
        }
      }
    }

    // Stop if the closest pair is above threshold
    if (bestD > threshold) break

    // Merge bestJ into bestI
    clusterMembers[bestI] = clusterMembers[bestI].concat(clusterMembers[bestJ])
    clusterMembers[bestJ] = []
    active.delete(bestJ)
  }

  // 4. Assign labels
  const labels = new Array(n)
  let labelIdx = 0
  for (const ci of active) {
    for (const pt of clusterMembers[ci]) {
      labels[pt] = labelIdx
    }
    labelIdx++
  }

  return { labels, k: active.size }
}

/* ── Cosine K-means with silhouette (fallback) ───────────── */

function kMeansWithSilhouette(embeddings, hintK, maxK) {
  const n = embeddings.length
  const upperK = Math.min(hintK, n, maxK)

  let bestLabels = null
  let bestScore = -Infinity
  let bestK = 1

  for (let k = 2; k <= upperK; k++) {
    const labels = multiRunKMeans(embeddings, k, 8, 50)
    const score = silhouetteScore(embeddings, labels, k)
    if (score > bestScore) {
      bestScore = score
      bestLabels = labels
      bestK = k
    }
  }

  if (bestScore < 0.05 || !bestLabels) {
    return { labels: new Array(n).fill(0), k: 1 }
  }

  return { labels: bestLabels, k: bestK }
}

/* ── Multi-run cosine K-means ────────────────────────────── */

function multiRunKMeans(vectors, k, runs, maxIter) {
  let bestLabels = null
  let bestInertia = Infinity

  for (let r = 0; r < runs; r++) {
    const { labels, inertia } = cosineKMeans(vectors, k, maxIter)
    if (inertia < bestInertia) {
      bestInertia = inertia
      bestLabels = labels
    }
  }
  return bestLabels
}

function cosineKMeans(vectors, k, maxIter = 50) {
  const n = vectors.length
  const dim = vectors[0].length

  // Normalise to unit sphere
  const normed = vectors.map(v => {
    const len = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1
    return v.map(x => x / len)
  })

  // K-means++ init
  const centroids = [Array.from(normed[Math.floor(Math.random() * n)])]
  for (let c = 1; c < k; c++) {
    const dists = normed.map(v => Math.min(...centroids.map(cen => cosineDist(v, cen))))
    const total = dists.reduce((a, b) => a + b, 0)
    let r = Math.random() * total
    let picked = false
    for (let i = 0; i < n; i++) {
      r -= dists[i]
      if (r <= 0) { centroids.push(Array.from(normed[i])); picked = true; break }
    }
    if (!picked) centroids.push(Array.from(normed[Math.floor(Math.random() * n)]))
  }

  const labels = new Array(n).fill(0)

  for (let iter = 0; iter < maxIter; iter++) {
    let changed = false
    for (let i = 0; i < n; i++) {
      let best = 0, bestD = Infinity
      for (let c = 0; c < k; c++) {
        const d = cosineDist(normed[i], centroids[c])
        if (d < bestD) { bestD = d; best = c }
      }
      if (labels[i] !== best) changed = true
      labels[i] = best
    }
    if (!changed) break

    for (let c = 0; c < k; c++) {
      const newCen = new Array(dim).fill(0)
      let cnt = 0
      for (let i = 0; i < n; i++) {
        if (labels[i] === c) {
          for (let d = 0; d < dim; d++) newCen[d] += normed[i][d]
          cnt++
        }
      }
      if (cnt > 0) {
        const len = Math.sqrt(newCen.reduce((s, x) => s + x * x, 0)) || 1
        for (let d = 0; d < dim; d++) centroids[c][d] = newCen[d] / len
      }
    }
  }

  let inertia = 0
  for (let i = 0; i < n; i++) {
    inertia += cosineDist(normed[i], centroids[labels[i]])
  }
  return { labels, inertia }
}

/* ── Silhouette score ────────────────────────────────────── */

function silhouetteScore(vectors, labels, k) {
  const n = vectors.length
  if (n < 2 || k < 2) return -1

  const sizes = new Array(k).fill(0)
  for (let i = 0; i < n; i++) sizes[labels[i]]++
  if (sizes.some(s => s === 0)) return -1

  let total = 0
  for (let i = 0; i < n; i++) {
    const myC = labels[i]
    let aSum = 0, aCnt = 0
    for (let j = 0; j < n; j++) {
      if (j !== i && labels[j] === myC) {
        aSum += cosineDist(vectors[i], vectors[j])
        aCnt++
      }
    }
    const a = aCnt > 0 ? aSum / aCnt : 0

    let b = Infinity
    for (let c = 0; c < k; c++) {
      if (c === myC) continue
      let bSum = 0, bCnt = 0
      for (let j = 0; j < n; j++) {
        if (labels[j] === c) {
          bSum += cosineDist(vectors[i], vectors[j])
          bCnt++
        }
      }
      if (bCnt > 0) b = Math.min(b, bSum / bCnt)
    }

    total += b === Infinity ? 0 : (b - a) / Math.max(a, b)
  }

  return total / n
}

/* ── Cosine distance ──────────────────────────────────────── */

function cosineDist(a, b) {
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na  += a[i] * a[i]
    nb  += b[i] * b[i]
  }
  return 1 - dot / (Math.sqrt(na) * Math.sqrt(nb) || 1)
}
