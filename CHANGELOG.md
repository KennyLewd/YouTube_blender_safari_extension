# Changelog

## 1.2.8
- Added an outer blend for the regular (non-theater) view: the picture's colors spread past the player and fade into the glow, drawn behind the page content.
- Added a Blend distance slider (0–320 px, default 160) to the popup.

## 1.2.7
- Fixed gray bands on bright videos: the wide-bar backdrop is no longer darkened.
- The mixed fill now applies only to bars at least 15% of the picture; slim side margins keep the plain stretch.

## 1.2.6
- The popup and page can talk through extension storage when Safari loses a message reply.

## 1.2.5
- More reliable popup connection: promise-based replies, top-frame messaging and a direct settings fallback.

## 1.2.4
- The popup always shows the glow and motion settings, grayed out until connected, with the reason when it can't connect.

## 1.2.3
- Added Motion controls to the popup: Smooth motion and strength, Glow frame rate, Sync video with glow, Save energy on still videos.
- Edge blending follows the glow's frame-rate limit.

## 1.2.2
- Edge blending renders only as finely as its blur can show.
- Black-bar scanning backs off from 0.5 s to 4 s once the bars stop changing.

## 1.2.1
- Mixed fill for wide bars (vertical videos, 4:3 in fullscreen).
- Scrolling no longer re-scans the page for videos.

## 1.2.0
- Mac-only build: removed the iPhone/iPad renderer, m.youtube.com support and mobile settings.
