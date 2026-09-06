// DubAI — hook inyectado en el contexto de la página de YouTube (acceso a ytInitialPlayerResponse)
(function () {
  'use strict';
  if (window.__DUBAI_YOUTUBE_HOOK__) return;
  window.__DUBAI_YOUTUBE_HOOK__ = true;

  function getPlayer() {
    return document.getElementById('movie_player') || document.querySelector('.html5-video-player');
  }

  function getResponse(player) {
    try {
      if (player && typeof player.getPlayerResponse === 'function') {
        var current = player.getPlayerResponse();
        if (current) return current;
      }
    } catch (e) {}

    if (window.ytInitialPlayerResponse) return window.ytInitialPlayerResponse;

    try {
      var raw = window.ytplayer && window.ytplayer.config && window.ytplayer.config.args.player_response;
      return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch (e) {
      return null;
    }
  }

  function extract() {
    try {
      var player = getPlayer();
      var pr = getResponse(player);
      var tracks =
        pr &&
        pr.captions &&
        pr.captions.playerCaptionsTracklistRenderer &&
        pr.captions.playerCaptionsTracklistRenderer.captionTracks;

      // En algunas versiones de YouTube las pistas solo están en el estado
      // interno del reproductor, no en ytInitialPlayerResponse.
      if ((!tracks || !tracks.length) && player && typeof player.getOption === 'function') {
        try {
          var tracklist = player.getOption('captions', 'tracklist');
          tracks = tracklist && (tracklist.captionTracks || tracklist);
        } catch (e) {}
        try {
          if (!tracks || !tracks.length) {
            var activeTrack = player.getOption('captions', 'track');
            if (activeTrack && activeTrack.baseUrl) tracks = [activeTrack];
          }
        } catch (e) {}
      }

      var currentVideoId = pr && pr.videoDetails && pr.videoDetails.videoId;
      if (!currentVideoId && player && typeof player.getVideoData === 'function') {
        try {
          var data = player.getVideoData();
          currentVideoId = data && (data.video_id || data.videoId);
        } catch (e) {}
      }

      window.postMessage(
        {
          source: 'DUBAI_HOOK',
          type: 'CAPTION_TRACKS',
          videoId: currentVideoId || null,
          tracks: tracks || []
        },
        '*'
      );
    } catch (e) {
      /* silencioso */
    }
  }

  // Responde a peticiones del content script
  window.addEventListener('message', function (ev) {
    if (ev.source === window && ev.data && ev.data.source === 'DUBAI_CONTENT' && ev.data.type === 'REQUEST_TRACKS') {
      extract();
    }
  });

  // YouTube es SPA: reenviar tracks en cada navegación
  window.addEventListener('yt-navigate-finish', function () {
    setTimeout(extract, 600);
  });
})();
