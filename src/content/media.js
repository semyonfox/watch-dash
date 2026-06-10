(function registerWatchDashMedia(root) {
  function listVideos() {
    return Array.from(document.querySelectorAll("video"));
  }

  function findActiveVideo() {
    const videos = listVideos();
    if (videos.length === 0) {
      return null;
    }

    return videos.sort((left, right) => scoreVideo(right) - scoreVideo(left))[0];
  }

  function scoreVideo(video) {
    const rect = video.getBoundingClientRect();
    const area = Math.max(0, rect.width) * Math.max(0, rect.height);
    let score = area;

    if (!video.paused) {
      score += 1000000000;
    }

    if (!video.ended) {
      score += 1000000;
    }

    return score;
  }

  function getPlaybackQuality(video) {
    if (!video || typeof video.getVideoPlaybackQuality !== "function") {
      return null;
    }

    const quality = video.getVideoPlaybackQuality();
    return {
      droppedVideoFrames: quality.droppedVideoFrames,
      totalVideoFrames: quality.totalVideoFrames
    };
  }

  root.WatchDashMedia = Object.freeze({
    listVideos,
    findActiveVideo,
    getPlaybackQuality
  });
})(globalThis);
