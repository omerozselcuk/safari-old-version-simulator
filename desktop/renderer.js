const versionSelect = document.querySelector('#version');
const versionDetail = document.querySelector('#version-detail');
const approximation = document.querySelector('#approximation');
const approval = document.querySelector('#allow-approximation');
const urlInput = document.querySelector('#url');
const launchButton = document.querySelector('#launch');
const closeButton = document.querySelector('#close');
const statusText = document.querySelector('#status-text');
const statusDot = document.querySelector('#status-dot');

let versions = [];
let status = { phase: 'idle' };

function selectedVersion() {
  return versions.find(item => item.version === versionSelect.value);
}

function showVersion() {
  const item = selectedVersion();
  if (!item) return;
  approximation.hidden = !item.approximate;
  versionDetail.textContent = item.approximate
    ? `Yaklaşık eşleşme: Safari ${item.version} için WebKit ${item.webkitVersion} kullanılır. Birebir Safari sürümü değildir.`
    : `Doğrudan eşleşme: WebKit ${item.webkitVersion}`;
  versionDetail.classList.toggle('warning', item.approximate);
  updateButtons();
}

function updateButtons() {
  const busy = status.phase === 'preparing' || status.phase === 'closing';
  const running = status.phase === 'running';
  launchButton.disabled = busy || running ||
    (selectedVersion()?.approximate && !approval.checked);
  closeButton.hidden = !running;
  versionSelect.disabled = busy || running;
  urlInput.disabled = busy || running;
  approval.disabled = busy || running;
  launchButton.textContent = status.phase === 'preparing' ? 'Hazırlanıyor…' : 'Tarayıcıyı aç';
}

function showStatus(next) {
  status = next;
  statusText.textContent = next.message;
  statusDot.dataset.phase = next.phase;
  updateButtons();
}

versionSelect.addEventListener('change', () => {
  approval.checked = false;
  showVersion();
});
approval.addEventListener('change', updateButtons);

launchButton.addEventListener('click', async () => {
  const request = {
    safariVersion: versionSelect.value,
    url: urlInput.value,
    allowApproximateVersion: approval.checked,
  };
  try {
    await window.safariSimulator.launchBrowser(request);
  } catch (error) {
    showStatus({ phase: 'error', message: error.message });
  }
});

closeButton.addEventListener('click', async () => {
  try {
    await window.safariSimulator.closeBrowser();
  } catch (error) {
    showStatus({ phase: 'error', message: error.message });
  }
});

window.safariSimulator.onStatus(showStatus);
window.safariSimulator.getState().then(initial => {
  versions = initial.versions;
  for (const item of versions) {
    const option = document.createElement('option');
    option.value = item.version;
    option.textContent = `Safari ${item.version}${item.approximate ? ' · yaklaşık' : ''}`;
    versionSelect.append(option);
  }
  versionSelect.value = initial.settings.safariVersion;
  urlInput.value = initial.settings.url;
  approval.checked = initial.settings.allowApproximateVersion;
  showStatus(initial.status);
  showVersion();
}).catch(error => showStatus({ phase: 'error', message: error.message }));
