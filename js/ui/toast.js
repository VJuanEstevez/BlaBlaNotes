const toastEl = document.getElementById('toast');
let hideTimer = null;

export function showToast(message, type = 'default') {
  clearTimeout(hideTimer);
  toastEl.textContent = message;
  toastEl.className = 'toast toast--visible';
  if (type === 'error') toastEl.classList.add('toast--error');
  if (type === 'success') toastEl.classList.add('toast--success');

  hideTimer = setTimeout(() => {
    toastEl.classList.remove('toast--visible');
  }, 2600);
}
