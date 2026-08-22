(function registerWatchDashMedia(root) {
  const playingScoreBonus = 1000000000;
  const unmutedScoreBonus = 400000000;
  const endedScoreBonus = 1000000;
  const detachedScorePenalty = 2000000000;
  const visibleScoreBonus = 250000;

  function listVideos() {
    try {
      return Array.from(document.querySelectorAll("video"));
    } catch (error) {
      return [];
    }
  }

  function findActiveVideo() {
    const videos = listVideos();
    if (videos.length === 0) {
      return null;
    }

    let activeVideo = videos[0];
    let activeScore = scoreVideo(activeVideo);

    for (let index = 1; index < videos.length; index += 1) {
      const candidate = videos[index];
      const candidateScore = scoreVideo(candidate);
      if (candidateScore > activeScore) {
        activeVideo = candidate;
        activeScore = candidateScore;
      }
    }

    return activeVideo;
  }

  function scoreVideo(video) {
    let area = 0;
    try {
      const rect = video.getBoundingClientRect();
      area = Math.max(0, rect.width) * Math.max(0, rect.height);
    } catch (error) {
      area = 0;
    }

    let score = area;

    if (!video.paused) {
      score += playingScoreBonus;
    }

    // autoplaying previews are almost always muted, main content usually is not
    if (!video.muted) {
      score += unmutedScoreBonus;
    }

    if (!video.ended) {
      score += endedScoreBonus;
    }

    // detached elements are leftovers from dom churn, never the active player
    if (video.isConnected === false) {
      score -= detachedScorePenalty;
    }

    if (isInViewport(video)) {
      score += visibleScoreBonus;
    }

    return score;
  }

  function isInViewport(video) {
    const viewWidth = Number(root.innerWidth);
    const viewHeight = Number(root.innerHeight);

    if (
      !Number.isFinite(viewWidth) ||
      !Number.isFinite(viewHeight) ||
      viewWidth <= 0 ||
      viewHeight <= 0
    ) {
      return false;
    }

    try {
      const rect = video.getBoundingClientRect();
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        rect.right > 0 &&
        rect.bottom > 0 &&
        rect.left < viewWidth &&
        rect.top < viewHeight
      );
    } catch (error) {
      return false;
    }
  }

  function isUsableVideo(video) {
    return Boolean(video) && video.isConnected !== false;
  }

  function getPlaybackQuality(video) {
    if (!video) {
      return null;
    }

    if (typeof video.getVideoPlaybackQuality === "function") {
      try {
        const quality = video.getVideoPlaybackQuality();
        return {
          droppedVideoFrames: finiteCountOrNull(
            quality && quality.droppedVideoFrames,
          ),
          totalVideoFrames: finiteCountOrNull(
            quality && quality.totalVideoFrames,
          ),
        };
      } catch (error) {
        // some pages patch dom apis, fall through to element counters
      }
    }

    // some engines only expose frame counters on the element itself
    const droppedFrames = finiteCountOrNull(video.webkitDroppedFrameCount);
    if (droppedFrames === null) {
      return null;
    }

    return {
      droppedVideoFrames: droppedFrames,
      totalVideoFrames: finiteCountOrNull(video.webkitDecodedFrameCount),
    };
  }

  function finiteCountOrNull(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
  }

  root.WatchDashMedia = Object.freeze({
    listVideos,
    findActiveVideo,
    isUsableVideo,
    getPlaybackQuality,
  });
})(globalThis);
