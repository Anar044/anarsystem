/* QR Menu safety fixes
   Keeps the existing iiko/OLAP logic untouched.
   Guarantees that the Design button opens the existing modal even if
   another optional UI handler throws an error during page initialization.
*/
(function () {
  function initQrMenuFix() {
    const btn = document.getElementById('designBtn');
    const modal = document.getElementById('settingsModal');
    const close = document.getElementById('closeSettings');

    if (!btn || !modal) return;

    btn.onclick = function (event) {
      event.preventDefault();
      event.stopPropagation();

      try {
        if (typeof window.fillDesignForm === 'function') {
          window.fillDesignForm();
        }
      } catch (error) {
        console.error('QR Menu design form error:', error);
      }

      modal.classList.add('show');
      modal.style.display = 'flex';
    };

    if (close) {
      close.onclick = function (event) {
        event.preventDefault();
        event.stopPropagation();
        modal.classList.remove('show');
        modal.style.display = '';
      };
    }

    modal.onclick = function (event) {
      if (event.target === modal) {
        modal.classList.remove('show');
        modal.style.display = '';
      }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initQrMenuFix, { once: true });
  } else {
    initQrMenuFix();
  }
})();
