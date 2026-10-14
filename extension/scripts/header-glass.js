// Keep the transparent masthead independent of the glow's visibility / scroll state.
let enabled = true;
let glass = true;
const update = () => document.documentElement.classList.toggle(
  'safari-ambient-glass-header', enabled && glass && location.pathname === '/watch'
);
const apply = values => {
  if ('setting-enabled' in values) enabled = values['setting-enabled'] !== false;
  if ('safari-header-glass' in values) glass = values['safari-header-glass'] !== false;
  update();
};
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  apply(Object.fromEntries(Object.entries(changes).map(([key, value]) => [key, value.newValue])));
});
let changedDuringLoad = false;
const markChanged = () => { changedDuringLoad = true; };
chrome.storage.onChanged.addListener(markChanged);
const stored = await chrome.storage.local.get(['setting-enabled', 'safari-header-glass']);
chrome.storage.onChanged.removeListener(markChanged);
if (!changedDuringLoad) apply(stored);
else apply(await chrome.storage.local.get(['setting-enabled', 'safari-header-glass']));
document.addEventListener('yt-navigate-finish', update);
window.addEventListener('popstate', update);
