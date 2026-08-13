/* ============================================================
   WealthForge AI — onboarding wizard + guided tour
   Shows on first login (new users) and always for demo accounts.
   Tour highlights UI elements one by one with explanations.
   ============================================================ */

const Onboarding = (() => {
  const TOUR_STEPS = [
    {
      selector: '.hero',
      title: 'Your Net Worth',
      text: 'This is your total net worth — assets minus liabilities. It updates live as market prices move. You can see daily change, 10-year projection and holding count at a glance.',
      position: 'bottom'
    },
    {
      selector: '.hist-head',
      title: 'Growth Over Time',
      text: 'Track how your net worth changes daily. Toggle between 3M, 6M, 1Y or all-time views using the range buttons.',
      position: 'bottom'
    },
    {
      selector: '.insight-list, .empty',
      title: 'AI Insights',
      text: 'Smart rules analyze your portfolio and surface actionable insights — concentration risks, tax optimization, goal progress and more.',
      position: 'bottom'
    },
    {
      selector: '.grid.cols-2',
      title: 'Allocation & Projection',
      text: 'Left: asset allocation donut showing how your wealth is distributed. Right: 10-year Monte Carlo projection with 10th-90th percentile bands.',
      position: 'top'
    },
    {
      selector: '.sidebar-cta',
      title: 'Add Assets',
      text: 'Add any asset you own — stocks, mutual funds, FDs, EPF/PPF, gold, real estate, crypto and more. Supports manual entry, CSV import and AI-powered statement parsing.',
      position: 'right'
    },
    {
      selector: '[data-route="holdings"]',
      title: 'Holdings',
      text: 'View all your holdings organized by asset class — 12 tabs covering equity, MFs, crypto, FDs, small savings, EPF, PPF, NPS, gold, real estate and more.',
      position: 'right'
    },
    {
      selector: '[data-route="projections"]',
      title: 'Projections',
      text: 'Model your portfolio growth over 1, 3, 5, 10 or 20 years. See per-asset contribution with liability payoff curves.',
      position: 'right'
    },
    {
      selector: '[data-route="goals"]',
      title: 'Goals',
      text: 'Set net-worth targets and track your progress. Get notified when you hit a milestone.',
      position: 'right'
    },
    {
      selector: '#privacy_toggle',
      title: 'Privacy Mode',
      text: 'Click this to blur all monetary amounts — useful when screen sharing or in public. Hover to reveal individual values. Keyboard shortcut: Ctrl+Shift+P.',
      position: 'right'
    }
  ];

  let currentStep = -1;
  let overlay = null;
  let isActive = false;

  function shouldShowTour() {
    if (Auth.isDemo()) return !sessionStorage.getItem('wf.demoTourDone');
    try { return !localStorage.getItem('wf.tourDone'); } catch (e) { return false; }
  }

  function markTourDone() {
    if (Auth.isDemo()) {
      sessionStorage.setItem('wf.demoTourDone', '1');
    } else {
      try { localStorage.setItem('wf.tourDone', '1'); } catch (e) { /* ignore */ }
    }
  }

  function shouldShowOnboarding() {
    if (Auth.isDemo()) return false;
    try { return !localStorage.getItem('wf.onboardingDone'); } catch (e) { return false; }
  }

  function markOnboardingDone() {
    try { localStorage.setItem('wf.onboardingDone', '1'); } catch (e) { /* ignore */ }
  }

  function startOnboarding() {
    if (!shouldShowOnboarding()) {
      maybeStartTour();
      return;
    }

    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = `<div class="modal onboarding-modal" role="dialog" aria-label="Welcome">
      <div class="onboarding-header">
        <div class="brand-mark" style="width:48px;height:48px;font-size:22px;border-radius:14px" aria-hidden="true">W</div>
        <h2>Welcome to WealthForge AI</h2>
        <p class="dim">Track your entire net worth in one place.</p>
      </div>
      <div class="onboarding-body">
        <div class="onboarding-option" data-action="add">
          <span class="onboarding-icon">+</span>
          <div>
            <strong>Add your first asset</strong>
            <p class="dim small">Manually enter stocks, MFs, FDs or any holding</p>
          </div>
        </div>
        <div class="onboarding-option" data-action="import">
          <span class="onboarding-icon">A</span>
          <div>
            <strong>Import a statement</strong>
            <p class="dim small">Upload any CSV, XLS or PDF — AI extracts holdings</p>
          </div>
        </div>
        <div class="onboarding-option" data-action="tour">
          <span class="onboarding-icon">?</span>
          <div>
            <strong>Take a quick tour</strong>
            <p class="dim small">Learn what each section does in 30 seconds</p>
          </div>
        </div>
        <div class="onboarding-option" data-action="skip">
          <span class="onboarding-icon">-</span>
          <div>
            <strong>I'll explore on my own</strong>
            <p class="dim small">Jump straight to the dashboard</p>
          </div>
        </div>
      </div>
    </div>`;
    document.body.appendChild(back);

    back.querySelectorAll('.onboarding-option').forEach(opt => {
      opt.addEventListener('click', () => {
        const action = opt.dataset.action;
        back.remove();
        markOnboardingDone();
        switch (action) {
          case 'add': Router.go('/add'); break;
          case 'import': if (typeof AIImport !== 'undefined') AIImport.openUploadModal(); break;
          case 'tour': startTour(); break;
          case 'skip': break;
        }
      });
    });
  }

  function maybeStartTour() {
    if (shouldShowTour()) {
      setTimeout(() => startTour(), 600);
    }
  }

  function startTour() {
    if (isActive) return;
    isActive = true;
    currentStep = -1;

    overlay = document.createElement('div');
    overlay.className = 'tour-overlay';
    overlay.innerHTML = `
      <div class="tour-spotlight"></div>
      <div class="tour-tooltip">
        <div class="tour-tooltip-title"></div>
        <div class="tour-tooltip-text"></div>
        <div class="tour-tooltip-footer">
          <span class="tour-step-indicator"></span>
          <div class="tour-tooltip-actions">
            <button class="btn tour-skip">Skip tour</button>
            <button class="btn primary tour-next">Next</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    overlay.querySelector('.tour-skip').addEventListener('click', endTour);
    overlay.querySelector('.tour-next').addEventListener('click', nextStep);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) nextStep();
    });

    nextStep();
  }

  function nextStep() {
    currentStep++;
    if (currentStep >= TOUR_STEPS.length) { endTour(); return; }
    showStep(TOUR_STEPS[currentStep]);
  }

  function showStep(step) {
    const el = document.querySelector(step.selector);
    const spotlight = overlay.querySelector('.tour-spotlight');
    const tooltip = overlay.querySelector('.tour-tooltip');
    const title = overlay.querySelector('.tour-tooltip-title');
    const text = overlay.querySelector('.tour-tooltip-text');
    const indicator = overlay.querySelector('.tour-step-indicator');
    const nextBtn = overlay.querySelector('.tour-next');

    indicator.textContent = `${currentStep + 1} / ${TOUR_STEPS.length}`;
    nextBtn.textContent = currentStep === TOUR_STEPS.length - 1 ? 'Finish' : 'Next';
    title.textContent = step.title;
    text.textContent = step.text;

    if (el) {
      const rect = el.getBoundingClientRect();
      const padding = 8;
      spotlight.style.top = (rect.top - padding + window.scrollY) + 'px';
      spotlight.style.left = (rect.left - padding) + 'px';
      spotlight.style.width = (rect.width + padding * 2) + 'px';
      spotlight.style.height = (rect.height + padding * 2) + 'px';
      spotlight.style.opacity = '1';

      positionTooltip(tooltip, rect, step.position);
      // Scroll the tooltip into view so it's always visible and clickable
      requestAnimationFrame(() => {
        tooltip.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    } else {
      spotlight.style.opacity = '0';
      tooltip.style.top = '50%';
      tooltip.style.left = '50%';
      tooltip.style.transform = 'translate(-50%, -50%)';
    }
  }

  function positionTooltip(tooltip, rect, position) {
    const gap = 16;
    tooltip.style.transform = '';

    switch (position) {
      case 'bottom':
        tooltip.style.top = (rect.bottom + gap + window.scrollY) + 'px';
        tooltip.style.left = Math.max(16, rect.left) + 'px';
        break;
      case 'top':
        tooltip.style.top = (rect.top - gap + window.scrollY) + 'px';
        tooltip.style.left = Math.max(16, rect.left) + 'px';
        tooltip.style.transform = 'translateY(-100%)';
        break;
      case 'right':
        tooltip.style.top = (rect.top + window.scrollY) + 'px';
        tooltip.style.left = (rect.right + gap) + 'px';
        break;
      case 'left':
        tooltip.style.top = (rect.top + window.scrollY) + 'px';
        tooltip.style.left = (rect.left - gap) + 'px';
        tooltip.style.transform = 'translateX(-100%)';
        break;
    }

    // Keep tooltip on screen
    requestAnimationFrame(() => {
      const tr = tooltip.getBoundingClientRect();
      if (tr.right > window.innerWidth - 16) {
        tooltip.style.left = (window.innerWidth - tr.width - 16) + 'px';
      }
      if (tr.left < 16) tooltip.style.left = '16px';
      if (tr.bottom > window.innerHeight - 16) {
        tooltip.style.top = (rect.top - gap + window.scrollY) + 'px';
        tooltip.style.transform = 'translateY(-100%)';
      }
    });
  }

  function endTour() {
    isActive = false;
    currentStep = -1;
    if (overlay) { overlay.remove(); overlay = null; }
    markTourDone();
  }

  function restartTour() {
    if (Auth.isDemo()) sessionStorage.removeItem('wf.demoTourDone');
    else { try { localStorage.removeItem('wf.tourDone'); } catch (e) { /* ignore */ } }
    startTour();
  }

  return { startOnboarding, maybeStartTour, startTour: restartTour, endTour };
})();

if (typeof globalThis !== 'undefined') globalThis.Onboarding = Onboarding;
