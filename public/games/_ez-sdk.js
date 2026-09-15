/**
 * EZ-GAMES in-frame SDK.
 *
 * Each game embeds this and reports its lifecycle to the platform shell, which
 * owns auth, progress and analytics. Games stay standalone: if the SDK is
 * loaded outside the shell (opened directly), every call is a harmless no-op.
 *
 *   EZ.ready()                      - the game is loaded and playable
 *   EZ.start()                      - a run has begun (starts the run clock)
 *   EZ.score(n)                     - live score, mirrored into the shell HUD
 *   EZ.over({ score, won, level })  - a run ended; the shell records it
 *   EZ.level(name)                  - a named level/difficulty was cleared
 */
(function () {
  var PARENT = window.parent !== window ? window.parent : null;
  var ORIGIN = window.location.origin;
  var startedAt = 0;
  var live = 0;

  function send(type, payload) {
    if (!PARENT) return;
    try {
      PARENT.postMessage({ source: 'ez-games', type: type, payload: payload || {} }, ORIGIN);
    } catch (e) { /* shell is gone; keep playing */ }
  }

  var EZ = {
    embedded: !!PARENT,

    ready: function (meta) { send('ready', meta || {}); },

    start: function () {
      startedAt = Date.now();
      live = 0;
      send('start', {});
    },

    score: function (n) {
      live = Number(n) || 0;
      send('score', { score: live });
    },

    level: function (name) { send('level', { level: String(name) }); },

    over: function (result) {
      result = result || {};
      var duration = startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0;
      startedAt = 0;
      send('over', {
        score: Number(result.score != null ? result.score : live) || 0,
        won: !!result.won,
        level: result.level || null,
        durationSec: duration,
        detail: result.detail || null,
      });
    },

    /** Ask the shell to close the player and return to the library. */
    exit: function () { send('exit', {}); },
  };

  // Escape always gets the player out, from inside the frame too.
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') EZ.exit();
  });

  // The shell can ask a game to pause itself (player opened the overlay menu).
  window.addEventListener('message', function (e) {
    if (e.origin !== ORIGIN || !e.data || e.data.source !== 'ez-shell') return;
    if (typeof EZ.onShellMessage === 'function') EZ.onShellMessage(e.data.type, e.data.payload);
  });

  window.EZ = EZ;
})();
