(function () {
  'use strict';

  // ──────────────────────────────────────────────
  // SigmaSurvey — Embeddable NPS Survey Widget
  // ──────────────────────────────────────────────

  const DEFAULTS = {
    apiBase: '', // Set by init(), e.g. https://surveys.idassist.com
    delaySeconds: 5,
    minVisits: 2,
    frequencyDays: 30,
  };

  let config = {};    // product config fetched from Worker
  let options = {};   // merged init options + defaults
  let currentStep = 0;
  let answers = { nps: null, comment: '', visitReason: null, valuedFeature: null };
  let widgetEl = null;
  let cardEl = null;
  let minimizedEl = null;

  // ── localStorage helpers ──

  const STORAGE_PREFIX = 'sigma_survey_';

  function storageKey(suffix) {
    return STORAGE_PREFIX + options.product + '_' + suffix;
  }

  function getVisitCount() {
    return parseInt(localStorage.getItem(storageKey('visits')) || '0', 10);
  }

  function incrementVisitCount() {
    const key = storageKey('visits');
    const sessionKey = storageKey('session');
    // Only increment once per browser session
    if (sessionStorage.getItem(sessionKey)) return;
    sessionStorage.setItem(sessionKey, '1');
    localStorage.setItem(key, String(getVisitCount() + 1));
  }

  function getLastCompleted() {
    const val = localStorage.getItem(storageKey('last_completed'));
    return val ? parseInt(val, 10) : 0;
  }

  function setLastCompleted() {
    localStorage.setItem(storageKey('last_completed'), String(Date.now()));
  }

  function daysSinceLastCompleted() {
    const last = getLastCompleted();
    if (!last) return Infinity;
    return (Date.now() - last) / (1000 * 60 * 60 * 24);
  }

  function shouldShowSurvey() {
    const visits = getVisitCount();
    const daysSince = daysSinceLastCompleted();
    return visits >= options.minVisits && daysSince >= options.frequencyDays;
  }

  // ── Styles (injected once) ──

  function injectStyles() {
    if (document.getElementById('sigma-survey-styles')) return;
    const style = document.createElement('style');
    style.id = 'sigma-survey-styles';
    style.textContent = `
      .ss-widget { position: fixed; bottom: 0; right: 0; z-index: 99999; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }

      .ss-card {
        position: fixed; bottom: 16px; right: 16px;
        background: #fff; border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08);
        overflow: hidden; z-index: 99999;
        transition: width 0.35s ease, opacity 0.4s ease, transform 0.4s ease;
        opacity: 0; transform: translateY(20px);
      }
      .ss-card.ss-visible { opacity: 1; transform: translateY(0); }
      .ss-card.ss-hidden { display: none; }

      .ss-progress-track { height: 5px; background: #e0e0e0; }
      .ss-progress-fill { height: 100%; border-radius: 0 3px 3px 0; transition: width 0.35s ease; }

      .ss-header { display: flex; justify-content: flex-end; padding: 8px 12px 0; }
      .ss-close {
        background: none; border: none; font-size: 22px; color: #6b6b6b;
        cursor: pointer; padding: 4px 8px; line-height: 1; border-radius: 4px;
      }
      .ss-close:hover { background: #f0f0f0; }

      .ss-body { padding: 4px 24px 24px; }
      .ss-question { font-size: 16px; font-weight: 500; line-height: 1.4; margin-bottom: 12px; color: #1a1a1a; }
      .ss-required { font-size: 13px; color: #c4421a; margin-bottom: 12px; }

      .ss-nps-row { display: flex; gap: 5px; margin-bottom: 8px; }
      .ss-nps-btn {
        flex: 1; height: 44px; border: none; background: #f0f0f0; border-radius: 6px;
        font: 500 15px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        color: #1a1a1a; cursor: pointer; transition: background 0.15s;
      }
      .ss-nps-btn:hover { background: #e4e4e4; }
      .ss-nps-btn.ss-selected { color: #fff; box-shadow: 0 2px 6px rgba(0,0,0,0.15); }
      .ss-nps-labels { display: flex; justify-content: space-between; font-size: 12px; color: #6b6b6b; margin-top: 4px; }

      .ss-options { display: flex; flex-direction: column; gap: 6px; }
      .ss-option {
        display: flex; align-items: center; gap: 12px; padding: 12px 16px;
        background: #f0f0f0; border-radius: 8px; cursor: pointer; font-size: 14px;
        border: 2px solid transparent; transition: background 0.15s, border-color 0.15s;
      }
      .ss-option:hover { background: #e4e4e4; }
      .ss-option.ss-selected { background: #e4e4e4; }
      .ss-radio {
        width: 20px; height: 20px; border-radius: 50%; border: 2px solid #e0e0e0;
        flex-shrink: 0; display: flex; align-items: center; justify-content: center;
      }
      .ss-radio-dot {
        width: 10px; height: 10px; border-radius: 50%;
        transform: scale(0); transition: transform 0.15s;
      }
      .ss-option.ss-selected .ss-radio-dot { transform: scale(1); }

      .ss-textarea {
        width: 100%; min-height: 100px; border: 1px solid #e0e0e0; border-radius: 8px;
        padding: 12px; font: 400 14px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        color: #1a1a1a; background: #fff; resize: vertical; outline: none;
      }
      .ss-textarea:focus { border-color: #999; }
      .ss-textarea::placeholder { color: #6b6b6b; }

      .ss-nav { display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; }
      .ss-btn {
        padding: 10px 20px; border-radius: 8px; font: 500 14px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        cursor: pointer; border: none; transition: opacity 0.15s;
      }
      .ss-btn-primary { color: #fff; }
      .ss-btn-primary:hover { filter: brightness(1.08); }
      .ss-btn-primary:disabled { opacity: 0.4; cursor: not-allowed; filter: none; }
      .ss-btn-secondary { background: #f0f0f0; color: #1a1a1a; }
      .ss-btn-secondary:hover { background: #e4e4e4; }

      .ss-thankyou { text-align: center; padding: 24px 0 8px; }
      .ss-thankyou-icon {
        width: 48px; height: 48px; border-radius: 50%;
        display: flex; align-items: center; justify-content: center; margin: 0 auto 16px;
      }
      .ss-thankyou h3 { font-size: 18px; font-weight: 500; margin-bottom: 8px; color: #1a1a1a; }
      .ss-thankyou p { font-size: 14px; color: #6b6b6b; line-height: 1.5; }

      .ss-minimized {
        position: fixed; bottom: 16px; right: 16px;
        color: #fff; border: none; border-radius: 28px; padding: 12px 20px;
        font: 500 14px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        cursor: pointer; box-shadow: 0 8px 32px rgba(0,0,0,0.12);
        display: none; align-items: center; gap: 8px; z-index: 99999;
        opacity: 0; transform: translateY(20px);
        transition: opacity 0.4s ease, transform 0.4s ease, filter 0.15s;
      }
      .ss-minimized:hover { filter: brightness(1.08); }
      .ss-minimized.ss-visible { opacity: 1; transform: translateY(0); }

      @media (max-width: 600px) {
        .ss-card { bottom: 0; right: 0; left: 0; width: 100% !important; border-radius: 12px 12px 0 0; }
      }
    `;
    document.head.appendChild(style);
  }

  // ── Dynamic accent color ──

  function applyAccent(el, accent) {
    // Set accent-colored elements via inline styles (no CSS custom properties needed)
    el.querySelectorAll('.ss-nps-btn.ss-selected').forEach(function (btn) {
      btn.style.backgroundColor = accent;
    });
    el.querySelectorAll('.ss-option.ss-selected').forEach(function (opt) {
      opt.style.borderColor = accent;
    });
    el.querySelectorAll('.ss-option.ss-selected .ss-radio').forEach(function (r) {
      r.style.borderColor = accent;
    });
    el.querySelectorAll('.ss-option.ss-selected .ss-radio-dot').forEach(function (d) {
      d.style.backgroundColor = accent;
    });
    el.querySelectorAll('.ss-btn-primary').forEach(function (btn) {
      btn.style.backgroundColor = accent;
    });
    el.querySelectorAll('.ss-progress-fill').forEach(function (bar) {
      bar.style.backgroundColor = accent;
    });
    el.querySelectorAll('.ss-thankyou-icon').forEach(function (icon) {
      icon.style.backgroundColor = accent;
    });
    if (minimizedEl) {
      minimizedEl.style.backgroundColor = accent;
    }
  }

  // ── Step widths ──

  var STEP_WIDTHS = { 0: 560, 1: 380, 2: 380, 3: 380, 4: 380 };

  // ── Render ──

  function render() {
    var accent = config.accentColor || '#E8A020';
    var name = config.displayName || options.product;
    var progress = ((currentStep + 1) / 5) * 100;

    cardEl.style.width = STEP_WIDTHS[currentStep] + 'px';

    var progressFill = cardEl.querySelector('.ss-progress-fill');
    if (progressFill) progressFill.style.width = progress + '%';

    var body = cardEl.querySelector('.ss-body');
    var html = '';

    if (currentStep === 0) {
      html = '<p class="ss-question">How likely are you to recommend ' + name + ' to family or friends?</p>'
        + '<p class="ss-required">Answer required</p>'
        + '<div class="ss-nps-row">';
      for (var n = 0; n <= 10; n++) {
        html += '<button class="ss-nps-btn' + (answers.nps === n ? ' ss-selected' : '') + '" data-nps="' + n + '">' + n + '</button>';
      }
      html += '</div>'
        + '<div class="ss-nps-labels"><span>0 - Not likely</span><span>10 - Very likely</span></div>'
        + '<div class="ss-nav"><button class="ss-btn ss-btn-primary"' + (answers.nps === null ? ' disabled' : '') + ' data-action="next">Next</button></div>';

    } else if (currentStep === 1) {
      html = '<p class="ss-question">Please tell us why you gave us this rating</p>'
        + '<p class="ss-required">Answer required</p>'
        + '<textarea class="ss-textarea" id="ss-comment" placeholder="Your feedback helps us improve ' + name + '...">' + answers.comment + '</textarea>'
        + '<div class="ss-nav"><button class="ss-btn ss-btn-secondary" data-action="back">Back</button>'
        + '<button class="ss-btn ss-btn-primary" data-action="next">Next</button></div>';

    } else if (currentStep === 2) {
      html = '<p class="ss-question">What is the main reason you\'re visiting ' + name + ' today?</p>'
        + '<p class="ss-required">Answer required</p><div class="ss-options">';
      config.visitReasons.forEach(function (r) {
        html += '<div class="ss-option' + (answers.visitReason === r ? ' ss-selected' : '') + '" data-reason="' + r + '">'
          + '<div class="ss-radio"><div class="ss-radio-dot"></div></div><span>' + r + '</span></div>';
      });
      html += '</div><div class="ss-nav"><button class="ss-btn ss-btn-secondary" data-action="back">Back</button>'
        + '<button class="ss-btn ss-btn-primary"' + (answers.visitReason === null ? ' disabled' : '') + ' data-action="next">Next</button></div>';

    } else if (currentStep === 3) {
      html = '<p class="ss-question">Which ' + name + ' feature do you value the most?</p>'
        + '<p class="ss-required">Answer required</p><div class="ss-options">';
      config.valuedFeatures.forEach(function (f) {
        html += '<div class="ss-option' + (answers.valuedFeature === f ? ' ss-selected' : '') + '" data-feature="' + f + '">'
          + '<div class="ss-radio"><div class="ss-radio-dot"></div></div><span>' + f + '</span></div>';
      });
      html += '</div><div class="ss-nav"><button class="ss-btn ss-btn-secondary" data-action="back">Back</button>'
        + '<button class="ss-btn ss-btn-primary"' + (answers.valuedFeature === null ? ' disabled' : '') + ' data-action="next">Next</button></div>';

    } else if (currentStep === 4) {
      html = '<div class="ss-thankyou">'
        + '<div class="ss-thankyou-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg></div>'
        + '<h3>Thank you!</h3>'
        + '<p>Your feedback helps us improve ' + name + ' for you and other subscribers.</p>'
        + '</div>';
    }

    body.innerHTML = html;
    applyAccent(cardEl, accent);
  }

  // ── Event delegation ──

  function handleCardClick(e) {
    var target = e.target.closest('[data-nps], [data-action], [data-reason], [data-feature]');
    if (!target) return;

    if (target.dataset.nps !== undefined) {
      answers.nps = parseInt(target.dataset.nps, 10);
      render();

    } else if (target.dataset.reason) {
      answers.visitReason = target.dataset.reason;
      render();

    } else if (target.dataset.feature) {
      answers.valuedFeature = target.dataset.feature;
      render();

    } else if (target.dataset.action === 'next') {
      if (target.disabled) return;
      saveComment();
      currentStep++;
      if (currentStep === 4) submitSurvey();
      render();

    } else if (target.dataset.action === 'back') {
      saveComment();
      if (currentStep > 0) currentStep--;
      render();
    }
  }

  function saveComment() {
    var textarea = document.getElementById('ss-comment');
    if (textarea) answers.comment = textarea.value;
  }

  // ── Show / hide ──

  function showCard() {
    cardEl.classList.remove('ss-hidden');
    // Force reflow for transition
    void cardEl.offsetHeight;
    cardEl.classList.add('ss-visible');
    minimizedEl.style.display = 'none';
    minimizedEl.classList.remove('ss-visible');
  }

  function hideCard() {
    cardEl.classList.remove('ss-visible');
    cardEl.classList.add('ss-hidden');
    minimizedEl.style.display = 'flex';
    void minimizedEl.offsetHeight;
    minimizedEl.classList.add('ss-visible');
  }

  // ── Submit to Worker ──

  function submitSurvey() {
    setLastCompleted();

    var payload = {
      product: options.product,
      email: options.subscriberEmail || '',
      nps: answers.nps,
      comment: answers.comment,
      visitReason: answers.visitReason,
      valuedFeature: answers.valuedFeature,
      timestamp: new Date().toISOString(),
      url: window.location.href,
    };

    // Fire and forget — don't block the thank-you screen
    if (options.apiBase) {
      fetch(options.apiBase + '/submit', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Survey-Token': options.submitToken || '',  // CHANGED: pass token from init options
  },
  body: JSON.stringify(payload),
}).catch(function (err) {
  console.warn('[SigmaSurvey] Submission failed:', err);
});
    }
  }

  // ── Build DOM ──

  function buildWidget() {
    var accent = config.accentColor || '#E8A020';

    // Main container
    widgetEl = document.createElement('div');
    widgetEl.className = 'ss-widget';
    widgetEl.id = 'sigma-survey-widget';

    // Card
    cardEl = document.createElement('div');
    cardEl.className = 'ss-card ss-hidden';
    cardEl.innerHTML = '<div class="ss-progress-track"><div class="ss-progress-fill"></div></div>'
      + '<div class="ss-header"><button class="ss-close" aria-label="Close survey">&times;</button></div>'
      + '<div class="ss-body"></div>';

    cardEl.querySelector('.ss-close').addEventListener('click', hideCard);
    cardEl.addEventListener('click', handleCardClick);

    // Minimized button
    minimizedEl = document.createElement('button');
    minimizedEl.className = 'ss-minimized';
    minimizedEl.style.backgroundColor = accent;
    minimizedEl.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg> Share feedback';
    minimizedEl.addEventListener('click', function () {
      minimizedEl.style.display = 'none';
      minimizedEl.classList.remove('ss-visible');
      showCard();
    });

    widgetEl.appendChild(cardEl);
    widgetEl.appendChild(minimizedEl);
    document.body.appendChild(widgetEl);
  }

  // ── Fetch config and launch ──

  function fetchConfigAndLaunch() {
    if (options.apiBase) {
      fetch(options.apiBase + '/config/' + encodeURIComponent(options.product))
        .then(function (res) { return res.json(); })
        .then(function (data) {
          config = data;
          launch();
        })
        .catch(function (err) {
          console.warn('[SigmaSurvey] Config fetch failed, using fallback:', err);
          config = options.fallbackConfig || {};
          if (config.displayName) launch();
        });
    } else if (options.fallbackConfig) {
      // No API base — use inline config (useful for testing)
      config = options.fallbackConfig;
      launch();
    }
  }

  function launch() {
    injectStyles();
    buildWidget();
    render();

    var delay = (config.delaySeconds !== undefined ? config.delaySeconds : options.delaySeconds) * 1000;

    setTimeout(function () {
      // Check mobile — start minimized on narrow screens
      if (window.innerWidth <= 600) {
        minimizedEl.style.display = 'flex';
        void minimizedEl.offsetHeight;
        minimizedEl.classList.add('ss-visible');
      } else {
        showCard();
      }
    }, delay);
  }

  // ── Public API ──

  window.SigmaSurvey = {
    init: function (opts) {
      if (!opts || !opts.product) {
        console.error('[SigmaSurvey] product is required in init()');
        return;
      }

      options = {
        product: opts.product,
        subscriberEmail: opts.subscriberEmail || '',
        apiBase: opts.apiBase || DEFAULTS.apiBase,
        delaySeconds: opts.delaySeconds !== undefined ? opts.delaySeconds : DEFAULTS.delaySeconds,
        minVisits: opts.minVisits !== undefined ? opts.minVisits : DEFAULTS.minVisits,
        frequencyDays: opts.frequencyDays !== undefined ? opts.frequencyDays : DEFAULTS.frequencyDays,
        fallbackConfig: opts.fallbackConfig || null,
        submitToken: opts.submitToken || '',  // ← add this line
      };

      // Track visit
      incrementVisitCount();

      // Demo mode via URL parameter
      var urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('survey') === 'demo') {
        options.subscriberEmail = options.subscriberEmail || 'demo@preview';
        fetchConfigAndLaunch();
        return;
      }
      
      // Check eligibility
      if (!shouldShowSurvey()) {
        return;
      }

      // Don't double-initialize
      if (document.getElementById('sigma-survey-widget')) return;

      fetchConfigAndLaunch();
    },

    // Manual trigger (bypasses visit count + frequency checks)
    show: function () {
      if (!document.getElementById('sigma-survey-widget')) {
        fetchConfigAndLaunch();
      } else {
        showCard();
      }
    },

    // Teardown
    destroy: function () {
      if (widgetEl) {
        widgetEl.remove();
        widgetEl = null;
        cardEl = null;
        minimizedEl = null;
      }
    },
  };
})();
