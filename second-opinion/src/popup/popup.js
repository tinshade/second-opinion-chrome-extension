const $ = (id) => document.getElementById(id);

chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }).then((s) => {
  $('who').textContent = s.hasKey
    ? `${s.label} · ${s.model}`
    : `${s.label} has no key yet — add one to start.`;
  $('who').className = `status ${s.hasKey ? 'ok' : 'bad'}`;
});

$('open').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/amazon\./.test(tab.url || '')) {
    $('who').textContent = 'Open an Amazon product page first.';
    $('who').className = 'status bad';
    return;
  }
  await chrome.tabs.sendMessage(tab.id, { type: 'TOGGLE_PANEL' }).catch(() => {});
  window.close();
});

$('settings').addEventListener('click', () => chrome.runtime.openOptionsPage());
