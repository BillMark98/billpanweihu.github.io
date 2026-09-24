/* Site behaviour: theme toggle + pan/zoom for inline diagrams. No dependencies. */
(function () {
  'use strict';

  /* ---- theme ---------------------------------------------------------- */
  var root = document.documentElement;

  function systemDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  function currentTheme() {
    return root.getAttribute('data-theme') || (systemDark() ? 'dark' : 'light');
  }

  var toggle = document.querySelector('.theme-toggle');
  if (toggle) {
    toggle.addEventListener('click', function () {
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('theme', next); } catch (e) {}
      // let any listening widget re-measure after the swap
      window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: next } }));
    });
  }

  /* ---- diagram pan / zoom ---------------------------------------------- */
  function initMap(view) {
    var stage = view.querySelector('.mapview-stage');
    if (!stage) return;
    var svgs = stage.querySelectorAll('svg');
    if (!svgs.length) return;

    var vb = svgs[0].getAttribute('viewBox').split(/\s+/).map(Number);
    var natW = vb[2], natH = vb[3];

    var scale = 1, tx = 0, ty = 0, minScale = 0.05, maxScale = 6;

    function apply() {
      var t = 'translate(' + tx.toFixed(2) + 'px,' + ty.toFixed(2) + 'px) scale(' + scale.toFixed(4) + ')';
      for (var i = 0; i < svgs.length; i++) svgs[i].style.transform = t;
      var pct = view.querySelector('.zoom-level');
      if (pct) pct.textContent = Math.round(scale * 100) + '%';
    }

    function fit() {
      var r = stage.getBoundingClientRect();
      // fit to width; tall maps are then scrolled vertically by dragging
      scale = Math.min(r.width / natW, r.height / natH);
      minScale = scale * 0.5;
      tx = (r.width - natW * scale) / 2;
      ty = 0;
      apply();
    }

    function fillWidth() {
      var r = stage.getBoundingClientRect();
      scale = r.width / natW;
      tx = 0; ty = 0;
      apply();
    }

    function zoomAt(cx, cy, factor) {
      var next = Math.max(minScale, Math.min(maxScale, scale * factor));
      if (next === scale) return;
      // keep the point under the cursor fixed
      tx = cx - (cx - tx) * (next / scale);
      ty = cy - (cy - ty) * (next / scale);
      scale = next;
      apply();
    }

    /* drag to pan */
    var dragging = false, lastX = 0, lastY = 0, pid = null;
    stage.addEventListener('pointerdown', function (e) {
      dragging = true; pid = e.pointerId;
      lastX = e.clientX; lastY = e.clientY;
      stage.classList.add('dragging');
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', function (e) {
      if (!dragging || e.pointerId !== pid) return;
      tx += e.clientX - lastX;
      ty += e.clientY - lastY;
      lastX = e.clientX; lastY = e.clientY;
      apply();
    });
    function endDrag(e) {
      if (!dragging) return;
      dragging = false; stage.classList.remove('dragging');
      try { stage.releasePointerCapture(e.pointerId); } catch (err) {}
    }
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);

    /* wheel: ctrl/cmd = zoom, otherwise scroll the map vertically */
    stage.addEventListener('wheel', function (e) {
      var r = stage.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.12 : 1 / 1.12);
      } else {
        e.preventDefault();
        ty -= e.deltaY;
        tx -= e.deltaX;
        apply();
      }
    }, { passive: false });

    /* pinch */
    var pts = {}, startDist = 0, startScale = 1;
    stage.addEventListener('pointerdown', function (e) { pts[e.pointerId] = e; });
    stage.addEventListener('pointermove', function (e) {
      if (!(e.pointerId in pts)) return;
      pts[e.pointerId] = e;
      var ids = Object.keys(pts);
      if (ids.length === 2) {
        dragging = false;
        var a = pts[ids[0]], b = pts[ids[1]];
        var d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (!startDist) { startDist = d; startScale = scale; return; }
        var r = stage.getBoundingClientRect();
        var cx = (a.clientX + b.clientX) / 2 - r.left;
        var cy = (a.clientY + b.clientY) / 2 - r.top;
        var target = Math.max(minScale, Math.min(maxScale, startScale * (d / startDist)));
        tx = cx - (cx - tx) * (target / scale);
        ty = cy - (cy - ty) * (target / scale);
        scale = target;
        apply();
      }
    });
    function dropPt(e) { delete pts[e.pointerId]; if (Object.keys(pts).length < 2) startDist = 0; }
    stage.addEventListener('pointerup', dropPt);
    stage.addEventListener('pointercancel', dropPt);

    /* controls */
    view.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-map]');
      if (!btn) return;
      var r = stage.getBoundingClientRect();
      var act = btn.getAttribute('data-map');
      if (act === 'in') zoomAt(r.width / 2, r.height / 2, 1.25);
      else if (act === 'out') zoomAt(r.width / 2, r.height / 2, 1 / 1.25);
      else if (act === 'fit') fit();
      else if (act === 'width') fillWidth();
      else if (act === 'full') {
        if (!document.fullscreenElement) {
          (view.requestFullscreen ? view.requestFullscreen() : Promise.reject()).then(function () {
            setTimeout(fillWidth, 60);
          }, function () {});
        } else {
          document.exitFullscreen();
        }
      }
    });
    document.addEventListener('fullscreenchange', function () { setTimeout(fillWidth, 60); });

    /* keyboard, once the stage has focus */
    stage.tabIndex = 0;
    stage.addEventListener('keydown', function (e) {
      var step = 60;
      if (e.key === 'ArrowUp') { ty += step; }
      else if (e.key === 'ArrowDown') { ty -= step; }
      else if (e.key === 'ArrowLeft') { tx += step; }
      else if (e.key === 'ArrowRight') { tx -= step; }
      else if (e.key === '+' || e.key === '=') { var r1 = stage.getBoundingClientRect(); zoomAt(r1.width / 2, r1.height / 2, 1.2); }
      else if (e.key === '-') { var r2 = stage.getBoundingClientRect(); zoomAt(r2.width / 2, r2.height / 2, 1 / 1.2); }
      else if (e.key === '0') { fit(); }
      else return;
      e.preventDefault();
      apply();
    });

    var ro = window.ResizeObserver ? new ResizeObserver(function () { apply(); }) : null;
    if (ro) ro.observe(stage);

    fillWidth();
  }

  document.querySelectorAll('.mapview').forEach(initMap);
})();
