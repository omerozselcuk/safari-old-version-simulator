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
  versionDetail.textContent = item.available === false ? item.reason : item.approximate
    ? `Approximate match: Safari ${item.version} uses WebKit ${item.webkitVersion}. This is not the exact Safari version.`
    : `Direct match: WebKit ${item.webkitVersion}`;
  versionDetail.classList.toggle('warning', item.approximate || item.available === false);
  updateButtons();
}

function updateButtons() {
  const busy = status.phase === 'preparing' || status.phase === 'closing';
  const running = status.phase === 'running';
  launchButton.disabled = busy || running || selectedVersion()?.available === false ||
    (selectedVersion()?.approximate && !approval.checked);
  closeButton.hidden = !running;
  versionSelect.disabled = busy || running;
  urlInput.disabled = busy || running;
  approval.disabled = busy || running;
  launchButton.textContent = status.phase === 'preparing' ? 'Preparing…' : 'Open browser';
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
    option.textContent = `Safari ${item.version}${item.approximate ? ' · approximate' : ''}`;
    if (item.available === false) {
      option.disabled = true;
      option.textContent += ` · requires macOS ${item.minimumMacOS}+`;
    }
    versionSelect.append(option);
  }
  versionSelect.value = initial.settings.safariVersion.replace(/^(\d+\.\d+)\.0$/, '$1');
  urlInput.value = initial.settings.url;
  approval.checked = initial.settings.allowApproximateVersion;
  showStatus(initial.status);
  showVersion();
}).catch(error => showStatus({ phase: 'error', message: error.message }));
