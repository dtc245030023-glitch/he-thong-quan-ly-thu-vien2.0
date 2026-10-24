'use strict';

// Ask before destructive actions. Messages are provided by server templates.
document.querySelectorAll('form[data-confirm]').forEach((form) => {
  form.addEventListener('submit', (event) => {
    const message = form.getAttribute('data-confirm') || 'Bạn có chắc chắn muốn thực hiện thao tác này?';
    if (!window.confirm(message)) {
      event.preventDefault();
    }
  });
});

// Dismiss success/error banners without leaving the page.
document.querySelectorAll('[data-dismiss-alert]').forEach((button) => {
  button.addEventListener('click', () => {
    const alert = button.closest('.alert');
    if (alert) alert.remove();
  });
});

// Prevent accidental double submissions while still allowing normal submit.
document.querySelectorAll('form[data-single-submit]').forEach((form) => {
  form.addEventListener('submit', () => {
    const button = form.querySelector('button[type="submit"]');
    if (!button) return;
    window.setTimeout(() => {
      button.disabled = true;
      button.classList.add('is-loading');
    }, 0);
  });
});
